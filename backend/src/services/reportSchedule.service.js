// Tier 4 #15 — ReportSchedule service.
// Wraps a saved ReportDefinition with a cron expression + recipients + format.
// dispatchDue() runs every few minutes via scheduler: for each active schedule
// whose nextRunAt has passed, enqueue an outbox row with target=SCHEDULED_REPORT.

const cron = require('node-cron');
const { CronExpressionParser } = require('cron-parser');

const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const reports = require('./reports.service');
const renderer = require('./reportRenderer.service');
const outbox = require('./outbox.service');
const defs = require('./reportDefinition.service');

function bad(msg, status = 400, code) {
  const e = new Error(msg);
  e.status = status;
  if (code) e.code = code;
  return e;
}

const VALID_FORMATS = ['CSV', 'XLSX', 'PDF'];

function computeNextRunAt(cronExpr, from = new Date()) {
  const interval = CronExpressionParser.parse(cronExpr, { currentDate: from });
  return interval.next().toDate();
}

function validateCron(cronExpr) {
  if (!cronExpr || typeof cronExpr !== 'string') throw bad('cron is required', 400, 'CRON_REQUIRED');
  if (!cron.validate(cronExpr)) throw bad(`Invalid cron expression: ${cronExpr}`, 400, 'CRON_INVALID');
  try {
    CronExpressionParser.parse(cronExpr);
  } catch (e) {
    throw bad(`Invalid cron expression: ${e.message}`, 400, 'CRON_INVALID');
  }
}

async function list(actor, { definitionId } = {}) {
  const where = {};
  if (definitionId) where.definitionId = definitionId;
  // Visibility piggybacks on definition visibility.
  if (!defs.canSeeAll(actor.role)) {
    where.definition = {
      deletedAt: null,
      OR: [{ ownerId: actor.id }, { isShared: true }],
    };
  } else {
    where.definition = { deletedAt: null };
  }
  return prisma.reportSchedule.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      definition: { select: { id: true, name: true, reportKey: true, ownerId: true, isShared: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

async function get(actor, id) {
  const sched = await prisma.reportSchedule.findUnique({
    where: { id },
    include: { definition: true },
  });
  if (!sched || !sched.definition || sched.definition.deletedAt) {
    throw bad('Schedule not found', 404, 'NOT_FOUND');
  }
  const def = sched.definition;
  if (!defs.canSeeAll(actor.role) && def.ownerId !== actor.id && !def.isShared) {
    throw bad('Forbidden', 403, 'FORBIDDEN');
  }
  return sched;
}

async function create(actor, { definitionId, cron: cronExpr, format, recipients, isActive }) {
  if (!definitionId) throw bad('definitionId is required', 400, 'DEFINITION_REQUIRED');
  validateCron(cronExpr);
  const fmt = String(format || 'PDF').toUpperCase();
  if (!VALID_FORMATS.includes(fmt)) throw bad(`format must be one of ${VALID_FORMATS.join(',')}`, 400, 'FORMAT_INVALID');
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw bad('recipients[] is required', 400, 'RECIPIENTS_REQUIRED');
  }
  const cleanRecipients = recipients
    .map((r) => String(r).trim())
    .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (cleanRecipients.length === 0) throw bad('recipients[] must contain valid emails', 400, 'RECIPIENTS_INVALID');

  const def = await prisma.reportDefinition.findFirst({ where: { id: definitionId, deletedAt: null } });
  if (!def) throw bad('Report definition not found', 404, 'NOT_FOUND');
  if (!defs.canSeeAll(actor.role) && def.ownerId !== actor.id && !def.isShared) {
    throw bad('Forbidden', 403, 'FORBIDDEN');
  }

  return prisma.reportSchedule.create({
    data: {
      definitionId,
      cron: cronExpr,
      format: fmt,
      recipients: cleanRecipients,
      isActive: isActive === undefined ? true : !!isActive,
      nextRunAt: computeNextRunAt(cronExpr),
      createdById: actor.id,
    },
  });
}

async function update(actor, id, patch) {
  const sched = await get(actor, id);
  // Only owner of definition or ADMIN/FINANCE can edit schedule.
  if (!defs.canSeeAll(actor.role) && sched.definition.ownerId !== actor.id) {
    throw bad('Forbidden', 403, 'FORBIDDEN');
  }
  const data = {};
  if (patch.cron !== undefined) {
    validateCron(patch.cron);
    data.cron = patch.cron;
    data.nextRunAt = computeNextRunAt(patch.cron);
  }
  if (patch.format !== undefined) {
    const fmt = String(patch.format).toUpperCase();
    if (!VALID_FORMATS.includes(fmt)) throw bad(`format must be one of ${VALID_FORMATS.join(',')}`, 400, 'FORMAT_INVALID');
    data.format = fmt;
  }
  if (patch.recipients !== undefined) {
    if (!Array.isArray(patch.recipients) || patch.recipients.length === 0) {
      throw bad('recipients[] is required', 400, 'RECIPIENTS_REQUIRED');
    }
    const cleaned = patch.recipients
      .map((r) => String(r).trim())
      .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
    if (cleaned.length === 0) throw bad('recipients[] must contain valid emails', 400, 'RECIPIENTS_INVALID');
    data.recipients = cleaned;
  }
  if (patch.isActive !== undefined) data.isActive = !!patch.isActive;
  return prisma.reportSchedule.update({ where: { id }, data });
}

async function remove(actor, id) {
  const sched = await get(actor, id);
  if (!defs.canSeeAll(actor.role) && sched.definition.ownerId !== actor.id) {
    throw bad('Forbidden', 403, 'FORBIDDEN');
  }
  return prisma.reportSchedule.delete({ where: { id } });
}

// Enqueue an outbox row to run this schedule now. Returns the outbox row.
async function runNow(actor, id) {
  const sched = await get(actor, id);
  if (!defs.canSeeAll(actor.role) && sched.definition.ownerId !== actor.id) {
    throw bad('Forbidden', 403, 'FORBIDDEN');
  }
  return enqueueRun(sched);
}

async function enqueueRun(sched, { trigger = 'manual' } = {}) {
  return outbox.enqueue({
    target: 'SCHEDULED_REPORT',
    action: 'RENDER_AND_EMAIL',
    payload: {
      scheduleId: sched.id,
      definitionId: sched.definitionId,
      format: sched.format,
      recipients: sched.recipients,
      trigger,
    },
  });
}

// Scheduler pass — find all active schedules whose nextRunAt has passed, enqueue
// outbox row, advance nextRunAt to the next cron tick.
async function dispatchDue(now = new Date()) {
  const due = await prisma.reportSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now }, definition: { deletedAt: null } },
    include: { definition: true },
    take: 50,
  });
  let dispatched = 0;
  for (const sched of due) {
    try {
      await enqueueRun(sched, { trigger: 'cron' });
      const nextRunAt = computeNextRunAt(sched.cron, new Date(now.getTime() + 1000));
      await prisma.reportSchedule.update({
        where: { id: sched.id },
        data: { lastRunAt: now, nextRunAt },
      });
      dispatched += 1;
    } catch (e) {
      logger.warn({ scheduleId: sched.id, err: e.message }, 'reportSchedule dispatch failed');
    }
  }
  return { dueCount: due.length, dispatched };
}

// Outbox handler. Idempotency: not strictly idempotent (each invocation emails
// fresh data). MAX_ATTEMPTS retries on failure are fine for transient errors.
async function handleScheduledReport(row) {
  const { definitionId, format, recipients } = row.payload || {};
  if (!definitionId || !format || !Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('SCHEDULED_REPORT payload missing definitionId/format/recipients');
  }
  const def = await prisma.reportDefinition.findFirst({ where: { id: definitionId, deletedAt: null } });
  if (!def) throw new Error(`ReportDefinition ${definitionId} not found`);

  const envelope = await reports.buildReport(def.reportKey, def.params || {});
  envelope.title = def.name || envelope.title;
  const rendered = await renderer.render(envelope, format);

  // Enqueue an email outbox row with the rendered attachment.
  await outbox.enqueue({
    target: 'email',
    action: 'SCHEDULED_REPORT',
    payload: {
      to: recipients.join(','),
      subject: `[Report] ${def.name}`,
      text: `Attached: ${def.name} (${format}). Rows: ${envelope.rows.length}.`,
      html: `<p>Attached: <strong>${escapeHtml(def.name)}</strong> (${format}).<br/>Rows: ${envelope.rows.length}.</p>`,
      attachments: [
        {
          filename: rendered.filename,
          content: rendered.buffer.toString('base64'),
          contentType: rendered.contentType,
          encoding: 'base64',
        },
      ],
      tag: 'scheduled-report',
    },
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  runNow,
  dispatchDue,
  handleScheduledReport,
  computeNextRunAt,
  validateCron,
  VALID_FORMATS,
};

// Email dispatcher. Order of preference:
//   1. SENDGRID_API_KEY → SendGrid HTTPS API
//   2. SMTP_HOST → nodemailer SMTP
//   3. neither   → no-op (logs only, dev mode)

const logger = require('./logger');

const FROM = process.env.MAIL_FROM || 'no-reply@rpechain.local';
const FROM_NAME = process.env.MAIL_FROM_NAME || 'RPE Chain';

let sgMail = null;
let smtpTransport = null;
let mode = 'noop';

function init() {
  if (process.env.SENDGRID_API_KEY) {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    mode = 'sendgrid';
  } else if (process.env.SMTP_HOST) {
    const nodemailer = require('nodemailer');
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    mode = 'smtp';
  }
  logger.info({ mode }, 'mailer initialised');
}
init();

async function sendEmail({ to, subject, html, text, tag, attachments }) {
  if (!to || !subject) throw new Error('mailer: to + subject required');
  const payload = {
    to, from: { email: FROM, name: FROM_NAME }, subject,
    html: html || undefined, text: text || stripHtml(html || ''),
  };
  const att = Array.isArray(attachments) ? attachments : [];
  if (mode === 'sendgrid') {
    // SendGrid expects base64-encoded content.
    const sgAtts = att.map((a) => ({
      filename: a.filename,
      type: a.contentType || 'application/octet-stream',
      content: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : (a.encoding === 'base64' ? a.content : Buffer.from(a.content).toString('base64')),
      disposition: 'attachment',
    }));
    await sgMail.send({
      ...payload,
      categories: tag ? [tag] : undefined,
      attachments: sgAtts.length ? sgAtts : undefined,
    });
    return { mode, to, subject, attachments: sgAtts.length };
  }
  if (mode === 'smtp') {
    const smtpAtts = att.map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content)
        ? a.content
        : (a.encoding === 'base64' ? Buffer.from(a.content, 'base64') : Buffer.from(a.content)),
      contentType: a.contentType || 'application/octet-stream',
    }));
    await smtpTransport.sendMail({
      from: `"${FROM_NAME}" <${FROM}>`,
      to, subject, html: payload.html, text: payload.text,
      attachments: smtpAtts.length ? smtpAtts : undefined,
    });
    return { mode, to, subject, attachments: smtpAtts.length };
  }
  // noop — log only
  logger.info({
    to, subject, tag,
    body: (text || stripHtml(html || '')).slice(0, 200),
    attachments: att.map((a) => ({ filename: a.filename, bytes: Buffer.isBuffer(a.content) ? a.content.length : (a.content || '').length })),
  }, 'mailer noop (no creds set)');
  return { mode: 'noop', to, subject, attachments: att.length };
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { sendEmail, mode: () => mode };

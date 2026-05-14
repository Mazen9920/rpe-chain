// Tier 4 #15 — Unified report renderer endpoint.
// GET /api/reports/render?reportKey=ap-aging&format=csv&...params
// GET /api/reports/render/:definitionId?format=pdf
// Returns the rendered file inline with correct Content-Type.

const reports = require('../services/reports.service');
const renderer = require('../services/reportRenderer.service');
const definitions = require('../services/reportDefinition.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

function pickParams(query) {
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    if (k === 'format' || k === 'reportKey' || k === 'download') continue;
    out[k] = v;
  }
  return out;
}

const renderAdhoc = wrap(async (req, res) => {
  const { reportKey, format = 'csv' } = req.query;
  if (!reportKey) {
    const err = new Error('reportKey is required');
    err.status = 400;
    err.code = 'REPORT_KEY_REQUIRED';
    throw err;
  }
  const envelope = await reports.buildReport(reportKey, pickParams(req.query));
  const rendered = await renderer.render(envelope, format);
  return sendRendered(res, rendered, req.query.download === '1');
});

const renderSaved = wrap(async (req, res) => {
  const def = await definitions.get(req.user, req.params.id);
  const format = req.query.format || 'csv';
  const envelope = await reports.buildReport(def.reportKey, def.params || {});
  envelope.title = def.name || envelope.title;
  const rendered = await renderer.render(envelope, format);
  return sendRendered(res, rendered, req.query.download === '1');
});

function sendRendered(res, rendered, downloadFlag) {
  res.setHeader('Content-Type', rendered.contentType);
  const disp = downloadFlag ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename="${rendered.filename}"`);
  res.setHeader('Content-Length', rendered.buffer.length);
  return res.end(rendered.buffer);
}

module.exports = { renderAdhoc, renderSaved };

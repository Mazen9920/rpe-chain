// Outbox target=email handler. Payload: { to, subject, html, text, tag }
const outbox = require('../../outbox.service');
const mailer = require('../../../lib/mailer');

outbox.registerHandler('email', async (row) => {
  const p = row.payload || {};
  if (!p.to || !p.subject) throw new Error('email payload missing to/subject');
  await mailer.sendEmail({
    to: p.to,
    subject: p.subject,
    html: p.html,
    text: p.text,
    tag: p.tag || row.action,
  });
});

module.exports = {};

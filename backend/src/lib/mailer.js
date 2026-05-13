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

async function sendEmail({ to, subject, html, text, tag }) {
  if (!to || !subject) throw new Error('mailer: to + subject required');
  const payload = {
    to, from: { email: FROM, name: FROM_NAME }, subject,
    html: html || undefined, text: text || stripHtml(html || ''),
  };
  if (mode === 'sendgrid') {
    await sgMail.send({ ...payload, categories: tag ? [tag] : undefined });
    return { mode, to, subject };
  }
  if (mode === 'smtp') {
    await smtpTransport.sendMail({
      from: `"${FROM_NAME}" <${FROM}>`,
      to, subject, html: payload.html, text: payload.text,
    });
    return { mode, to, subject };
  }
  // noop — log only
  logger.info({ to, subject, tag, body: (text || stripHtml(html || '')).slice(0, 200) }, 'mailer noop (no creds set)');
  return { mode: 'noop', to, subject };
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { sendEmail, mode: () => mode };

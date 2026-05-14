// Outbox target=SCHEDULED_REPORT handler. Payload:
//   { scheduleId, definitionId, format, recipients, trigger }
// Renders the report and enqueues an email outbox row with the file attached.

const outbox = require('../../outbox.service');
const reportSchedule = require('../../reportSchedule.service');

outbox.registerHandler('SCHEDULED_REPORT', reportSchedule.handleScheduledReport);

module.exports = {};

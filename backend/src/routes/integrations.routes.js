// Integration OAuth routes — /api/integrations/:provider/{connect,callback,status,disconnect}.
// Callback is unauthenticated (the OAuth state JWT is the auth); the others
// require an authenticated ADMIN/FINANCE user.
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/integrations.controller');

const router = express.Router();

// Callback receives a redirect from the provider — no app session cookie.
router.get('/:provider/callback', ctrl.callback);

// Everything else requires an authenticated admin or finance user.
router.get('/:provider/connect', authenticate, requireRole('ADMIN', 'FINANCE'), ctrl.connect);
router.get('/:provider/status', authenticate, requireRole('ADMIN', 'FINANCE'), ctrl.status);
router.post('/:provider/disconnect', authenticate, requireRole('ADMIN'), ctrl.disconnect);

module.exports = router;

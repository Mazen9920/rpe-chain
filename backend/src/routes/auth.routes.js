const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { loginIpLimiter, loginEmailLimiter, refreshLimiter } = require('../middleware/rateLimit');

router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('name').notEmpty().trim(),
  ],
  authController.register
);

router.post(
  '/login',
  loginIpLimiter,
  loginEmailLimiter,
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  authController.login
);

router.post('/login/mfa', loginIpLimiter, authController.loginMfa);

router.post('/refresh', refreshLimiter, authController.refresh);
router.post('/logout', authController.logout);

router.get('/me', authenticate, authController.me);

router.post('/mfa/setup', authenticate, authController.mfaSetup);
router.post('/mfa/verify', authenticate, authController.mfaVerify);
router.post('/mfa/disable', authenticate, authController.mfaDisable);

module.exports = router;

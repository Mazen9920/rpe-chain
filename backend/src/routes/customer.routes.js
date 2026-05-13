const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/customer.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const SALES_READ = ['ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE'];
const SALES_WRITE = ['ADMIN', 'SALES'];

router.use(authenticate);

router.get('/', requireRole(...SALES_READ), ctrl.list);
router.post('/', requireRole(...SALES_WRITE), ctrl.create);
router.get('/:id', requireRole(...SALES_READ), ctrl.getById);
router.patch('/:id', requireRole(...SALES_WRITE), ctrl.update);
router.delete('/:id', requireRole(...SALES_WRITE), ctrl.deactivate);

router.post('/:id/contacts', requireRole(...SALES_WRITE), ctrl.addContact);
router.patch('/:id/contacts/:contactId', requireRole(...SALES_WRITE), ctrl.updateContact);
router.post('/:id/contacts/:contactId/primary', requireRole(...SALES_WRITE), ctrl.setPrimary);
router.delete('/:id/contacts/:contactId', requireRole(...SALES_WRITE), ctrl.deleteContact);

module.exports = router;

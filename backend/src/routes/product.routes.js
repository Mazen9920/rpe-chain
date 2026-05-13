const express = require('express');
const multer = require('multer');
const router = express.Router();
const ctrl = require('../controllers/product.controller');
const bomCtrl = require('../controllers/bom.controller');
const compliance = require('../services/compliance.service');
const storage = require('../lib/storage');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/', ctrl.list);
router.get('/low-stock', ctrl.lowStock);
router.get('/:id', ctrl.getById);
router.get('/:productId/cost-rollup', bomCtrl.costRollup);
router.post('/', requireRole('ADMIN', 'WAREHOUSE'), ctrl.create);
router.put('/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.update);
router.delete('/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.remove);

// Compliance — certifications
router.get('/:id/certifications', async (req, res, next) => {
  try {
    const items = await compliance.listForProduct(req.params.id);
    if (items === null) return res.status(404).json({ error: 'Product not found' });
    res.json(items);
  } catch (e) { next(e); }
});

router.put('/:id/certifications', requireRole('ADMIN', 'WAREHOUSE'), async (req, res, next) => {
  try {
    const items = await compliance.replaceForProduct(req.params.id, req.body?.items || [], req.user);
    if (items === null) return res.status(404).json({ error: 'Product not found' });
    res.json(items);
  } catch (e) { next(e); }
});

router.post(
  '/:id/certifications/upload',
  requireRole('ADMIN', 'WAREHOUSE'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file is required' });
      const result = await compliance.uploadDocument(req.params.id, {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
      });
      res.json(result);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

router.get('/:id/certifications/:certId/document-url', async (req, res, next) => {
  try {
    const items = await compliance.listForProduct(req.params.id);
    if (!items) return res.status(404).json({ error: 'Product not found' });
    const cert = items.find((c) => c.id === req.params.certId);
    if (!cert) return res.status(404).json({ error: 'Certification not found' });
    if (!cert.documentKey) return res.status(404).json({ error: 'No document uploaded' });
    const url = await storage.getSignedUrl(cert.documentKey, 600);
    res.json({ url, expiresIn: 600 });
  } catch (e) { next(e); }
});

module.exports = router;

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const requestId = require('./middleware/requestId');
const requestLogger = require('./middleware/requestLogger');
const sentry = require('./lib/sentry');
const logger = require('./lib/logger');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const categoryRoutes = require('./routes/category.routes');
const productRoutes = require('./routes/product.routes');
const supplierRoutes = require('./routes/supplier.routes');
const supplierCategoryRoutes = require('./routes/supplierCategory.routes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');
const goodsReceiptRoutes = require('./routes/goodsReceipt.routes');
const shipmentRoutes = require('./routes/shipment.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const bomRoutes = require('./routes/bom.routes');
const productionRoutes = require('./routes/production.routes');
const apInvoiceRoutes = require('./routes/apInvoice.routes');
const paymentRoutes = require('./routes/payment.routes');
const apAgingRoutes = require('./routes/apAging.routes');
const creditNoteRoutes = require('./routes/creditNote.routes');
const customerRoutes = require('./routes/customer.routes');
const salesOrderRoutes = require('./routes/salesOrder.routes');
const alertsRoutes = require('./routes/alerts.routes');
const reportsRoutes = require('./routes/reports.routes');
const eventsRoutes = require('./routes/events.routes');
const webhookRoutes = require('./routes/webhook.routes');
const notificationsRoutes = require('./routes/notifications.routes');

// Bootstrap outbox handlers (self-register on require)
require('./services/integrations/email/handler');
require('./services/integrations/shopify/handler');
require('./services/integrations/bosta/handler');

const app = express();

// Behind nginx/load-balancer — trust X-Forwarded-* so req.ip is correct
// and express-rate-limit doesn't refuse to start.
app.set('trust proxy', 1);

// Security & middleware
app.use(requestId);
app.use(requestLogger);
app.use(helmet());
app.use(cors({ origin: '*' }));

// Inbound webhooks MUST be mounted BEFORE express.json() so the raw body
// remains available for HMAC verification (Shopify / Bosta).
app.use('/api/webhooks', webhookRoutes);

app.use(express.json());

// Health endpoints (mounted before auth so probes are always reachable)
app.use('/api', healthRoutes);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/supplier-categories', supplierCategoryRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/goods-receipts', goodsReceiptRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/boms', bomRoutes);
app.use('/api/production-orders', productionRoutes);
app.use('/api/ap/invoices', apInvoiceRoutes);
app.use('/api/ap/payments', paymentRoutes);
app.use('/api/ap/aging', apAgingRoutes);
app.use('/api/ap/credit-notes', creditNoteRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sales-orders', salesOrderRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Health check (legacy root path kept for backward compat — prefer /api/health)
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'rpe-supply-api' }));

// Sentry error handler must come BEFORE our handlers but AFTER routes.
sentry.attach(app);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, _next) => {
  (req.log || logger).error({ err, reqId: req.id }, 'unhandled error');
  res.status(err.status || 500).json({ error: err.message || 'Internal server error', code: err.code });
});

module.exports = app;

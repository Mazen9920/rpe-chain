const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

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

const app = express();

// Security & middleware
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());

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

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'rpe-supply-api' }));

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error', code: err.code });
});

module.exports = app;

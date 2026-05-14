import api from '../lib/api';
import type {
  Supplier,
  SupplierContact,
  SupplierDocument,
  SupplierPerformance,
  SupplierProductLink,
  SupplierCategory,
  SupplierKpis,
  SupplierListResponse,
  SupplierActivityEntry,
  RecomputePerformanceResult,
} from '../types/supplier';

export const categoryService = {
  list: () => api.get('/categories').then((r) => r.data),
  create: (data: object) => api.post('/categories', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/categories/${id}`, data).then((r) => r.data),
};

export const productService = {
  list: (params?: object) => api.get('/products', { params }).then((r) => r.data),
  lowStock: () => api.get('/products/low-stock').then((r) => r.data),
  getById: (id: string) => api.get(`/products/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/products', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/products/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/products/${id}`),
};

export interface SupplierListParams {
  search?: string;
  approvalStatus?: string;
  country?: string;
  categoryId?: string;
  riskRating?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export const supplierService = {
  list: (params?: SupplierListParams) =>
    api.get<SupplierListResponse>('/suppliers', { params }).then((r) => r.data),
  kpis: () => api.get<SupplierKpis>('/suppliers/kpis').then((r) => r.data),
  getById: (id: string) => api.get<Supplier>(`/suppliers/${id}`).then((r) => r.data),
  create: (data: Partial<Supplier>) => api.post<Supplier>('/suppliers', data).then((r) => r.data),
  update: (id: string, data: Partial<Supplier>) =>
    api.put<Supplier>(`/suppliers/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/suppliers/${id}`),
  setApproval: (id: string, status: string, reason?: string) =>
    api.post<Supplier>(`/suppliers/${id}/approval`, { status, reason }).then((r) => r.data),
  byProduct: (productId: string) =>
    api.get<SupplierProductLink[]>(`/suppliers/by-product/${productId}`).then((r) => r.data),
  activity: (id: string, params?: { limit?: number; offset?: number }) =>
    api.get<SupplierActivityEntry[]>(`/suppliers/${id}/activity`, { params }).then((r) => r.data),

  contacts: {
    list: (supplierId: string) =>
      api.get<SupplierContact[]>(`/suppliers/${supplierId}/contacts`).then((r) => r.data),
    create: (supplierId: string, data: Partial<SupplierContact>) =>
      api.post<SupplierContact>(`/suppliers/${supplierId}/contacts`, data).then((r) => r.data),
    update: (supplierId: string, contactId: string, data: Partial<SupplierContact>) =>
      api.put<SupplierContact>(`/suppliers/${supplierId}/contacts/${contactId}`, data).then((r) => r.data),
    delete: (supplierId: string, contactId: string) =>
      api.delete(`/suppliers/${supplierId}/contacts/${contactId}`),
  },

  products: {
    list: (supplierId: string) =>
      api.get<SupplierProductLink[]>(`/suppliers/${supplierId}/products`).then((r) => r.data),
    upsert: (supplierId: string, data: Partial<SupplierProductLink> & { productId: string }) =>
      api.post<SupplierProductLink>(`/suppliers/${supplierId}/products`, data).then((r) => r.data),
    remove: (supplierId: string, productId: string) =>
      api.delete(`/suppliers/${supplierId}/products/${productId}`),
  },

  documents: {
    list: (supplierId: string, params?: { category?: string; includeExpired?: boolean }) =>
      api.get<SupplierDocument[]>(`/suppliers/${supplierId}/documents`, { params }).then((r) => r.data),
    upload: (supplierId: string, formData: FormData) =>
      api.post<SupplierDocument>(`/suppliers/${supplierId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data),
    download: (docId: string) =>
      api.get(`/suppliers/documents/${docId}/download`, { responseType: 'blob' }).then((r) => r.data as Blob),
    delete: (docId: string) => api.delete(`/suppliers/documents/${docId}`),
  },

  performance: {
    list: (supplierId: string, params?: { from?: string; to?: string }) =>
      api.get<SupplierPerformance[]>(`/suppliers/${supplierId}/performance`, { params }).then((r) => r.data),
    upsert: (supplierId: string, data: Partial<SupplierPerformance>) =>
      api.post<SupplierPerformance>(`/suppliers/${supplierId}/performance`, data).then((r) => r.data),
    recompute: (supplierId: string, periodStart?: string, periodEnd?: string) =>
      api.post<RecomputePerformanceResult>(`/suppliers/${supplierId}/performance/recompute`, {
        periodStart, periodEnd,
      }).then((r) => r.data),
  },

  categories: {
    list: () => api.get<SupplierCategory[]>('/supplier-categories').then((r) => r.data),
    create: (data: Partial<SupplierCategory>) =>
      api.post<SupplierCategory>('/supplier-categories', data).then((r) => r.data),
    delete: (id: string) => api.delete(`/supplier-categories/${id}`),
    attach: (supplierId: string, categoryId: string) =>
      api.post(`/suppliers/${supplierId}/categories/${categoryId}`),
    detach: (supplierId: string, categoryId: string) =>
      api.delete(`/suppliers/${supplierId}/categories/${categoryId}`),
  },
};

export const purchaseOrderService = {
  list: (params?: object) => api.get('/purchase-orders', { params }).then((r) => r.data),
  kpis: () => api.get('/purchase-orders/kpis').then((r) => r.data),
  getById: (id: string) => api.get(`/purchase-orders/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/purchase-orders', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/purchase-orders/${id}`, data).then((r) => r.data),
  submit: (id: string) => api.post(`/purchase-orders/${id}/submit`).then((r) => r.data),
  approve: (id: string) => api.post(`/purchase-orders/${id}/approve`).then((r) => r.data),
  send: (id: string) => api.post(`/purchase-orders/${id}/send`).then((r) => r.data),
  cancel: (id: string, reason?: string) =>
    api.post(`/purchase-orders/${id}/cancel`, { reason }).then((r) => r.data),
  close: (id: string) => api.post(`/purchase-orders/${id}/close`).then((r) => r.data),
  activity: (id: string, params?: { limit?: number }) =>
    api.get(`/purchase-orders/${id}/activity`, { params }).then((r) => r.data),
  receive: (id: string, data: object) =>
    api.post(`/purchase-orders/${id}/receive`, data).then((r) => r.data),
};

export const goodsReceiptService = {
  list: (params?: object) => api.get('/goods-receipts', { params }).then((r) => r.data),
  getById: (id: string) => api.get(`/goods-receipts/${id}`).then((r) => r.data),
  reverse: (id: string, reason: string) =>
    api.post(`/goods-receipts/${id}/reverse`, { reason }).then((r) => r.data),
  qaAction: (lineId: string, action: 'RELEASE' | 'REJECT', reason?: string) =>
    api.post(`/goods-receipts/lines/${lineId}/qa`, { action, reason }).then((r) => r.data),
  addLandedCost: (
    id: string,
    data: { costType: string; amount: number; allocationMethod: string }
  ) => api.post(`/goods-receipts/${id}/landed-costs`, data).then((r) => r.data),
  removeLandedCost: (id: string, allocationId: string) =>
    api.delete(`/goods-receipts/${id}/landed-costs/${allocationId}`).then((r) => r.data),
};

export const shipmentService = {
  list: (params?: object) => api.get('/shipments', { params }).then((r) => r.data),
  getById: (id: string) => api.get(`/shipments/${id}`).then((r) => r.data),
  deliver: (id: string, data?: { deliveredAt?: string; location?: string }) =>
    api.post(`/shipments/${id}/deliver`, data ?? {}).then((r) => r.data),
  void: (id: string, reason: string) =>
    api.post(`/shipments/${id}/void`, { reason }).then((r) => r.data),
  getLabel: (id: string): Promise<{ url: string; key: string; expiresIn: number }> =>
    api.get(`/shipments/${id}/label`).then((r) => r.data),
};

// ── Section 6 — Fulfillment ──────────────────────────────────────────────
import type {
  Customer,
  CustomerContact,
  CustomerListResponse,
  SalesOrder,
  SOListResponse,
  SOKpis,
  CreateSOPayload,
  ShipPayload,
  PickPayload,
} from '../types/fulfillment';

export const customerService = {
  list: (params?: { search?: string; isActive?: boolean; limit?: number; offset?: number }) =>
    api.get<CustomerListResponse>('/customers', { params }).then((r) => r.data),
  getById: (id: string) => api.get<Customer>(`/customers/${id}`).then((r) => r.data),
  create: (data: Partial<Customer>) =>
    api.post<Customer>('/customers', data).then((r) => r.data),
  update: (id: string, data: Partial<Customer>) =>
    api.patch<Customer>(`/customers/${id}`, data).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/customers/${id}`),
  contacts: {
    add: (customerId: string, data: Partial<CustomerContact>) =>
      api.post<CustomerContact>(`/customers/${customerId}/contacts`, data).then((r) => r.data),
    update: (customerId: string, contactId: string, data: Partial<CustomerContact>) =>
      api.patch<CustomerContact>(`/customers/${customerId}/contacts/${contactId}`, data).then((r) => r.data),
    setPrimary: (customerId: string, contactId: string) =>
      api.post<CustomerContact>(`/customers/${customerId}/contacts/${contactId}/primary`).then((r) => r.data),
    delete: (customerId: string, contactId: string) =>
      api.delete(`/customers/${customerId}/contacts/${contactId}`),
  },
};

export const salesOrderService = {
  list: (params?: { search?: string; status?: string; customerId?: string; warehouseId?: string; source?: string; limit?: number; offset?: number }) =>
    api.get<SOListResponse>('/sales-orders', { params }).then((r) => r.data),
  kpis: () => api.get<SOKpis>('/sales-orders/kpis').then((r) => r.data),
  getById: (id: string) => api.get<SalesOrder>(`/sales-orders/${id}`).then((r) => r.data),
  create: (data: CreateSOPayload) =>
    api.post<SalesOrder>('/sales-orders', data).then((r) => r.data),
  update: (id: string, data: Partial<SalesOrder>) =>
    api.patch<SalesOrder>(`/sales-orders/${id}`, data).then((r) => r.data),
  confirm: (id: string) =>
    api.post<SalesOrder & { warnings?: Array<{ code: string; message: string }> }>(`/sales-orders/${id}/confirm`).then((r) => r.data),
  allocate: (id: string) => api.post<SalesOrder>(`/sales-orders/${id}/allocate`).then((r) => r.data),
  pick: (id: string, data: PickPayload) =>
    api.post<SalesOrder>(`/sales-orders/${id}/pick`, data).then((r) => r.data),
  pack: (id: string) => api.post<SalesOrder>(`/sales-orders/${id}/pack`).then((r) => r.data),
  ship: (id: string, data: ShipPayload) =>
    api.post<SalesOrder>(`/sales-orders/${id}/ship`, data).then((r) => r.data),
  cancel: (id: string, reason: string) =>
    api.post<SalesOrder>(`/sales-orders/${id}/cancel`, { reason }).then((r) => r.data),
};

export const inventoryService = {
  warehouses: () => api.get('/inventory/warehouses').then((r) => r.data),
  getWarehouse: (id: string) => api.get(`/inventory/warehouses/${id}`).then((r) => r.data),
  createWarehouse: (data: object) => api.post('/inventory/warehouses', data).then((r) => r.data),
  updateWarehouse: (id: string, data: object) =>
    api.put(`/inventory/warehouses/${id}`, data).then((r) => r.data),
  deactivateWarehouse: (id: string) => api.delete(`/inventory/warehouses/${id}`),
  zones: (warehouseId: string) => api.get(`/inventory/warehouses/${warehouseId}/zones`).then((r) => r.data),
  createZone: (warehouseId: string, data: object) =>
    api.post(`/inventory/warehouses/${warehouseId}/zones`, data).then((r) => r.data),
  updateZone: (warehouseId: string, zoneId: string, data: object) =>
    api.put(`/inventory/warehouses/${warehouseId}/zones/${zoneId}`, data).then((r) => r.data),
  bins: (params?: { warehouseId?: string; zoneId?: string }) =>
    api.get('/inventory/bins', { params }).then((r) => r.data),
  createBin: (data: object) => api.post('/inventory/bins', data).then((r) => r.data),
  updateBin: (id: string, data: object) => api.put(`/inventory/bins/${id}`, data).then((r) => r.data),
  deactivateBin: (id: string) => api.delete(`/inventory/bins/${id}`),
  stockLevels: (params?: { warehouseId?: string; productId?: string }) =>
    api.get('/inventory/stock-levels', { params }).then((r) => r.data),
  binStockLevels: (params?: { warehouseId?: string; productId?: string; binId?: string }) =>
    api.get('/inventory/bin-stock-levels', { params }).then((r) => r.data),
  lots: (params?: { expiringInDays?: number; productId?: string }) =>
    api.get('/inventory/lots', { params }).then((r) => r.data),
  updateLotQaStatus: (id: string, data: object) =>
    api.put(`/inventory/lots/${id}/qa-status`, data).then((r) => r.data),
  recallLot: (id: string, reason: string) =>
    api.post(`/inventory/lots/${id}/recall`, { reason }).then((r) => r.data),
  valuation: (params?: { warehouseId?: string; productId?: string }) =>
    api.get('/inventory/valuation', { params }).then((r) => r.data),
  movements: (params?: { productId?: string; limit?: number }) =>
    api.get('/inventory/movements', { params }).then((r) => r.data),
  adjustStock: (data: object) => api.post('/inventory/adjustments', data).then((r) => r.data),
  moveBetweenBins: (data: object) => api.post('/inventory/bin-moves', data).then((r) => r.data),
  lookup: (code: string) => api.get('/inventory/lookup', { params: { code } }).then((r) => r.data) as Promise<{ type: 'BIN' | 'PRODUCT' | 'LOT'; entity: Record<string, unknown> }>,
  transfers: () => api.get('/inventory/transfers').then((r) => r.data),
  createTransfer: (data: object) => api.post('/inventory/transfers', data).then((r) => r.data),
  shipTransfer: (id: string, data?: object) => api.post(`/inventory/transfers/${id}/ship`, data ?? {}).then((r) => r.data),
  receiveTransfer: (id: string, data?: object) => api.post(`/inventory/transfers/${id}/receive`, data ?? {}).then((r) => r.data),
  cycleCounts: (params?: { warehouseId?: string; status?: string }) =>
    api.get('/inventory/cycle-counts', { params }).then((r) => r.data),
  createCycleCount: (data: object) => api.post('/inventory/cycle-counts', data).then((r) => r.data),
  updateCycleCountLine: (id: string, lineId: string, data: object) =>
    api.put(`/inventory/cycle-counts/${id}/lines/${lineId}`, data).then((r) => r.data),
  postCycleCount: (id: string) => api.post(`/inventory/cycle-counts/${id}/post`).then((r) => r.data),
  cancelCycleCount: (id: string) => api.post(`/inventory/cycle-counts/${id}/cancel`).then((r) => r.data),
  reorderRecommendations: () => api.get('/inventory/reorder-recommendations').then((r) => r.data),
  alerts: () => api.get('/inventory/alerts').then((r) => r.data),
  summary: () => api.get('/inventory/summary').then((r) => r.data),
  scanAlerts: () => api.post('/inventory/alerts/scan').then((r) => r.data),
  openAlerts: (limit?: number) => api.get('/inventory/alerts/open', { params: { limit } }).then((r) => r.data),
  acknowledgeAlert: (id: string) => api.post(`/inventory/alerts/${id}/acknowledge`).then((r) => r.data),
  generateReorder: () => api.post('/inventory/reorder-recommendations/generate').then((r) => r.data),
  savedReorder: (status?: string) => api.get('/inventory/reorder-recommendations/saved', { params: { status } }).then((r) => r.data),
  dismissReorder: (id: string) => api.post(`/inventory/reorder-recommendations/${id}/dismiss`).then((r) => r.data),
  reportStockSnapshot: (params?: object) => api.get('/inventory/reports/stock-snapshot', { params }).then((r) => r.data),
  reportMovementHistory: (params?: object) => api.get('/inventory/reports/movement-history', { params }).then((r) => r.data),
  reportValuationSummary: (params?: object) => api.get('/inventory/reports/valuation-summary', { params }).then((r) => r.data),
  runClassification: (dryRun?: boolean) =>
    api.post('/inventory/classification/run', null, { params: dryRun ? { dryRun: 'true' } : {} }).then((r) => r.data),
  classificationMatrix: () => api.get('/inventory/classification/matrix').then((r) => r.data),
  classificationProducts: (params?: { abc?: string; xyz?: string; limit?: number; offset?: number }) =>
    api.get('/inventory/classification/products', { params }).then((r) => r.data),
  downloadCsv: (path: string, params: object, filename: string) =>
    api.get(path, { params: { ...params, format: 'csv' }, responseType: 'blob' }).then((r) => {
      const url = URL.createObjectURL(new Blob([r.data as BlobPart], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }),
};

export const dashboardService = {
  summary: () => api.get('/dashboard/summary').then((r) => r.data),
  salesTrend: (days = 30) => api.get('/dashboard/sales-trend', { params: { days } }).then((r) => r.data),
  inventoryTrend: (days = 30) => api.get('/dashboard/inventory-trend', { params: { days } }).then((r) => r.data),
  alertsTrend: (days = 30) => api.get('/dashboard/alerts-trend', { params: { days } }).then((r) => r.data),
  marginTrend: (days = 30) => api.get('/dashboard/margin-trend', { params: { days } }).then((r) => r.data),
};

export const alertsService = {
  list: (params?: { status?: string; type?: string; severity?: string; limit?: number; offset?: number }) =>
    api.get('/alerts', { params }).then((r) => r.data),
  acknowledge: (id: string) => api.post(`/alerts/${id}/acknowledge`).then((r) => r.data),
  snooze: (id: string, snoozedUntil: string) => api.post(`/alerts/${id}/snooze`, { snoozedUntil }).then((r) => r.data),
  resolve: (id: string) => api.post(`/alerts/${id}/resolve`).then((r) => r.data),
  scan: () => api.post('/alerts/scan').then((r) => r.data),
};

export type NotificationSubscription = {
  id: string;
  userId: string;
  alertType: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  channel: 'EMAIL' | 'SMS' | 'SLACK';
  isActive: boolean;
};

export const notificationsService = {
  listSubscriptions: () =>
    api.get<NotificationSubscription[]>('/notifications/subscriptions').then((r) => r.data),
  replaceSubscriptions: (items: Array<Partial<NotificationSubscription>>) =>
    api.put<NotificationSubscription[]>('/notifications/subscriptions', items).then((r) => r.data),
  seedAdminDefaults: () =>
    api.post('/notifications/subscriptions/seed-admin-defaults').then((r) => r.data),
  runDigest: () => api.post('/notifications/digest/run').then((r) => r.data),
};

export const reportsService = {
  apAging: (params?: { supplierId?: string }) => api.get('/reports/ap-aging', { params }).then((r) => r.data),
  supplierScorecards: () => api.get('/reports/supplier-scorecards').then((r) => r.data),
  salesFulfillment: (params?: { from?: string; to?: string }) => api.get('/reports/sales-fulfillment', { params }).then((r) => r.data),
  downloadCsv: (path: string, filename: string, params?: Record<string, string>) => {
    const qs = new URLSearchParams({ ...(params || {}), format: 'csv' }).toString();
    return api.get(`${path}?${qs}`, { responseType: 'blob' }).then((r) => {
      const url = window.URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    });
  },
};

export const eventsService = {
  list: (params?: { limit?: number; offset?: number; entityType?: string; entityId?: string; eventType?: string }) =>
    api.get('/events', { params }).then((r) => r.data),
};

export const bomService = {
  list: (params?: { productId?: string; includeArchived?: boolean }) =>
    api.get('/boms', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/boms/${id}`).then((r) => r.data),
  createDraft: (data: { productId: string; notes?: string; lines: Array<{ componentProductId: string; qtyPer: number; uom?: string; scrapFactorPct?: number; position?: number; notes?: string }> }) =>
    api.post('/boms', data).then((r) => r.data),
  updateDraft: (id: string, data: object) => api.put(`/boms/${id}`, data).then((r) => r.data),
  activate: (id: string) => api.post(`/boms/${id}/activate`).then((r) => r.data),
  archive: (id: string) => api.post(`/boms/${id}/archive`).then((r) => r.data),
  clone: (id: string) => api.post(`/boms/${id}/clone`).then((r) => r.data),
  costRollup: (productId: string, params?: { mode?: 'standard' | 'fifo'; warehouseId?: string }) =>
    api.get(`/products/${productId}/cost-rollup`, { params }).then((r) => r.data),
};

export const productionService = {
  list: (params?: { status?: string; productId?: string; warehouseId?: string }) =>
    api.get('/production-orders', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/production-orders/${id}`).then((r) => r.data),
  plan: (data: { productId: string; plannedQty: number; warehouseId: string; bomId?: string; notes?: string }) =>
    api.post('/production-orders/plan', data).then((r) => r.data),
  release: (id: string) => api.post(`/production-orders/${id}/release`).then((r) => r.data),
  consume: (id: string) => api.post(`/production-orders/${id}/consume`).then((r) => r.data),
  output: (id: string, data: { qty: number; scrapQty?: number; lotNumber?: string; expiryDate?: string }) =>
    api.post(`/production-orders/${id}/output`, data).then((r) => r.data),
  cancel: (id: string, reason?: string) =>
    api.post(`/production-orders/${id}/cancel`, { reason }).then((r) => r.data),
};

import type {
  SupplierInvoice,
  Payment,
  InvoiceKpis,
  AgingRow,
  AgingSummary,
  SupplierStatement,
  InvoiceType,
  InvoiceStatus,
  PaymentMethod,
} from '../types/ap';

export interface InvoiceListParams {
  supplierId?: string;
  status?: InvoiceStatus;
  invoiceType?: InvoiceType;
  purchaseOrderId?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export const apInvoiceService = {
  list: (params?: InvoiceListParams) =>
    api.get<{ rows: SupplierInvoice[]; total: number }>('/ap/invoices', { params }).then((r) => r.data),
  kpis: () => api.get<InvoiceKpis>('/ap/invoices/kpis').then((r) => r.data),
  getById: (id: string) => api.get<SupplierInvoice>(`/ap/invoices/${id}`).then((r) => r.data),
  create: (data: Partial<SupplierInvoice> & { lines: Array<{ poLineId?: string; grnLineId?: string; description?: string; quantity: number; unitPrice: number }> }) =>
    api.post<SupplierInvoice>('/ap/invoices', data).then((r) => r.data),
  submit: (id: string) => api.post<SupplierInvoice>(`/ap/invoices/${id}/submit`).then((r) => r.data),
  rematch: (id: string) => api.post<SupplierInvoice>(`/ap/invoices/${id}/rematch`).then((r) => r.data),
  approve: (id: string, overrideReason?: string) =>
    api.post<SupplierInvoice>(`/ap/invoices/${id}/approve`, { overrideReason }).then((r) => r.data),
  void: (id: string, reason: string) =>
    api.post<SupplierInvoice>(`/ap/invoices/${id}/void`, { reason }).then((r) => r.data),
};

export interface PaymentListParams {
  supplierId?: string;
  method?: PaymentMethod;
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export const paymentService = {
  list: (params?: PaymentListParams) =>
    api.get<{ rows: Payment[]; total: number }>('/ap/payments', { params }).then((r) => r.data),
  getById: (id: string) => api.get<Payment>(`/ap/payments/${id}`).then((r) => r.data),
  create: (data: {
    supplierId: string;
    amount: number;
    currency?: string;
    fxRate?: number;
    paymentDate?: string;
    method: PaymentMethod;
    reference?: string;
    notes?: string;
    applications: Array<{ invoiceId: string; amountApplied: number }>;
  }) => api.post<Payment>('/ap/payments', data).then((r) => r.data),
  void: (id: string, reason: string) =>
    api.post<Payment>(`/ap/payments/${id}/void`, { reason }).then((r) => r.data),
};

export const apAgingService = {
  aging: (params?: { supplierId?: string; asOf?: string }) =>
    api.get<{ asOf: string; rows: AgingRow[] }>('/ap/aging', { params }).then((r) => r.data),
  summary: (params?: { supplierId?: string; asOf?: string }) =>
    api.get<AgingSummary>('/ap/aging/summary', { params }).then((r) => r.data),
  statement: (supplierId: string, asOf?: string) =>
    api.get<SupplierStatement>(`/ap/aging/statement/${supplierId}`, { params: { asOf } }).then((r) => r.data),
};

export const creditNoteService = {
  list: (params?: InvoiceListParams) =>
    api.get<{ rows: SupplierInvoice[]; total: number }>('/ap/credit-notes', { params }).then((r) => r.data),
  create: (data: {
    creditedInvoiceId: string;
    invoiceNumber: string;
    invoiceDate?: string;
    currency?: string;
    notes?: string;
    lines: Array<{ description?: string; quantity: number; unitPrice: number; poLineId?: string; grnLineId?: string }>;
  }) => api.post<SupplierInvoice>('/ap/credit-notes', data).then((r) => r.data),
};

export const settingsService = {
  getMatchTolerances: () => api.get('/settings/match-tolerances').then((r) => r.data),
  updateGlobalMatchTolerances: (body: { qtyPct?: number; pricePct?: number }) =>
    api.put('/settings/match-tolerances/global', body).then((r) => r.data),
  updateSupplierMatchTolerances: (id: string, body: { qtyPct?: number | null; pricePct?: number | null }) =>
    api.put(`/settings/match-tolerances/suppliers/${id}`, body).then((r) => r.data),
};

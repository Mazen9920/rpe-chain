import api from '../lib/api';

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

export const supplierService = {
  list: () => api.get('/suppliers').then((r) => r.data),
  getById: (id: string) => api.get(`/suppliers/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/suppliers', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/suppliers/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/suppliers/${id}`),
};

export const purchaseOrderService = {
  list: (params?: object) => api.get('/purchase-orders', { params }).then((r) => r.data),
  getById: (id: string) => api.get(`/purchase-orders/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/purchase-orders', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/purchase-orders/${id}`, data).then((r) => r.data),
  receive: (id: string, data: object) =>
    api.post(`/purchase-orders/${id}/receive`, data).then((r) => r.data),
};

export const shipmentService = {
  list: (params?: object) => api.get('/shipments', { params }).then((r) => r.data),
  getById: (id: string) => api.get(`/shipments/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/shipments', data).then((r) => r.data),
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
  reportStockSnapshot: (params?: object) => api.get('/inventory/reports/stock-snapshot', { params }).then((r) => r.data),
  reportMovementHistory: (params?: object) => api.get('/inventory/reports/movement-history', { params }).then((r) => r.data),
  reportValuationSummary: (params?: object) => api.get('/inventory/reports/valuation-summary', { params }).then((r) => r.data),
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
};

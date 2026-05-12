import api from '../lib/api';

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
  stockLevels: (params?: { warehouseId?: string; productId?: string }) =>
    api.get('/inventory/stock-levels', { params }).then((r) => r.data),
  lots: (params?: { expiringInDays?: number; productId?: string }) =>
    api.get('/inventory/lots', { params }).then((r) => r.data),
  valuation: (params?: { warehouseId?: string; productId?: string }) =>
    api.get('/inventory/valuation', { params }).then((r) => r.data),
  movements: (params?: { productId?: string; limit?: number }) =>
    api.get('/inventory/movements', { params }).then((r) => r.data),
};

export const dashboardService = {
  summary: () => api.get('/dashboard/summary').then((r) => r.data),
};

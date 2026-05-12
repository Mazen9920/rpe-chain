export type InventoryTab = 'products' | 'stock' | 'lots' | 'movements';

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  uom: string;
  gtin?: string | null;
  weightKg?: string | number | null;
  hsCode?: string | null;
  certifications?: unknown;
  abcClass?: string | null;
  xyzClass?: string | null;
  reorderPoint: number;
  reorderQty: number;
  costPrice: string | number;
  sellingPrice: string | number;
  isActive: boolean;
  categoryId: string;
  category?: Category;
  totalOnHand?: number;
  totalReserved?: number;
  isLowStock?: boolean;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  taxJurisdiction?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface StockLevel {
  id: string;
  productId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  inTransit: number;
  quarantine: number;
  damaged: number;
  updatedAt: string;
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'uom' | 'reorderPoint'>;
  warehouse?: Pick<Warehouse, 'id' | 'code' | 'name'>;
}

export interface Lot {
  id: string;
  lotNumber: string;
  productId: string;
  supplierId?: string | null;
  receivedDate: string;
  expiryDate?: string | null;
  qtyReceived: number;
  qtyRemaining: number;
  qaStatus: string;
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'uom'>;
}

export interface StockMovement {
  id: string;
  productId: string;
  warehouseId: string;
  lotId?: string | null;
  qty: number;
  direction: 'IN' | 'OUT' | 'TRANSFER' | string;
  reasonCode: string;
  sourceDocType?: string | null;
  sourceDocId?: string | null;
  notes?: string | null;
  createdAt: string;
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'uom'>;
  warehouse?: Pick<Warehouse, 'id' | 'code' | 'name'>;
  lot?: Pick<Lot, 'id' | 'lotNumber'>;
}

export interface ProductFormInput {
  sku: string;
  name: string;
  description?: string | null;
  categoryId: string;
  uom: string;
  reorderPoint: number;
  reorderQty: number;
  costPrice: string;
  sellingPrice: string;
  weightKg?: string | null;
  hsCode?: string | null;
  certifications?: unknown;
}

export interface WarehouseFormInput {
  code: string;
  name: string;
  address?: string | null;
  taxJurisdiction?: string | null;
}

export interface StockAdjustmentInput {
  productId: string;
  warehouseId: string;
  lotId?: string | null;
  qty: number;
  notes?: string | null;
}

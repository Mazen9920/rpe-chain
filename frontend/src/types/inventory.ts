export type InventoryTab = 'products' | 'locations' | 'stock' | 'lots' | 'transfers' | 'counts' | 'movements' | 'reorder' | 'alerts';

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
  country?: string | null;
  currency?: string;
  taxJurisdiction?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface WarehouseZone {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  bins?: BinLocation[];
}

export interface BinLocation {
  id: string;
  warehouseId: string;
  zoneId?: string | null;
  code: string;
  name?: string | null;
  barcode?: string | null;
  binType: string;
  isActive: boolean;
  warehouse?: Pick<Warehouse, 'id' | 'code' | 'name'>;
  zone?: WarehouseZone | null;
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

export interface BinStockLevel {
  id: string;
  productId: string;
  warehouseId: string;
  binId: string;
  onHand: number;
  reserved: number;
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'uom'>;
  warehouse?: Pick<Warehouse, 'id' | 'code' | 'name'>;
  bin?: BinLocation;
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
  binId?: string | null;
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

export interface StockTransferLine {
  id: string;
  transferId: string;
  productId: string;
  lotId?: string | null;
  sourceBinId?: string | null;
  destinationBinId?: string | null;
  qtyRequested: number;
  qtyShipped: number;
  qtyReceived: number;
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'uom'>;
  lot?: Lot | null;
}

export interface StockTransfer {
  id: string;
  transferNumber: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  shippedAt?: string | null;
  receivedAt?: string | null;
  sourceWarehouse?: Pick<Warehouse, 'id' | 'code' | 'name'>;
  destinationWarehouse?: Pick<Warehouse, 'id' | 'code' | 'name'>;
  lines: StockTransferLine[];
}

export interface CycleCountLine {
  id: string;
  cycleCountId: string;
  productId: string;
  binId?: string | null;
  expectedQty: number;
  countedQty?: number | null;
  varianceQty?: number | null;
  notes?: string | null;
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'uom'>;
  bin?: BinLocation | null;
}

export interface CycleCount {
  id: string;
  countNumber: string;
  warehouseId: string;
  status: string;
  startedAt: string;
  postedAt?: string | null;
  notes?: string | null;
  warehouse?: Pick<Warehouse, 'id' | 'code' | 'name'>;
  lines: CycleCountLine[];
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
  binId?: string | null;
  lotId?: string | null;
  qty: number;
  notes?: string | null;
}

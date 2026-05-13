export type PoStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED'
  | 'CLOSED';

export type PoLineStatus = 'OPEN' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';

export interface PoProductRef {
  id: string;
  sku: string;
  name: string;
  uom: string;
}

export interface PoLine {
  id: string;
  purchaseOrderId: string;
  productId: string;
  product?: PoProductRef;
  qtyOrdered: number;
  qtyReceived: number;
  unitPrice: number;
  expectedDate?: string | null;
  status: PoLineStatus;
  notes?: string | null;
}

export interface SupplierRef {
  id: string;
  name: string;
  code: string;
  currency?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier?: SupplierRef;
  status: PoStatus;
  currency: string;
  fxRate?: number | null;
  totalAmount: number;
  notes?: string | null;
  expectedDate?: string | null;
  requestedById?: string | null;
  createdById: string;
  approvedById?: string | null;
  approvedAt?: string | null;
  submittedAt?: string | null;
  sentAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: PoLine[];
  goodsReceipts?: GoodsReceipt[];
  createdBy?: { id: string; name: string };
  approvedBy?: { id: string; name: string };
  requestedBy?: { id: string; name: string };
}

export interface PoKpis {
  draft: number;
  pendingApproval: number;
  approved: number;
  sent: number;
  partiallyReceived: number;
  inTransit: number;
  receivedThisMonth: number;
  cancelled: number;
  cancelRate: number;
  openValue: number;
}

export type GrnStatus = 'POSTED' | 'REVERSED';
export type GrnQaStatus = 'PENDING' | 'RELEASED' | 'REJECTED' | 'QUARANTINED';

export interface LotRef {
  id: string;
  lotNumber: string;
  qaStatus: string;
  qtyReceived: number;
  qtyRemaining: number;
  expiryDate?: string | null;
}

export interface GoodsReceiptLine {
  id: string;
  receiptId: string;
  poLineId: string;
  poLine?: PoLine;
  lotId?: string | null;
  lot?: LotRef | null;
  qtyReceived: number;
  qaStatus: GrnQaStatus;
  qaNotes?: string | null;
  qaActionedAt?: string | null;
  qaActionedBy?: { id: string; name: string } | null;
}

export interface LandedCostAllocation {
  id: string;
  receiptId: string;
  costType: string;
  amount: number;
  allocationMethod: string;
  createdAt: string;
}

export interface GoodsReceipt {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  purchaseOrder?: PurchaseOrder;
  warehouseId: string;
  warehouse?: { id: string; name: string; code: string };
  receivedById: string;
  receivedBy?: { id: string; name: string };
  receivedAt: string;
  status: GrnStatus;
  fxRateAtReceipt?: number | null;
  notes?: string | null;
  reversedAt?: string | null;
  reversedById?: string | null;
  reversedBy?: { id: string; name: string } | null;
  reverseReason?: string | null;
  lines?: GoodsReceiptLine[];
  landedCosts?: LandedCostAllocation[];
  _count?: { lines: number };
}

export interface PoListResponse {
  rows: PurchaseOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface GrnListResponse {
  rows: GoodsReceipt[];
  total: number;
  limit: number;
  offset: number;
}

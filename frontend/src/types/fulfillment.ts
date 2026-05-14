// Section 6 — Fulfillment types

export type PaymentTerms = 'NET_15' | 'NET_30' | 'NET_60' | 'NET_90' | 'COD' | 'PREPAID';

export type SOStatus =
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'ALLOCATED'
  | 'PICKED'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED';

export type ShipmentStatus =
  | 'PENDING'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED'
  | 'VOIDED';

export interface CustomerContact {
  id: string;
  customerId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  taxId?: string | null;
  currency: string;
  paymentTerms: PaymentTerms;
  creditLimit?: number | string | null;
  notes?: string | null;
  isActive: boolean;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  contacts?: CustomerContact[];
  createdBy?: { id: string; name: string } | null;
  _count?: { salesOrders?: number; contacts?: number };
}

export interface CustomerListResponse {
  total: number;
  items: Customer[];
}

export interface ProductRef {
  id: string;
  sku: string;
  name: string;
  uom?: string | null;
  type?: string | null;
  sellingPrice?: number | string | null;
}

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
}

export interface SalesOrderLine {
  id: string;
  salesOrderId: string;
  productId: string;
  qty: number;
  qtyAllocated: number;
  qtyPicked: number;
  qtyShipped: number;
  unitPrice: number | string;
  status: string;
  notes?: string | null;
  product?: ProductRef;
}

export interface ShipmentLineRef {
  id: string;
  shipmentId: string;
  productId: string;
  salesOrderLineId?: string | null;
  qty: number;
  unitPrice?: number | string | null;
  unitCost?: number | string | null;
  product?: ProductRef;
}

export interface TrackingEventRef {
  id: string;
  shipmentId: string;
  eventType: string;
  occurredAt: string;
  location?: string | null;
}

export interface Shipment {
  id: string;
  shipmentNumber: string;
  salesOrderId?: string | null;
  warehouseId?: string | null;
  carrier?: string | null;
  carrierRef?: string | null;
  trackingNumber?: string | null;
  status: ShipmentStatus;
  dispatchedAt?: string | null;
  estimatedArrival?: string | null;
  deliveredAt?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  notes?: string | null;
  labelKey?: string | null;
  lastTrackingEventId?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  salesOrder?: { id: string; orderNumber: string; status: SOStatus; customerName: string; customerId?: string | null };
  warehouse?: WarehouseRef;
  createdBy?: { id: string; name: string };
  lines?: ShipmentLineRef[];
  trackingEvents?: TrackingEventRef[];
  _count?: { lines?: number; trackingEvents?: number };
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  source: string;
  externalId?: string | null;
  customerId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  warehouseId?: string | null;
  status: SOStatus;
  totalAmount: number | string;
  currency: string;
  notes?: string | null;
  createdById?: string | null;
  confirmedAt?: string | null;
  allocatedAt?: string | null;
  pickedAt?: string | null;
  packedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  orderedAt: string;
  createdAt: string;
  updatedAt: string;
  customer?: Customer | null;
  warehouse?: WarehouseRef | null;
  createdBy?: { id: string; name: string } | null;
  lines?: SalesOrderLine[];
  shipments?: Shipment[];
}

export interface SOListResponse {
  total: number;
  items: SalesOrder[];
}

export interface ShipmentListResponse {
  total: number;
  items: Shipment[];
}

export interface SOKpis {
  total: number;
  open: number;
  readyToShip: number;
  inFulfillment: number;
  shipped: number;
  byStatus: Record<SOStatus, { count: number; totalAmount: number }>;
}

export interface CreateSOLine {
  productId: string;
  qty: number;
  unitPrice?: number;
  notes?: string;
}

export interface CreateSOPayload {
  customerId: string;
  warehouseId: string;
  currency?: string;
  notes?: string;
  lines: CreateSOLine[];
}

export interface ShipPayload {
  carrier?: string;
  trackingNumber?: string;
  estimatedArrival?: string;
  markInTransit?: boolean;
  notes?: string;
  lines?: Array<{ lineId: string; qty: number }>;
}

export interface PickPayload {
  linePicks: Array<{ lineId: string; qtyPicked: number }>;
}

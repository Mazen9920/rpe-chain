import type { SupplierRef } from './procurement';

export type InvoiceStatus =
  | 'DRAFT'
  | 'RECEIVED'
  | 'MATCHED'
  | 'EXCEPTION'
  | 'APPROVED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOID';

export type InvoiceType = 'STANDARD' | 'CREDIT_NOTE' | 'DEBIT_NOTE';

export type MatchStatus =
  | 'PENDING'
  | 'MATCHED'
  | 'QTY_VARIANCE'
  | 'PRICE_VARIANCE'
  | 'NO_PO'
  | 'NO_RECEIPT';

export type PaymentMethod = 'BANK_TRANSFER' | 'CHECK' | 'WIRE' | 'CARD' | 'CASH' | 'OTHER';
export type PaymentStatus = 'POSTED' | 'VOIDED';

export type AgingBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | 'OVER_90';

export interface UserRef {
  id: string;
  name: string;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  poLineId?: string | null;
  grnLineId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  matchStatus: MatchStatus;
  qtyVariance?: number | null;
  priceVariance?: number | null;
  poLine?: { id: string; qtyOrdered: number; unitPrice: number; product?: { id: string; sku: string; name: string } };
  grnLine?: { id: string; qtyReceived: number; lot?: { lotNumber: string } | null };
}

export interface PaymentApplicationRef {
  id: string;
  paymentId: string;
  invoiceId: string;
  amountApplied: number;
  payment?: Payment;
  invoice?: {
    id: string;
    invoiceNumber: string;
    amount: number;
    paidAmount: number;
    status: InvoiceStatus;
    currency: string;
    dueDate?: string | null;
  };
}

export interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplier?: SupplierRef;
  purchaseOrderId?: string | null;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  currency: string;
  fxRate?: number | null;
  subtotal: number;
  taxAmount: number;
  amount: number;
  matchedAmount: number;
  varianceAmount: number;
  paidAmount: number;
  invoiceDate: string;
  dueDate?: string | null;
  receivedAt?: string | null;
  matchedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  holdReason?: string | null;
  notes?: string | null;
  attachmentUrl?: string | null;
  creditedInvoiceId?: string | null;
  creditedInvoice?: SupplierInvoice | null;
  creditNotes?: SupplierInvoice[];
  createdById?: string | null;
  createdBy?: UserRef | null;
  approvedById?: string | null;
  approvedBy?: UserRef | null;
  voidedById?: string | null;
  voidedBy?: UserRef | null;
  lines?: InvoiceLine[];
  paymentApplications?: PaymentApplicationRef[];
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  supplierId: string;
  supplier?: SupplierRef;
  amount: number;
  currency: string;
  fxRate?: number | null;
  paymentDate: string;
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string | null;
  notes?: string | null;
  createdById?: string | null;
  createdBy?: UserRef | null;
  voidedById?: string | null;
  voidedBy?: UserRef | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  applications?: PaymentApplicationRef[];
  createdAt: string;
}

export interface InvoiceKpis {
  total: number;
  byStatus: Record<InvoiceStatus, number>;
  openLiability: number;
  exceptionCount: number;
}

export interface AgingRow {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplier?: SupplierRef;
  amount: number;
  paidAmount: number;
  openBalance: number;
  dueDate?: string | null;
  agingBucket: AgingBucket;
  daysOverdue: number;
}

export interface AgingSupplierSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  CURRENT: number;
  '1_30': number;
  '31_60': number;
  '61_90': number;
  OVER_90: number;
  total: number;
}

export interface AgingSummary {
  asOf: string;
  buckets: AgingBucket[];
  suppliers: AgingSupplierSummary[];
  totals: { CURRENT: number; '1_30': number; '31_60': number; '61_90': number; OVER_90: number; total: number };
}

export interface SupplierStatement {
  asOf: string;
  supplier: { id: string; name: string; code: string; currency: string; paymentTerms?: string | null };
  ledger: Array<{
    id: string;
    entryType: string;
    amount: number;
    balance: number;
    description?: string | null;
    createdAt: string;
    invoice?: { id: string; invoiceNumber: string } | null;
    payment?: { id: string; reference?: string | null } | null;
  }>;
  openInvoices: AgingRow[];
  outstanding: number;
}

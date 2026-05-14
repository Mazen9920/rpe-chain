import type { Customer } from './fulfillment';

type CustomerRef = Pick<Customer, 'id' | 'code' | 'name' | 'currency'> & Partial<Customer>;

export type CustomerInvoiceStatus = 'DRAFT' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type InvoiceType = 'STANDARD' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
export type CustomerPaymentMethod = 'BANK_TRANSFER' | 'CHECK' | 'CARD' | 'CASH' | 'OTHER';
export type PaymentStatus = 'POSTED' | 'VOIDED';
export type AgingBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | 'OVER_90';

export interface UserRef { id: string; name: string }

export interface CustomerInvoiceLine {
  id: string;
  invoiceId: string;
  productId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  product?: { id: string; sku: string; name: string } | null;
}

export interface CustomerPaymentApplicationRef {
  id: string;
  paymentId: string;
  invoiceId: string;
  amountApplied: number;
  payment?: CustomerPayment;
  invoice?: {
    id: string;
    invoiceNumber: string;
    amount: number;
    paidAmount: number;
    status: CustomerInvoiceStatus;
    currency: string;
    dueDate?: string | null;
  };
}

export interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer?: CustomerRef;
  salesOrderId?: string | null;
  shipmentId?: string | null;
  invoiceType: InvoiceType;
  status: CustomerInvoiceStatus;
  currency: string;
  fxRate?: number | null;
  subtotal: number;
  taxAmount: number;
  amount: number;
  paidAmount: number;
  invoiceDate: string;
  dueDate: string;
  postedAt?: string | null;
  paidAt?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  notes?: string | null;
  creditedInvoiceId?: string | null;
  creditedInvoice?: CustomerInvoice | null;
  creditNotes?: CustomerInvoice[];
  createdById?: string | null;
  createdBy?: UserRef | null;
  voidedById?: string | null;
  voidedBy?: UserRef | null;
  lines?: CustomerInvoiceLine[];
  paymentApplications?: CustomerPaymentApplicationRef[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPayment {
  id: string;
  customerId: string;
  customer?: CustomerRef;
  amount: number;
  currency: string;
  fxRate?: number | null;
  paymentDate: string;
  method: CustomerPaymentMethod;
  status: PaymentStatus;
  reference?: string | null;
  notes?: string | null;
  createdById?: string | null;
  createdBy?: UserRef | null;
  voidedById?: string | null;
  voidedBy?: UserRef | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  applications?: CustomerPaymentApplicationRef[];
  createdAt: string;
}

export interface ArInvoiceKpis {
  total: number;
  byStatus: Record<CustomerInvoiceStatus, number>;
  openReceivable: number;
}

export interface ArAgingRow {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer?: CustomerRef;
  amount: number;
  paidAmount: number;
  openBalance: number;
  dueDate: string;
  agingBucket: AgingBucket;
  daysOverdue: number;
  currency: string;
}

export interface ArAgingCustomerSummary {
  customerId: string;
  customerName: string;
  customerCode: string;
  CURRENT: number;
  '1_30': number;
  '31_60': number;
  '61_90': number;
  OVER_90: number;
  total: number;
}

export interface ArAgingSummary {
  asOf: string;
  reportingCurrency: string;
  buckets: AgingBucket[];
  customers: ArAgingCustomerSummary[];
  totals: { CURRENT: number; '1_30': number; '31_60': number; '61_90': number; OVER_90: number; total: number };
  byCurrency: Record<string, number>;
}

export interface CustomerStatement {
  asOf: string;
  customer: { id: string; name: string; code: string; currency: string; paymentTerms?: string | null };
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
  openInvoices: ArAgingRow[];
  outstanding: number;
}

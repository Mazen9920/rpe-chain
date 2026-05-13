export type SupplierApprovalStatus = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'PREFERRED' | 'BLOCKED';
export type RiskRating = 'LOW' | 'MEDIUM' | 'HIGH';
export type PaymentTerms = 'NET15' | 'NET30' | 'NET45' | 'NET60' | 'NET90' | 'COD' | 'PREPAID';
export type SupplierDocumentCategory =
  | 'CONTRACT'
  | 'NDA'
  | 'ISO_CERT'
  | 'INSURANCE'
  | 'TAX_CERT'
  | 'BANK_LETTER'
  | 'OTHER';
export type PerformanceSource = 'MANUAL' | 'AUTO';

export interface SupplierCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  createdAt: string;
  _count?: { supplierLinks: number };
}

export interface SupplierCategoryLink {
  supplierId: string;
  categoryId: string;
  createdAt: string;
  category?: SupplierCategory;
}

export interface SupplierContact {
  id: string;
  supplierId: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface SupplierDocument {
  id: string;
  supplierId: string;
  category: SupplierDocumentCategory;
  title: string;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt?: string | null;
  uploadedById?: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

export interface SupplierPerformance {
  id: string;
  supplierId: string;
  periodStart: string;
  periodEnd: string;
  onTimeRate?: number | null;
  fillRate?: number | null;
  defectRate?: number | null;
  leadTimeMean?: number | null;
  leadTimeStd?: number | null;
  source: PerformanceSource;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  overallScore?: number | null;
}

export interface SupplierProductLink {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku?: string | null;
  agreedPrice: number | string;
  moq: number;
  leadTimeDays?: number | null;
  priority: 1 | 2 | 3;
  product?: { id: string; sku: string; name: string; type?: string; costPrice?: number | string; uom?: string };
  supplier?: Pick<Supplier, 'id' | 'code' | 'name' | 'country' | 'leadTimeDays' | 'paymentTerms' | 'currency' | 'approvalStatus' | 'riskRating'>;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  taxRegistered: boolean;
  currency: string;
  paymentTerms: PaymentTerms;
  incoterms?: string | null;
  leadTimeDays: number;

  primaryContact?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;

  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;

  bankName?: string | null;
  bankAccountNumber?: string | null;
  iban?: string | null;
  swift?: string | null;

  riskRating?: RiskRating | null;
  approvalStatus: SupplierApprovalStatus;
  notes?: string | null;

  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;

  contacts?: SupplierContact[];
  categoryLinks?: SupplierCategoryLink[];
  supplierProducts?: SupplierProductLink[];
  documents?: SupplierDocument[];
  performance?: SupplierPerformance[];
  purchaseOrders?: Array<{ id: string; poNumber?: string; status?: string; createdAt?: string }>;
  _count?: { supplierProducts?: number; contacts?: number; purchaseOrders?: number };
}

export interface SupplierKpis {
  active: number;
  preferred: number;
  underReview: number;
  blocked: number;
  documentsExpiringSoon: number;
}

export interface SupplierListResponse {
  rows: Supplier[];
  total: number;
}

export interface SupplierActivityEntry {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  payload?: unknown;
  sourceIp?: string | null;
  occurredAt: string;
}

export interface RecomputePerformanceResult {
  status: 'no_data' | 'pending_implementation' | 'ok';
  message: string;
  poCount?: number;
  grnCount?: number;
  requestedPeriod?: { periodStart?: string; periodEnd?: string };
}

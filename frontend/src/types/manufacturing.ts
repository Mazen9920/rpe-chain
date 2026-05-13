/**
 * Manufacturing types — BOMs, cost rollup, production orders.
 */

export type ProductType = 'RAW' | 'COMPONENT' | 'FINISHED' | 'PACKAGING';

export type ProductionOrderStatus =
  | 'DRAFT'
  | 'RELEASED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface BomLine {
  id: string;
  bomId: string;
  componentProductId: string;
  qtyPer: number | string;
  uom: string;
  scrapFactorPct: number | string;
  position: number;
  notes: string | null;
  componentProduct?: {
    id: string;
    sku: string;
    name: string;
    uom: string;
    type?: ProductType;
    isManufactured?: boolean;
  };
}

export interface BillOfMaterials {
  id: string;
  productId: string;
  version: number;
  isActive: boolean;
  notes: string | null;
  createdById: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; sku: string; name: string; uom?: string; type?: ProductType };
  lines?: BomLine[];
  createdBy?: { id: string; name: string } | null;
  _count?: { lines: number };
}

export interface RollupNode {
  productId: string;
  sku: string;
  name: string;
  isLeaf: boolean;
  qtyPer: number;
  unitCost: number;
  labor: number;
  overhead: number;
  lineCost: number;
  components: RollupNode[];
  collapsedReason?: string;
}

export interface CostRollupResponse {
  mode: 'standard' | 'fifo';
  warehouseId: string | null;
  tree: RollupNode;
  totalUnitCost: number;
}

export interface ProductionOrderLine {
  id: string;
  productionOrderId: string;
  componentProductId: string;
  plannedQty: number | string;
  consumedQty: number | string;
  unitCostSnapshot: number | string | null;
  uom: string;
  componentProduct?: { id: string; sku: string; name: string; uom: string };
}

export interface ProductionOutput {
  id: string;
  productionOrderId: string;
  lotId: string;
  qty: number;
  totalComponentCost: number | string;
  laborCost: number | string;
  overheadCost: number | string;
  unitCost: number | string;
  createdAt: string;
  lot?: { id: string; lotNumber: string; qtyRemaining: number; expiryDate: string | null };
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  productId: string;
  bomId: string;
  warehouseId: string;
  plannedQty: number;
  producedQty: number;
  scrapQty: number;
  status: ProductionOrderStatus;
  plannedAt: string;
  releasedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdById: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; sku: string; name: string; uom: string; standardLaborCost?: number | string; standardOverheadCost?: number | string };
  warehouse?: { id: string; code: string; name: string; currency?: string };
  bom?: { id: string; version: number };
  createdBy?: { id: string; name: string } | null;
  lines?: ProductionOrderLine[];
  outputs?: ProductionOutput[];
  consumptions?: Array<{ id: string; lotId: string; qtyConsumed: number; unitCost: number | string; lot?: { id: string; lotNumber: string } }>;
  _count?: { lines: number; outputs: number };
}

export interface PlanResponse {
  order: ProductionOrder;
  shortfalls: Array<{
    componentProductId: string;
    sku?: string;
    name?: string;
    required: number;
    onHand: number;
    shortBy: number;
  }>;
}

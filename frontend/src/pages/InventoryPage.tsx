import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowRightLeft, Boxes, ClipboardCheck, ClipboardList, FileBarChart2, Layers, MapPinned, Package, Warehouse } from 'lucide-react';
import { inventoryService } from '../services';
import type { InventoryTab } from '../types/inventory';
import AlertsTab from './inventory/AlertsTab';
import CycleCountsTab from './inventory/CycleCountsTab';
import LocationsTab from './inventory/LocationsTab';
import LotsTab from './inventory/LotsTab';
import MovementsTab from './inventory/MovementsTab';
import ProductsTab from './inventory/ProductsTab';
import ReorderTab from './inventory/ReorderTab';
import ReportsTab from './inventory/ReportsTab';
import StockByWarehouseTab from './inventory/StockByWarehouseTab';
import TransfersTab from './inventory/TransfersTab';
import WarehouseManageModal from './inventory/WarehouseManageModal';

const tabs: Array<{ id: InventoryTab; label: string; icon: React.ElementType }> = [
  { id: 'products', label: 'Products', icon: Package },
  { id: 'locations', label: 'Locations', icon: MapPinned },
  { id: 'stock', label: 'Stock by Warehouse', icon: Boxes },
  { id: 'lots', label: 'Lots', icon: Layers },
  { id: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
  { id: 'counts', label: 'Cycle Counts', icon: ClipboardCheck },
  { id: 'movements', label: 'Movements', icon: ClipboardList },
  { id: 'reorder', label: 'Reorder', icon: AlertTriangle },
  { id: 'alerts', label: 'Alerts', icon: AlertCircle },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
];

function normalizeTab(value: string | null): InventoryTab {
  return tabs.some((tab) => tab.id === value) ? (value as InventoryTab) : 'products';
}

export default function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const activeTab = normalizeTab(params.get('tab'));

  const { data: summary } = useQuery<{
    totalSkus: number;
    totalValue: number;
    lowStockCount: number;
    expiringSoonCount: number;
    quarantinedQty: number;
    openTransfers: number;
    openCycleCounts: number;
  }>({
    queryKey: ['inventory', 'summary'],
    queryFn: inventoryService.summary,
    refetchInterval: 5 * 60 * 1000,
  });

  const activeTitle = useMemo(() => tabs.find((tab) => tab.id === activeTab)?.label ?? 'Products', [activeTab]);

  const changeTab = (tab: InventoryTab) => {
    setParams((current) => {
      current.set('tab', tab);
      return current;
    });
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Inventory</h2>
          <p className="text-slate-500 text-sm">{activeTitle} · RPE stock control, lots, and movement traceability</p>
        </div>
        <button
          onClick={() => setWarehouseModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <Warehouse size={16} />
          Manage Warehouses
        </button>
      </div>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {[
          { label: 'Total SKUs',       value: summary?.totalSkus ?? '—',                                  tone: 'text-slate-700' },
          { label: 'Inventory Value',  value: summary ? `$${summary.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', tone: 'text-slate-700' },
          { label: 'Low Stock',        value: summary?.lowStockCount ?? '—',     tone: (summary?.lowStockCount ?? 0) > 0 ? 'text-amber-600' : 'text-slate-700' },
          { label: 'Expiring ≤90d',    value: summary?.expiringSoonCount ?? '—', tone: (summary?.expiringSoonCount ?? 0) > 0 ? 'text-orange-600' : 'text-slate-700' },
          { label: 'Quarantined Qty',  value: summary?.quarantinedQty ?? '—',    tone: (summary?.quarantinedQty ?? 0) > 0 ? 'text-red-600' : 'text-slate-700' },
          { label: 'Open Transfers',   value: summary?.openTransfers ?? '—',     tone: 'text-slate-700' },
          { label: 'Open Counts',      value: summary?.openCycleCounts ?? '—',   tone: 'text-slate-700' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className={`mt-1 text-lg font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 flex overflow-x-auto rounded-xl border border-slate-100 bg-white p-1 shadow-sm">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = id === activeTab;
          return (
            <button
              key={id}
              onClick={() => changeTab(id)}
              className={`inline-flex min-w-max items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${isActive ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === 'products' ? <ProductsTab /> : null}
      {activeTab === 'locations' ? <LocationsTab /> : null}
      {activeTab === 'stock' ? <StockByWarehouseTab /> : null}
      {activeTab === 'lots' ? <LotsTab /> : null}
      {activeTab === 'transfers' ? <TransfersTab /> : null}
      {activeTab === 'counts' ? <CycleCountsTab /> : null}
      {activeTab === 'movements' ? <MovementsTab /> : null}
      {activeTab === 'reorder' ? <ReorderTab /> : null}
      {activeTab === 'alerts' ? <AlertsTab /> : null}
      {activeTab === 'reports' ? <ReportsTab /> : null}

      <WarehouseManageModal open={warehouseModalOpen} onClose={() => setWarehouseModalOpen(false)} />

      <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
        <MapPinned size={14} />
        Warehouse data follows the active schema: code, name, address, and tax jurisdiction.
      </div>
    </div>
  );
}

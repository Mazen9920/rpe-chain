/**
 * ManufacturingPage — Section 2 hub.
 * Tabs: BOMs · Cost Rollup · Planner · Orders.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Factory, GitBranch, Calculator, ClipboardList, Hammer } from 'lucide-react';
import { bomService, productionService } from '../services';
import type { BillOfMaterials, ProductionOrder } from '../types/manufacturing';
import BomsTab from './manufacturing/BomsTab';
import CostRollupTab from './manufacturing/CostRollupTab';
import PlannerTab from './manufacturing/PlannerTab';
import OrdersTab from './manufacturing/OrdersTab';

type ManufacturingTab = 'boms' | 'cost' | 'planner' | 'orders';

const tabs: Array<{ id: ManufacturingTab; label: string; icon: React.ElementType }> = [
  { id: 'boms', label: 'Bills of Materials', icon: GitBranch },
  { id: 'cost', label: 'Cost Rollup', icon: Calculator },
  { id: 'planner', label: 'Production Planner', icon: Hammer },
  { id: 'orders', label: 'Production Orders', icon: ClipboardList },
];

function normalizeTab(value: string | null): ManufacturingTab {
  return tabs.some((t) => t.id === value) ? (value as ManufacturingTab) : 'boms';
}

export default function ManufacturingPage() {
  const [params, setParams] = useSearchParams();
  const activeTab = normalizeTab(params.get('tab'));

  const { data: boms = [] } = useQuery<BillOfMaterials[]>({
    queryKey: ['manufacturing', 'boms'],
    queryFn: () => bomService.list(),
  });

  const { data: orders = [] } = useQuery<ProductionOrder[]>({
    queryKey: ['manufacturing', 'orders'],
    queryFn: () => productionService.list(),
  });

  const summary = useMemo(() => {
    const activeBoms = boms.filter((b) => b.isActive).length;
    const open = orders.filter((o) => ['DRAFT', 'RELEASED', 'IN_PROGRESS'].includes(o.status)).length;
    const inProgressQty = orders.filter((o) => o.status === 'IN_PROGRESS').reduce((s, o) => s + o.plannedQty, 0);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const completedThisMonth = orders.filter((o) => o.status === 'COMPLETED' && o.completedAt && new Date(o.completedAt) >= monthStart).length;
    return { activeBoms, open, inProgressQty, completedThisMonth };
  }, [boms, orders]);

  const changeTab = (tab: ManufacturingTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const activeTitle = tabs.find((t) => t.id === activeTab)?.label ?? '';

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Factory size={20} /> Manufacturing</h2>
          <p className="text-slate-500 text-sm">{activeTitle} · BOM versioning, cost rollup, and production order workflow</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Active BOMs',         value: summary.activeBoms,         tone: 'text-slate-700' },
          { label: 'Open Orders',         value: summary.open,               tone: summary.open > 0 ? 'text-blue-600' : 'text-slate-700' },
          { label: 'In-Progress Qty',     value: summary.inProgressQty,      tone: 'text-amber-600' },
          { label: 'Completed This Month', value: summary.completedThisMonth, tone: 'text-green-600' },
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

      {activeTab === 'boms' ? <BomsTab /> : null}
      {activeTab === 'cost' ? <CostRollupTab /> : null}
      {activeTab === 'planner' ? <PlannerTab onCreated={() => changeTab('orders')} /> : null}
      {activeTab === 'orders' ? <OrdersTab /> : null}
    </div>
  );
}

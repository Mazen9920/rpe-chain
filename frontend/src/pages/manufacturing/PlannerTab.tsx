/**
 * PlannerTab — pick a finished good + qty + warehouse, preview shortfalls, create DRAFT order.
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Hammer, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { productionService, productService, inventoryService, bomService } from '../../services';
import type { Product, Warehouse } from '../../types/inventory';
import type { BillOfMaterials, PlanResponse } from '../../types/manufacturing';

interface Props { onCreated: () => void; }

export default function PlannerTab({ onCreated }: Props) {
  const [productId, setProductId] = useState('');
  const [plannedQty, setPlannedQty] = useState<number>(1);
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: () => productService.list() });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['warehouses'], queryFn: () => inventoryService.warehouses() });
  const { data: boms = [] } = useQuery<BillOfMaterials[]>({
    queryKey: ['boms-active', productId],
    queryFn: () => bomService.list({ productId }),
    enabled: Boolean(productId),
  });
  const activeBom = boms.find((b) => b.isActive && !b.archivedAt) || null;

  const plan = useMutation({
    mutationFn: () => productionService.plan({ productId, plannedQty, warehouseId, notes: notes || undefined }),
    onSuccess: (r: PlanResponse) => { setResult(r); setError(null); },
    onError: (e: unknown) => { setError(e instanceof Error ? e.message : 'Plan failed'); setResult(null); },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Finished Good</label>
            <select value={productId} onChange={(e) => { setProductId(e.target.value); setResult(null); }} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
            {productId && !activeBom && <p className="mt-1 text-xs text-rose-600">No active BOM for this product.</p>}
            {activeBom && <p className="mt-1 text-xs text-slate-400">Using BOM v{activeBom.version}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Planned Qty</label>
            <input type="number" min={1} step={1} value={plannedQty} onChange={(e) => setPlannedQty(parseInt(e.target.value, 10) || 0)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {error && <span className="text-sm text-rose-600">{error}</span>}
          <button
            disabled={!productId || !warehouseId || !plannedQty || !activeBom || plan.isPending}
            onClick={() => plan.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            <Hammer size={16} /> {plan.isPending ? 'Planning…' : 'Create Draft Order'}
          </button>
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Order {result.order.orderNumber} created (DRAFT)</h4>
              <p className="text-xs text-slate-500">Review shortfalls below before releasing.</p>
            </div>
            <button onClick={onCreated} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">View in Orders →</button>
          </div>

          {result.shortfalls.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
              <CheckCircle2 size={16} /> All components are available in stock.
            </div>
          ) : (
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700"><AlertTriangle size={16} /> {result.shortfalls.length} component(s) short</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2 text-left">SKU</th><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-right">Required</th><th className="px-3 py-2 text-right">On Hand</th><th className="px-3 py-2 text-right">Short By</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.shortfalls.map((s) => (
                    <tr key={s.componentProductId}>
                      <td className="px-3 py-2 font-mono text-xs">{s.sku || '—'}</td>
                      <td className="px-3 py-2">{s.name || '—'}</td>
                      <td className="px-3 py-2 text-right">{s.required.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td className="px-3 py-2 text-right">{s.onHand}</td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-600">{s.shortBy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

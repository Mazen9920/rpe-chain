/**
 * ReorderTab — Slice 6: Reorder Recommendations
 * Shows all products at or below their reorder point across all warehouses.
 * Columns: Product, Warehouse, On Hand, Reorder Point, Shortfall, Reorder Qty, Suggested Supplier
 * Actions: Dismiss (session-only hide) — full PO creation is handled in the Purchasing section.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PackageSearch } from 'lucide-react';
import { inventoryService } from '../../services';

interface ReorderRow {
  productId: string;
  warehouseId: string;
  product: { id: string; sku: string; name: string; uom: string; reorderPoint: number | null; reorderQty: number | null };
  warehouse: { id: string; code: string; name: string; currency: string };
  onHand: number;
  reorderPoint: number | null;
  reorderQty: number | null;
  shortfall: number;
  suggestedSupplier: { id: string; code: string; name: string } | null;
  suggestedSupplierProduct: { unitCost: number | null; leadTimeDays: number | null } | null;
}

function urgencyClass(shortfall: number, reorderPoint: number | null): string {
  if (!reorderPoint) return '';
  const pct = shortfall / reorderPoint;
  if (pct >= 1) return 'bg-red-50';
  if (pct >= 0.5) return 'bg-amber-50';
  return '';
}

export default function ReorderTab() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading, isError, refetch } = useQuery<ReorderRow[]>({
    queryKey: ['inventory', 'reorder-recommendations'],
    queryFn: inventoryService.reorderRecommendations,
  });

  const visible = rows.filter((r) => !dismissed.has(`${r.productId}:${r.warehouseId}`));

  const dismiss = (productId: string, warehouseId: string) =>
    setDismissed((d) => new Set([...d, `${productId}:${warehouseId}`]));

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-600" />
          <div>
            <p className="font-semibold text-amber-800">
              {visible.length === 0 ? 'No reorder alerts' : `${visible.length} product${visible.length > 1 ? 's' : ''} need restocking`}
            </p>
            <p className="text-xs text-amber-700">Based on current on-hand vs. reorder point thresholds.</p>
          </div>
        </div>
        <button onClick={() => refetch()} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">Refresh</button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-slate-500">Calculating reorder recommendations…</div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-red-600">Failed to load recommendations.</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-slate-100 bg-white p-12 text-center">
          <PackageSearch size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600">All stock levels are above reorder points.</p>
          <p className="mt-1 text-sm text-slate-400">No action required right now.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {['Product', 'Warehouse', 'On Hand', 'Reorder Point', 'Shortfall', 'Reorder Qty', 'Supplier', 'Lead Time', 'Unit Cost', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => (
                  <tr key={`${row.productId}:${row.warehouseId}`} className={`hover:bg-slate-50 ${urgencyClass(row.shortfall, row.reorderPoint)}`}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{row.product.name}</p>
                      <p className="font-mono text-xs text-slate-400">{row.product.sku}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.warehouse.code} · {row.warehouse.name}</td>
                    <td className="px-5 py-3">
                      <span className={`font-semibold ${row.onHand <= 0 ? 'text-red-600' : 'text-amber-700'}`}>{row.onHand}</span>
                      <span className="ml-1 text-xs text-slate-400">{row.product.uom}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.reorderPoint ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">−{row.shortfall}</span>
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-700">{row.reorderQty ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.suggestedSupplier
                        ? <><p className="font-medium">{row.suggestedSupplier.name}</p><p className="text-xs text-slate-400">{row.suggestedSupplier.code}</p></>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.suggestedSupplierProduct?.leadTimeDays != null
                        ? `${row.suggestedSupplierProduct.leadTimeDays}d`
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.suggestedSupplierProduct?.unitCost != null
                        ? `${row.warehouse.currency} ${Number(row.suggestedSupplierProduct.unitCost).toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => dismiss(row.productId, row.warehouseId)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                      >Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dismissed.size > 0 ? (
        <p className="text-center text-xs text-slate-400">
          {dismissed.size} alert{dismissed.size > 1 ? 's' : ''} dismissed this session.{' '}
          <button onClick={() => setDismissed(new Set())} className="underline hover:text-slate-600">Show all</button>
        </p>
      ) : null}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { inventoryService } from '../../services';
import type { StockLevel } from '../../types/inventory';
import StockAdjustmentModal from './StockAdjustmentModal';

export default function StockByWarehouseTab() {
  const [adjusting, setAdjusting] = useState<{ productId?: string; warehouseId?: string } | null>(null);
  const { data: levels = [], isLoading, isError } = useQuery<StockLevel[]>({
    queryKey: ['inventory', 'stock-levels'],
    queryFn: () => inventoryService.stockLevels(),
  });

  const grouped = useMemo(() => {
    return levels.reduce<Record<string, StockLevel[]>>((acc, level) => {
      const key = level.warehouse?.code ?? 'Unknown';
      acc[key] = acc[key] ?? [];
      acc[key].push(level);
      return acc;
    }, {});
  }, [levels]);

  if (isError) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">Unable to load stock levels.</div>;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setAdjusting({})} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          <SlidersHorizontal size={16} />
          Adjust Stock
        </button>
      </div>
      <div className="space-y-4">
      {isLoading ? Array.from({ length: 2 }).map((_, index) => <div key={index} className="h-36 rounded-xl border border-slate-100 bg-white p-5 shadow-sm animate-pulse" />) : null}
      {!isLoading && Object.entries(grouped).length === 0 ? <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-500">No stock levels found.</div> : null}
      {Object.entries(grouped).map(([warehouseCode, rows]) => (
        <div key={warehouseCode} className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-800">{warehouseCode}</h3>
            <p className="text-sm text-slate-500">{rows[0]?.warehouse?.name ?? 'Warehouse'} · {rows.length} product positions</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {['SKU', 'Product', 'On Hand', 'Reserved', 'Available', 'Quarantine', 'Damaged', 'Status', 'Actions'].map((heading) => <th key={heading} className="text-left px-5 py-3 text-slate-500 font-medium">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((level) => {
                  const available = level.onHand - level.reserved - level.quarantine - level.damaged;
                  const lowStock = available <= (level.product?.reorderPoint ?? 0);
                  return (
                    <tr key={level.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{level.product?.sku ?? '—'}</td>
                      <td className="px-5 py-3 font-medium text-slate-800">{level.product?.name ?? 'Unknown product'}</td>
                      <td className="px-5 py-3 text-slate-600">{level.onHand}</td>
                      <td className="px-5 py-3 text-slate-600">{level.reserved}</td>
                      <td className="px-5 py-3 font-medium text-slate-700">{available}</td>
                      <td className="px-5 py-3 text-slate-600">{level.quarantine}</td>
                      <td className="px-5 py-3 text-slate-600">{level.damaged}</td>
                      <td className="px-5 py-3">{lowStock ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Low</span> : <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">OK</span>}</td>
                      <td className="px-5 py-3">
                        <button onClick={() => setAdjusting({ productId: level.productId, warehouseId: level.warehouseId })} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                          <SlidersHorizontal size={13} /> Adjust
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      </div>
      <StockAdjustmentModal
        open={adjusting !== null}
        initialProductId={adjusting?.productId}
        initialWarehouseId={adjusting?.warehouseId}
        onClose={() => setAdjusting(null)}
      />
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { inventoryService } from '../../services';
import type { StockMovement } from '../../types/inventory';

export default function MovementsTab() {
  const { data: movements = [], isLoading, isError } = useQuery<StockMovement[]>({
    queryKey: ['inventory', 'movements'],
    queryFn: () => inventoryService.movements({ limit: 100 }),
  });

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="font-semibold text-slate-800">Movement Ledger</h3>
        <p className="text-sm text-slate-500">Latest 100 append-only stock movements.</p>
      </div>
      {isError ? <div className="px-5 py-8 text-sm text-red-600">Unable to load movements.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                {['Date', 'Product', 'Warehouse', 'Direction', 'Qty', 'Reason', 'Reference', 'Lot'].map((heading) => <th key={heading} className="text-left px-5 py-3 text-slate-500 font-medium">{heading}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? Array.from({ length: 5 }).map((_, row) => <tr key={row}>{Array.from({ length: 8 }).map((_, cell) => <td key={cell} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>) : movements.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">No movements found.</td></tr>
              ) : movements.map((movement) => (
                <tr key={movement.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-500">{new Date(movement.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{movement.product?.name ?? 'Unknown product'}</td>
                  <td className="px-5 py-3 text-slate-600">{movement.warehouse?.code ?? '—'}</td>
                  <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${movement.direction === 'IN' ? 'bg-green-100 text-green-700' : movement.direction === 'OUT' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{movement.direction}</span></td>
                  <td className="px-5 py-3 text-slate-600">{movement.qty}</td>
                  <td className="px-5 py-3 text-slate-600">{movement.reasonCode}</td>
                  <td className="px-5 py-3 text-slate-500">{movement.sourceDocType ? `${movement.sourceDocType} ${movement.sourceDocId ?? ''}` : '—'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{movement.lot?.lotNumber ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

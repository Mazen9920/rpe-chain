import { useQuery } from '@tanstack/react-query';
import { inventoryService } from '../../services';
import type { Lot } from '../../types/inventory';

function daysUntil(date?: string | null) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function expiryBadge(date?: string | null) {
  const days = daysUntil(date);
  if (days === null) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">No expiry</span>;
  if (days < 0) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Expired</span>;
  if (days < 30) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">{days} days</span>;
  if (days < 90) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">{days} days</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{days} days</span>;
}

export default function LotsTab() {
  const { data: lots = [], isLoading, isError } = useQuery<Lot[]>({
    queryKey: ['inventory', 'lots'],
    queryFn: () => inventoryService.lots(),
  });

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="font-semibold text-slate-800">Lots & Expiry</h3>
        <p className="text-sm text-slate-500">Open lots sorted by earliest expiry.</p>
      </div>
      {isError ? <div className="px-5 py-8 text-sm text-red-600">Unable to load lots.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                {['Lot', 'Product', 'Received', 'Received Qty', 'Remaining', 'QA', 'Expiry'].map((heading) => <th key={heading} className="text-left px-5 py-3 text-slate-500 font-medium">{heading}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? Array.from({ length: 5 }).map((_, row) => <tr key={row}>{Array.from({ length: 7 }).map((_, cell) => <td key={cell} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>) : lots.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">No active lots found.</td></tr>
              ) : lots.map((lot) => (
                <tr key={lot.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{lot.lotNumber}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{lot.product?.name ?? 'Unknown product'} <span className="font-mono text-xs text-slate-400">{lot.product?.sku}</span></td>
                  <td className="px-5 py-3 text-slate-600">{new Date(lot.receivedDate).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-slate-600">{lot.qtyReceived}</td>
                  <td className="px-5 py-3 font-medium text-slate-700">{lot.qtyRemaining}</td>
                  <td className="px-5 py-3 text-slate-600">{lot.qaStatus}</td>
                  <td className="px-5 py-3">{expiryBadge(lot.expiryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

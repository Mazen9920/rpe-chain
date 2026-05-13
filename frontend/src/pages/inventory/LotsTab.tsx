import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { inventoryService } from '../../services';
import type { Lot } from '../../types/inventory';
import LotQaModal from './LotQaModal';
import BarcodeInput, { LookupResult } from '../../components/BarcodeInput';

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

const QA_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  RELEASED: 'bg-green-100 text-green-700',
  QUARANTINED: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export default function LotsTab() {
  const [selectedLot, setSelectedLot] = useState<Lot | null>(null);
  const [search, setSearch] = useState('');

  const { data: lots = [], isLoading, isError } = useQuery<Lot[]>({
    queryKey: ['inventory', 'lots'],
    queryFn: () => inventoryService.lots(),
  });

  const handleScan = (result: LookupResult) => {
    if (result.type === 'LOT') {
      const lot = lots.find((l) => l.id === (result.entity.id as string));
      if (lot) setSelectedLot(lot);
    } else if (result.type === 'PRODUCT') {
      setSearch(result.entity.sku as string);
    }
  };

  const filtered = search
    ? lots.filter(
        (l) =>
          l.lotNumber.toLowerCase().includes(search.toLowerCase()) ||
          l.product?.sku?.toLowerCase().includes(search.toLowerCase()) ||
          l.product?.name?.toLowerCase().includes(search.toLowerCase()),
      )
    : lots;

  return (
    <div className="space-y-4">
      {/* Scan + search bar */}
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <p className="mb-1 text-xs font-medium text-slate-500">Scan lot / product</p>
            <BarcodeInput placeholder="Scan lot number or product SKU to find & open QA…" onResolve={handleScan} />
          </div>
          <div className="flex-1">
            <p className="mb-1 text-xs font-medium text-slate-500">Filter</p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lot / SKU / name…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

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
                  {['Lot', 'Product', 'Received', 'Recv Qty', 'Remaining', 'QA Status', 'Expiry', 'Actions'].map((heading) => <th key={heading} className="text-left px-5 py-3 text-slate-500 font-medium">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading
                  ? Array.from({ length: 5 }).map((_, row) => (
                      <tr key={row}>{Array.from({ length: 8 }).map((_, cell) => <td key={cell} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>
                    ))
                  : filtered.length === 0
                  ? <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">No lots found.</td></tr>
                  : filtered.map((lot) => (
                    <tr key={lot.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{lot.lotNumber}</td>
                      <td className="px-5 py-3 font-medium text-slate-800">
                        {lot.product?.name ?? 'Unknown'}{' '}
                        <span className="font-mono text-xs text-slate-400">{lot.product?.sku}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{new Date(lot.receivedDate).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-slate-600">{lot.qtyReceived}</td>
                      <td className="px-5 py-3 font-medium text-slate-700">{lot.qtyRemaining}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${QA_BADGE[lot.qaStatus ?? 'PENDING'] ?? 'bg-slate-100 text-slate-600'}`}>
                          {lot.qaStatus ?? 'PENDING'}
                        </span>
                      </td>
                      <td className="px-5 py-3">{expiryBadge(lot.expiryDate)}</td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => setSelectedLot(lot)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <ShieldCheck size={13} />QA Action
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedLot ? <LotQaModal lot={selectedLot} onClose={() => setSelectedLot(null)} /> : null}
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { shipmentService } from '../services';
import type { Shipment, ShipmentListResponse } from '../types/fulfillment';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  IN_TRANSIT: 'bg-blue-100 text-blue-700',
  OUT_FOR_DELIVERY: 'bg-indigo-100 text-indigo-700',
  DELIVERED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  RETURNED: 'bg-amber-100 text-amber-700',
  VOIDED: 'bg-slate-100 text-slate-500',
};

export default function ShipmentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', { search, status }],
    queryFn: () => shipmentService.list({ search: search || undefined, status: status || undefined }) as Promise<ShipmentListResponse>,
  });
  const items: Shipment[] = data?.items ?? [];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Shipments</h2>
        <p className="text-slate-500 text-sm">{data?.total ?? 0} shipments</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shipment # or tracking..." className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm">
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Shipment #', 'Order', 'Customer', 'Carrier', 'Tracking', 'Status', 'Created', ''].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium text-xs uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-400">No shipments</td></tr>
            ) : items.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs text-slate-700">{s.shipmentNumber}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.salesOrder?.orderNumber ?? '—'}</td>
                <td className="px-5 py-3 text-slate-700">{s.salesOrder?.customerName ?? '—'}</td>
                <td className="px-5 py-3 text-slate-600">{s.carrier ?? '—'}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.trackingNumber ?? '—'}</td>
                <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[s.status]}`}>{s.status}</span></td>
                <td className="px-5 py-3 text-slate-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right"><Link to={`/shipments/${s.id}`} className="text-indigo-600 hover:text-indigo-700 text-xs font-medium">View →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

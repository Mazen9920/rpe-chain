import { useQuery } from '@tanstack/react-query';
import { shipmentService } from '../services';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  DISPATCHED: 'bg-blue-100 text-blue-700',
  IN_TRANSIT: 'bg-indigo-100 text-indigo-700',
  DELIVERED: 'bg-green-100 text-green-700',
  RETURNED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
};

export default function ShipmentsPage() {
  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ['shipments'],
    queryFn: () => shipmentService.list(),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Shipments</h2>
        <p className="text-slate-500 text-sm">{shipments.length} shipments total</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['Shipment #', 'Carrier', 'Tracking', 'Status', 'Shipped', 'Est. Delivery'].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : shipments.length === 0
              ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-slate-400">No shipments yet</td>
                  </tr>
                )
              : (shipments as { id: string; shipmentNumber: string; carrier?: string; trackingNumber?: string; status: string; shippedAt?: string; estimatedDelivery?: string }[]).map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.shipmentNumber}</td>
                    <td className="px-5 py-3 text-slate-600">{s.carrier ?? '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.trackingNumber ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[s.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{s.shippedAt ? new Date(s.shippedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{s.estimatedDelivery ? new Date(s.estimatedDelivery).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

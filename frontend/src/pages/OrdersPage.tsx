import { useQuery } from '@tanstack/react-query';
import { purchaseOrderService } from '../services';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  SENT: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function OrdersPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => purchaseOrderService.list(),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Purchase Orders</h2>
        <p className="text-slate-500 text-sm">{orders.length} orders total</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['PO Number', 'Supplier', 'Status', 'Total', 'Currency', 'Order Date', 'Expected'].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : orders.length === 0
              ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-slate-400">No purchase orders yet</td>
                  </tr>
                )
              : (orders as { id: string; poNumber: string; status: string; totalAmount: number; currency: string; orderDate?: string; expectedDate?: string; supplier?: { name: string } }[]).map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{o.poNumber}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">{o.supplier?.name}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[o.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{Number(o.totalAmount).toLocaleString()}</td>
                    <td className="px-5 py-3 text-slate-600">{o.currency}</td>
                    <td className="px-5 py-3 text-slate-500">{o.orderDate ? new Date(o.orderDate).toLocaleDateString() : '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{o.expectedDate ? new Date(o.expectedDate).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

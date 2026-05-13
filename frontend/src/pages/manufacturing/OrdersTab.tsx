/**
 * OrdersTab — list production orders with status filter, click to open drawer with workflow actions.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { productionService } from '../../services';
import type { ProductionOrder, ProductionOrderStatus } from '../../types/manufacturing';
import OrderDrawer from './OrderDrawer';

const STATUS_TONE: Record<ProductionOrderStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  RELEASED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-rose-100 text-rose-600',
};

export default function OrdersTab() {
  const [status, setStatus] = useState<string>('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery<ProductionOrder[]>({
    queryKey: ['manufacturing', 'orders', status],
    queryFn: () => productionService.list({ status: status || undefined }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="RELEASED">Released</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            <ClipboardList className="mx-auto mb-2 text-slate-300" size={28} />
            No production orders.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Order #</th>
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-4 py-2 text-left">Warehouse</th>
                <th className="px-4 py-2 text-right">Planned</th>
                <th className="px-4 py-2 text-right">Produced</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{o.orderNumber}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-700">{o.product?.name}</div>
                    <div className="text-xs text-slate-400">{o.product?.sku}</div>
                  </td>
                  <td className="px-4 py-2 text-xs">{o.warehouse?.code}</td>
                  <td className="px-4 py-2 text-right">{o.plannedQty}</td>
                  <td className="px-4 py-2 text-right">{o.producedQty}{o.scrapQty ? <span className="ml-1 text-xs text-rose-600">(-{o.scrapQty})</span> : null}</td>
                  <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[o.status]}`}>{o.status}</span></td>
                  <td className="px-4 py-2 text-xs text-slate-500">{new Date(o.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

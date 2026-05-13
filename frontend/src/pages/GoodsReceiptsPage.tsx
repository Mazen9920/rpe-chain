import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { goodsReceiptService, inventoryService } from '../services';
import type { GrnListResponse } from '../types/procurement';

export default function GoodsReceiptsPage() {
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState('');

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-active'],
    queryFn: () => inventoryService.warehouses(),
  });
  const whList = (warehouses ?? []) as { id: string; name: string; code: string }[];

  const { data, isLoading } = useQuery<GrnListResponse>({
    queryKey: ['goods-receipts', { warehouseId, status }],
    queryFn: () => goodsReceiptService.list({
      warehouseId: warehouseId || undefined,
      status: status || undefined,
      limit: 100,
    }),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Goods Receipts</h2>
        <p className="text-sm text-slate-500">{data?.total ?? 0} receipts total</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-md text-sm">
          <option value="">All warehouses</option>
          {whList.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-md text-sm">
          <option value="">All statuses</option>
          <option value="RECEIVED">RECEIVED</option>
          <option value="REVERSED">REVERSED</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>{['Receipt #', 'PO', 'Supplier', 'Warehouse', 'Status', 'Received', 'Lines'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">No receipts yet</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link to={`/goods-receipts/${r.id}`} className="text-blue-600 hover:underline">{r.receiptNumber}</Link>
                </td>
                <td className="px-5 py-3 font-mono text-xs">
                  <Link to={`/orders/${r.purchaseOrderId}`} className="text-slate-700 hover:underline">{r.purchaseOrder?.poNumber}</Link>
                </td>
                <td className="px-5 py-3 text-slate-700">{r.purchaseOrder?.supplier?.name ?? '—'}</td>
                <td className="px-5 py-3 text-slate-700">{r.warehouse?.name ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${r.status === 'REVERSED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-500">{new Date(r.receivedAt).toLocaleString()}</td>
                <td className="px-5 py-3 text-slate-500">{r._count?.lines ?? r.lines?.length ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

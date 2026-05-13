import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, CheckCircle, Ban } from 'lucide-react';
import { shipmentService } from '../services';
import type { Shipment } from '../types/fulfillment';
import { useAuthStore } from '../stores/authStore';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  IN_TRANSIT: 'bg-blue-100 text-blue-700',
  OUT_FOR_DELIVERY: 'bg-indigo-100 text-indigo-700',
  DELIVERED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  RETURNED: 'bg-amber-100 text-amber-700',
  VOIDED: 'bg-slate-100 text-slate-500',
};

export default function ShipmentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const { data: s, isLoading } = useQuery({
    queryKey: ['shipment', id],
    queryFn: () => shipmentService.getById(id) as Promise<Shipment>,
    enabled: !!id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['shipment', id] });
  const handleErr = (e: { response?: { data?: { message?: string; error?: string } } }) =>
    setErr(e.response?.data?.message || e.response?.data?.error || 'Action failed');

  const deliver = useMutation({ mutationFn: () => shipmentService.deliver(id), onSuccess: invalidate, onError: handleErr });
  const voidMut = useMutation({ mutationFn: (reason: string) => shipmentService.void(id, reason), onSuccess: invalidate, onError: handleErr });

  if (isLoading || !s) return <div className="p-6 text-slate-400">Loading...</div>;

  const canDeliver = ['PENDING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(s.status);
  const canVoid = user?.role === 'ADMIN' && !['VOIDED', 'DELIVERED'].includes(s.status);

  return (
    <div className="p-6 max-w-5xl">
      <Link to="/shipments" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft size={14} /> Back to shipments
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-mono text-xs text-slate-500">{s.shipmentNumber}</div>
            <h2 className="text-2xl font-bold text-slate-800">Shipment</h2>
            {s.salesOrder && (
              <Link to={`/sales-orders/${s.salesOrderId}`} className="text-sm text-indigo-600 hover:underline">{s.salesOrder.orderNumber} — {s.salesOrder.customerName}</Link>
            )}
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[s.status]}`}>{s.status}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Carrier" value={s.carrier} />
          <Stat label="Tracking" value={s.trackingNumber} />
          <Stat label="Warehouse" value={s.warehouse?.code} />
          <Stat label="Created by" value={s.createdBy?.name} />
          <Stat label="Dispatched" value={s.dispatchedAt ? new Date(s.dispatchedAt).toLocaleString() : null} />
          <Stat label="Estimated" value={s.estimatedArrival ? new Date(s.estimatedArrival).toLocaleDateString() : null} />
          <Stat label="Delivered" value={s.deliveredAt ? new Date(s.deliveredAt).toLocaleString() : null} />
          {s.voidedAt && <Stat label="Voided" value={`${new Date(s.voidedAt).toLocaleString()}${s.voidReason ? ` — ${s.voidReason}` : ''}`} />}
        </div>
        {s.notes && <div className="mt-4 text-sm"><div className="text-xs text-slate-500 uppercase mb-1">Notes</div><div className="text-slate-700">{s.notes}</div></div>}

        {err && <div className="mt-4 bg-red-50 text-red-700 text-sm p-3 rounded-lg">{err}</div>}

        <div className="mt-6 flex flex-wrap gap-2">
          {canDeliver && (
            <button onClick={() => { setErr(null); deliver.mutate(); }} disabled={deliver.isPending} className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white text-sm rounded-lg font-medium">
              <CheckCircle size={14} /> Mark Delivered
            </button>
          )}
          {canVoid && (
            <button onClick={() => { const r = prompt('Reason for voiding shipment?'); if (r) { setErr(null); voidMut.mutate(r); } }} disabled={voidMut.isPending} className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm rounded-lg font-medium">
              <Ban size={14} /> Void Shipment
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
        <h3 className="font-semibold text-slate-800 mb-4">Lines</h3>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase border-b border-slate-100"><tr>
            <th className="text-left py-2">SKU</th><th className="text-left py-2">Name</th><th className="text-right py-2">Qty</th><th className="text-right py-2">Unit Price</th><th className="text-right py-2">Unit Cost</th>
          </tr></thead>
          <tbody>
            {s.lines?.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="py-2 font-mono text-xs">{l.product?.sku}</td>
                <td className="py-2">{l.product?.name}</td>
                <td className="py-2 text-right">{l.qty}</td>
                <td className="py-2 text-right">{l.unitPrice != null ? Number(l.unitPrice).toFixed(2) : '—'}</td>
                <td className="py-2 text-right">{l.unitCost != null ? Number(l.unitCost).toFixed(4) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(s.trackingEvents?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Tracking Events</h3>
          <div className="space-y-3">
            {s.trackingEvents?.map((e) => (
              <div key={e.id} className="flex items-start gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5"></div>
                <div>
                  <div className="font-medium text-slate-800">{e.eventType}</div>
                  <div className="text-xs text-slate-500">{new Date(e.occurredAt).toLocaleString()}{e.location ? ` — ${e.location}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="text-slate-800 font-medium break-all">{value ?? '—'}</div>
    </div>
  );
}

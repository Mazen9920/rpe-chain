import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, CheckCircle, Package, Truck, X, AlertCircle } from 'lucide-react';
import { salesOrderService } from '../services';
import type { SOStatus, ShipPayload, PickPayload } from '../types/fulfillment';

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  ALLOCATED: 'bg-indigo-100 text-indigo-700',
  PICKED: 'bg-violet-100 text-violet-700',
  PACKED: 'bg-purple-100 text-purple-700',
  SHIPPED: 'bg-cyan-100 text-cyan-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  RETURNED: 'bg-amber-100 text-amber-700',
};

const PIPELINE: SOStatus[] = ['RECEIVED', 'CONFIRMED', 'ALLOCATED', 'PICKED', 'PACKED', 'SHIPPED', 'DELIVERED'];

export default function SalesOrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showPick, setShowPick] = useState(false);
  const [showShip, setShowShip] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);

  const { data: so, isLoading } = useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => salesOrderService.getById(id),
    enabled: !!id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sales-order', id] });
    qc.invalidateQueries({ queryKey: ['sales-orders'] });
    qc.invalidateQueries({ queryKey: ['so-kpis'] });
  };
  const handleErr = (e: { response?: { data?: { message?: string; error?: string; details?: unknown } } }) => {
    const d = e.response?.data;
    setActionErr((d?.message || d?.error || 'Action failed') + (d?.details ? ` — ${JSON.stringify(d.details)}` : ''));
  };
  const confirm = useMutation({
    mutationFn: () => salesOrderService.confirm(id),
    onSuccess: (data: { warnings?: Array<{ code: string; message: string }> }) => {
      setWarnings(data?.warnings || []);
      invalidate();
    },
    onError: handleErr,
  });
  const allocate = useMutation({ mutationFn: () => salesOrderService.allocate(id), onSuccess: invalidate, onError: handleErr });
  const pack = useMutation({ mutationFn: () => salesOrderService.pack(id), onSuccess: invalidate, onError: handleErr });
  const cancel = useMutation({
    mutationFn: (reason: string) => salesOrderService.cancel(id, reason),
    onSuccess: invalidate,
    onError: handleErr,
  });

  if (isLoading || !so) return <div className="p-6 text-slate-400">Loading...</div>;

  const cancellable = ['RECEIVED', 'CONFIRMED', 'ALLOCATED'].includes(so.status);

  return (
    <div className="p-6 max-w-6xl">
      <Link to="/sales-orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft size={14} /> Back to sales orders
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-mono text-xs text-slate-500">{so.orderNumber}</div>
            <h2 className="text-2xl font-bold text-slate-800">{so.customerName}</h2>
            <div className="text-sm text-slate-500">{so.customerEmail}</div>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[so.status]}`}>{so.status}</span>
        </div>

        {/* Pipeline */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto">
          {PIPELINE.map((s, idx) => {
            const idxSO = PIPELINE.indexOf(so.status as SOStatus);
            const active = idx <= idxSO && idxSO !== -1;
            return (
              <div key={s} className="flex items-center flex-1 min-w-0">
                <div className={`flex-1 h-2 rounded-full ${active ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                {idx < PIPELINE.length - 1 && <div className="w-1" />}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500 mb-6 overflow-x-auto">
          {PIPELINE.map((s) => <div key={s} className="flex-1 text-center min-w-0">{s}</div>)}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Warehouse" value={so.warehouse?.code} />
          <Stat label="Total" value={`${so.currency} ${Number(so.totalAmount).toFixed(2)}`} />
          <Stat label="Ordered" value={new Date(so.orderedAt).toLocaleDateString()} />
          <Stat label="Created by" value={so.createdBy?.name} />
        </div>
        {so.notes && <div className="mt-4 text-sm"><div className="text-xs text-slate-500 uppercase mb-1">Notes</div><div className="text-slate-700">{so.notes}</div></div>}

        {actionErr && (
          <div className="mt-4 flex items-start gap-2 bg-red-50 text-red-700 text-sm p-3 rounded-lg">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1 break-words">{actionErr}</div>
            <button onClick={() => setActionErr(null)} className="text-red-500 hover:text-red-700"><X size={14} /></button>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded-lg">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold mb-0.5">Confirmed with warnings</div>
              <ul className="list-disc list-inside space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}><span className="font-mono text-xs">{w.code}</span> — {w.message}</li>
                ))}
              </ul>
            </div>
            <button onClick={() => setWarnings([])} className="text-amber-600 hover:text-amber-800"><X size={14} /></button>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-6 flex flex-wrap gap-2">
          {so.status === 'RECEIVED' && (
            <button onClick={() => { setActionErr(null); confirm.mutate(); }} disabled={confirm.isPending} className="action-btn bg-blue-600 hover:bg-blue-700">
              <CheckCircle size={14} /> Confirm
            </button>
          )}
          {so.status === 'CONFIRMED' && (
            <button onClick={() => { setActionErr(null); allocate.mutate(); }} disabled={allocate.isPending} className="action-btn bg-indigo-600 hover:bg-indigo-700">
              <Package size={14} /> Allocate Stock
            </button>
          )}
          {so.status === 'ALLOCATED' && (
            <button onClick={() => { setActionErr(null); setShowPick(true); }} className="action-btn bg-violet-600 hover:bg-violet-700">
              <Package size={14} /> Pick
            </button>
          )}
          {so.status === 'PICKED' && (
            <button onClick={() => { setActionErr(null); pack.mutate(); }} disabled={pack.isPending} className="action-btn bg-purple-600 hover:bg-purple-700">
              <Package size={14} /> Pack
            </button>
          )}
          {so.status === 'PACKED' && (
            <button onClick={() => { setActionErr(null); setShowShip(true); }} className="action-btn bg-cyan-600 hover:bg-cyan-700">
              <Truck size={14} /> Ship
            </button>
          )}
          {cancellable && (
            <button onClick={() => { const r = prompt('Cancel reason?'); if (r) { setActionErr(null); cancel.mutate(r); } }} disabled={cancel.isPending} className="action-btn bg-red-600 hover:bg-red-700">
              <X size={14} /> Cancel
            </button>
          )}
        </div>
        <style>{`.action-btn { display:inline-flex; align-items:center; gap:0.375rem; padding:0.5rem 0.875rem; color:white; border-radius:0.5rem; font-size:0.875rem; font-weight:500; }
          .action-btn:disabled { opacity:0.5; cursor:not-allowed; }`}</style>
      </div>

      {/* Lines */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
        <h3 className="font-semibold text-slate-800 mb-4">Lines</h3>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase border-b border-slate-100">
            <tr>
              <th className="text-left py-2">SKU</th>
              <th className="text-left py-2">Name</th>
              <th className="text-right py-2">Qty</th>
              <th className="text-right py-2">Allocated</th>
              <th className="text-right py-2">Picked</th>
              <th className="text-right py-2">Shipped</th>
              <th className="text-right py-2">Unit Price</th>
              <th className="text-right py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {so.lines?.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="py-2 font-mono text-xs">{l.product?.sku}</td>
                <td className="py-2">{l.product?.name}</td>
                <td className="py-2 text-right">{l.qty}</td>
                <td className="py-2 text-right text-indigo-600">{l.qtyAllocated}</td>
                <td className="py-2 text-right text-violet-600">{l.qtyPicked}</td>
                <td className="py-2 text-right text-cyan-600">{l.qtyShipped}</td>
                <td className="py-2 text-right">{Number(l.unitPrice).toFixed(2)}</td>
                <td className="py-2 text-right font-medium">{(l.qty * Number(l.unitPrice)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Shipments */}
      {(so.shipments?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Shipments</h3>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase border-b border-slate-100">
              <tr>
                <th className="text-left py-2">Shipment #</th>
                <th className="text-left py-2">Carrier</th>
                <th className="text-left py-2">Tracking</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {so.shipments?.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="py-2 font-mono text-xs">{s.shipmentNumber}</td>
                  <td className="py-2">{s.carrier ?? '—'}</td>
                  <td className="py-2 font-mono text-xs">{s.trackingNumber ?? '—'}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[s.status] ?? 'bg-slate-100'}`}>{s.status}</span></td>
                  <td className="py-2 text-slate-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 text-right"><Link to={`/shipments/${s.id}`} className="text-indigo-600 text-xs">View →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPick && <PickModal soId={id} lines={so.lines ?? []} onClose={() => setShowPick(false)} onDone={() => { invalidate(); setShowPick(false); }} onError={(m) => { setActionErr(m); setShowPick(false); }} />}
      {showShip && <ShipModal soId={id} onClose={() => setShowShip(false)} onDone={() => { invalidate(); setShowShip(false); }} onError={(m) => { setActionErr(m); setShowShip(false); }} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="text-slate-800 font-medium">{value ?? '—'}</div>
    </div>
  );
}

function PickModal({ soId, lines, onClose, onDone, onError }: { soId: string; lines: Array<{ id: string; qty: number; qtyAllocated: number; product?: { sku: string; name: string } }>; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [picks, setPicks] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.qtyAllocated])));
  const mut = useMutation({
    mutationFn: () => {
      const payload: PickPayload = { linePicks: lines.map((l) => ({ salesOrderLineId: l.id, qtyPicked: picks[l.id] ?? 0 })) };
      return salesOrderService.pick(soId, payload);
    },
    onSuccess: onDone,
    onError: (e: { response?: { data?: { message?: string; error?: string } } }) =>
      onError(e.response?.data?.message || e.response?.data?.error || 'Pick failed'),
  });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
        <h3 className="text-lg font-bold mb-4">Pick Order</h3>
        <table className="w-full text-sm mb-4">
          <thead><tr className="text-xs text-slate-500 uppercase"><th className="text-left">Product</th><th className="text-right">Allocated</th><th className="text-right">Pick Qty</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="py-2">{l.product?.sku} — {l.product?.name}</td>
                <td className="py-2 text-right">{l.qtyAllocated}</td>
                <td className="py-2 text-right"><input type="number" min="0" max={l.qtyAllocated} value={picks[l.id] ?? 0} onChange={(e) => setPicks({ ...picks, [l.id]: Number(e.target.value) })} className="w-24 px-2 py-1 border border-slate-200 rounded text-right" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white rounded-lg">{mut.isPending ? 'Picking...' : 'Confirm Pick'}</button>
        </div>
      </div>
    </div>
  );
}

const CARRIERS = ['DHL', 'BOSTA', 'ARAMEX', 'OTHER'];
function ShipModal({ soId, onClose, onDone, onError }: { soId: string; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState<ShipPayload>({ carrier: 'DHL', trackingNumber: '', markInTransit: true });
  const mut = useMutation({
    mutationFn: () => salesOrderService.ship(soId, form),
    onSuccess: onDone,
    onError: (e: { response?: { data?: { message?: string; error?: string } } }) =>
      onError(e.response?.data?.message || e.response?.data?.error || 'Ship failed'),
  });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold mb-4">Ship Order</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Carrier</label>
            <select value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg">{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tracking Number</label>
            <input value={form.trackingNumber ?? ''} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Estimated Arrival</label>
            <input type="date" value={form.estimatedArrival ?? ''} onChange={(e) => setForm({ ...form, estimatedArrival: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          </div>
          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" checked={!!form.markInTransit} onChange={(e) => setForm({ ...form, markInTransit: e.target.checked })} /> Mark as In-Transit
          </label>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending} className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 text-white rounded-lg">{mut.isPending ? 'Shipping...' : 'Ship Order'}</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, CheckCircle, XCircle, Lock, PackageCheck } from 'lucide-react';
import { purchaseOrderService, goodsReceiptService, inventoryService } from '../services';
import type { PurchaseOrder, GoodsReceipt } from '../types/procurement';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-indigo-100 text-indigo-700',
  SENT: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-800',
  RECEIVED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-rose-100 text-rose-700',
  CLOSED: 'bg-slate-200 text-slate-600',
};

const TABS = ['overview', 'lines', 'receipts', 'activity'] as const;
type Tab = typeof TABS[number];

export default function PurchaseOrderDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => { params.set('tab', t); setParams(params, { replace: true }); };
  const qc = useQueryClient();
  const [showReceive, setShowReceive] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: po, isLoading } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order', id],
    queryFn: () => purchaseOrderService.getById(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['purchase-order', id] });
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    qc.invalidateQueries({ queryKey: ['po-activity', id] });
    qc.invalidateQueries({ queryKey: ['po-kpis'] });
  };

  const runAction = (fn: () => Promise<unknown>) => {
    setActionError(null);
    fn().then(invalidate).catch((e) => {
      setActionError((e?.response?.data?.error as string) || e?.message || 'Action failed');
    });
  };

  if (isLoading || !po) return <div className="p-6 text-slate-500">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <Link to="/orders" className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
        <ArrowLeft size={14} /> All Purchase Orders
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 font-mono">{po.poNumber}</h2>
          <p className="text-sm text-slate-500">
            {po.supplier?.name}{po.expectedDate ? ` · Expected ${new Date(po.expectedDate).toLocaleDateString()}` : ''}
          </p>
        </div>
        <span className={`px-3 py-1 rounded text-xs font-semibold ${STATUS_COLORS[po.status]}`}>{po.status}</span>
      </div>

      {/* Workflow actions */}
      <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        {po.status === 'DRAFT' && (
          <button onClick={() => runAction(() => purchaseOrderService.submit(id))} className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-md flex items-center gap-1">
            Submit for Approval
          </button>
        )}
        {po.status === 'PENDING_APPROVAL' && (
          <button onClick={() => runAction(() => purchaseOrderService.approve(id))} className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-md flex items-center gap-1">
            <CheckCircle size={14} /> Approve
          </button>
        )}
        {po.status === 'APPROVED' && (
          <button onClick={() => runAction(() => purchaseOrderService.send(id))} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-1">
            <Send size={14} /> Send to Supplier
          </button>
        )}
        {(po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED') && (
          <button onClick={() => setShowReceive(true)} className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-md flex items-center gap-1">
            <PackageCheck size={14} /> Receive
          </button>
        )}
        {po.status === 'RECEIVED' && (
          <button onClick={() => runAction(() => purchaseOrderService.close(id))} className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-800 text-white rounded-md flex items-center gap-1">
            <Lock size={14} /> Close
          </button>
        )}
        {!['CLOSED', 'CANCELLED'].includes(po.status) && (
          <button onClick={() => setShowCancel(true)} className="px-3 py-1.5 text-sm bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-md flex items-center gap-1">
            <XCircle size={14} /> Cancel
          </button>
        )}
      </div>

      {actionError && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{actionError}</div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 pb-2 text-sm font-medium capitalize border-b-2 -mb-px transition ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >{t}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab po={po} />}
      {tab === 'lines' && <LinesTab po={po} />}
      {tab === 'receipts' && <ReceiptsTab po={po} />}
      {tab === 'activity' && <ActivityTab poId={id} />}

      {showReceive && (
        <ReceiveModal po={po} onClose={() => setShowReceive(false)} onDone={() => { setShowReceive(false); invalidate(); }} />
      )}
      {showCancel && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold">Cancel Purchase Order</h3>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Reason (optional)" className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCancel(false)} className="px-3 py-1.5 text-sm border border-slate-200 rounded">Back</button>
              <button onClick={() => { runAction(() => purchaseOrderService.cancel(id, cancelReason)); setShowCancel(false); }} className="px-3 py-1.5 text-sm bg-rose-600 text-white rounded">Confirm Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ po }: { po: PurchaseOrder }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card label="Supplier" value={po.supplier?.name ?? '—'} />
      <Card label="Currency" value={`${po.currency}${po.fxRate ? ` (FX ${po.fxRate})` : ''}`} />
      <Card label="Total Amount" value={Number(po.totalAmount).toLocaleString()} />
      <Card label="Expected Date" value={po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : '—'} />
      <Card label="Created By" value={po.createdBy?.name ?? '—'} />
      <Card label="Approved By" value={po.approvedBy?.name ?? '—'} />
      <Card label="Submitted" value={po.submittedAt ? new Date(po.submittedAt).toLocaleString() : '—'} />
      <Card label="Sent" value={po.sentAt ? new Date(po.sentAt).toLocaleString() : '—'} />
      {po.cancelReason && <Card label="Cancel Reason" value={po.cancelReason} />}
      {po.notes && <div className="col-span-2 bg-white border border-slate-100 rounded-lg p-3"><p className="text-xs text-slate-500">Notes</p><p className="text-sm text-slate-700">{po.notes}</p></div>}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-lg p-3 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function LinesTab({ po }: { po: PurchaseOrder }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            {['Product', 'SKU', 'Ordered', 'Received', 'Unit Price', 'Status', 'Expected'].map((h) => (
              <th key={h} className="px-4 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(po.lines ?? []).map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-2 font-medium text-slate-800">{l.product?.name ?? '—'}</td>
              <td className="px-4 py-2 font-mono text-xs text-slate-500">{l.product?.sku ?? '—'}</td>
              <td className="px-4 py-2 text-right text-slate-700">{l.qtyOrdered}</td>
              <td className="px-4 py-2 text-right text-slate-700">{l.qtyReceived}</td>
              <td className="px-4 py-2 text-right text-slate-700">{Number(l.unitPrice).toFixed(2)}</td>
              <td className="px-4 py-2"><span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{l.status}</span></td>
              <td className="px-4 py-2 text-slate-500">{l.expectedDate ? new Date(l.expectedDate).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptsTab({ po }: { po: PurchaseOrder }) {
  const receipts = po.goodsReceipts ?? [];
  if (receipts.length === 0) return <div className="bg-white border border-slate-100 rounded-lg p-6 text-center text-slate-400 text-sm">No goods receipts yet.</div>;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>{['Receipt #', 'Warehouse', 'Status', 'Received At', 'Lines'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {receipts.map((r: GoodsReceipt) => (
            <tr key={r.id}>
              <td className="px-4 py-2 font-mono text-xs">
                <Link to={`/goods-receipts/${r.id}`} className="text-blue-600 hover:underline">{r.receiptNumber}</Link>
              </td>
              <td className="px-4 py-2 text-slate-700">{r.warehouse?.name ?? '—'}</td>
              <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded ${r.status === 'REVERSED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}`}>{r.status}</span></td>
              <td className="px-4 py-2 text-slate-500">{new Date(r.receivedAt).toLocaleString()}</td>
              <td className="px-4 py-2 text-slate-500">{r.lines?.length ?? r._count?.lines ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTab({ poId }: { poId: string }) {
  const { data = [] } = useQuery({
    queryKey: ['po-activity', poId],
    queryFn: () => purchaseOrderService.activity(poId, { limit: 100 }),
  });
  const rows = data as { id: string; eventType: string; occurredAt: string; actor?: { name: string }; payload?: unknown }[];
  if (rows.length === 0) return <div className="text-sm text-slate-400 p-6 text-center">No activity recorded.</div>;
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-100">
      {rows.map((e) => (
        <div key={e.id} className="p-3 text-sm flex items-start justify-between">
          <div>
            <p className="font-medium text-slate-800">{e.eventType}</p>
            <p className="text-xs text-slate-500">{e.actor?.name ?? 'System'}</p>
          </div>
          <span className="text-xs text-slate-400">{new Date(e.occurredAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

interface ReceiveLineDraft {
  poLineId: string;
  qtyReceived: number;
  lotNumber?: string;
  expiryDate?: string;
}

function ReceiveModal({ po, onClose, onDone }: { po: PurchaseOrder; onClose: () => void; onDone: () => void }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [fxRate, setFxRate] = useState<string>(po.fxRate ? String(po.fxRate) : '');
  const [notes, setNotes] = useState('');
  const remainingLines = (po.lines ?? []).filter((l) => l.qtyOrdered - l.qtyReceived > 0 && l.status !== 'CANCELLED');
  const [lines, setLines] = useState<ReceiveLineDraft[]>(
    remainingLines.map((l) => ({ poLineId: l.id, qtyReceived: l.qtyOrdered - l.qtyReceived }))
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-active'],
    queryFn: () => inventoryService.warehouses(),
  });
  const whList = (warehouses ?? []) as { id: string; name: string; code: string }[];

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      await purchaseOrderService.receive(po.id, {
        warehouseId,
        fxRate: fxRate ? Number(fxRate) : undefined,
        notes: notes || undefined,
        lines: lines.filter((l) => l.qtyReceived > 0),
      });
      onDone();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Receive Goods · {po.poNumber}</h3>
          <button onClick={onClose} className="text-slate-500">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm">
                <option value="">Select warehouse…</option>
                {whList.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">FX Rate at Receipt</label>
              <input type="number" step="0.000001" value={fxRate} onChange={(e) => setFxRate(e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
            </div>
          </div>
          <table className="w-full text-sm border border-slate-100 rounded">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-right">Remaining</th>
                <th className="px-2 py-2 text-right">Receive Qty</th>
                <th className="px-2 py-2 text-left">Lot # (optional)</th>
                <th className="px-2 py-2 text-left">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {remainingLines.map((l, idx) => {
                const draft = lines[idx];
                const remaining = l.qtyOrdered - l.qtyReceived;
                return (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-700">{l.product?.name ?? l.productId}</td>
                    <td className="px-2 py-1 text-right text-slate-600">{remaining}</td>
                    <td className="px-2 py-1"><input type="number" value={draft.qtyReceived} onChange={(e) => { const n=[...lines]; n[idx]={...draft, qtyReceived: Number(e.target.value)}; setLines(n); }} className="w-24 px-1 py-1 border border-slate-200 rounded text-right text-xs" /></td>
                    <td className="px-2 py-1"><input value={draft.lotNumber ?? ''} onChange={(e) => { const n=[...lines]; n[idx]={...draft, lotNumber: e.target.value}; setLines(n); }} placeholder="auto-generate" className="w-40 px-1 py-1 border border-slate-200 rounded text-xs" /></td>
                    <td className="px-2 py-1"><input type="date" value={draft.expiryDate ?? ''} onChange={(e) => { const n=[...lines]; n[idx]={...draft, expiryDate: e.target.value}; setLines(n); }} className="px-1 py-1 border border-slate-200 rounded text-xs" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</div>}
        </div>
        <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-200 rounded">Cancel</button>
          <button onClick={submit} disabled={!warehouseId || busy} className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded disabled:opacity-50">
            {busy ? 'Receiving…' : 'Post Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

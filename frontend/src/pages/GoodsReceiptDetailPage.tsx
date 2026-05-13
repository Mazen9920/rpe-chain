import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Undo2, Check, X, DollarSign } from 'lucide-react';
import { goodsReceiptService } from '../services';
import type { GoodsReceipt } from '../types/procurement';

const COST_TYPES = ['FREIGHT', 'DUTY', 'INSURANCE', 'BROKERAGE', 'OTHER'];
const METHODS = ['VALUE', 'WEIGHT', 'VOLUME'];

export default function GoodsReceiptDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showLanded, setShowLanded] = useState(false);
  const [showReverse, setShowReverse] = useState(false);

  const { data: grn, isLoading } = useQuery<GoodsReceipt>({
    queryKey: ['goods-receipt', id],
    queryFn: () => goodsReceiptService.getById(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['goods-receipt', id] });
    qc.invalidateQueries({ queryKey: ['goods-receipts'] });
  };

  const qa = useMutation({
    mutationFn: ({ lineId, action, reason }: { lineId: string; action: 'RELEASE' | 'REJECT'; reason?: string }) =>
      goodsReceiptService.qaAction(lineId, action, reason),
    onSuccess: invalidate,
    onError: (e: { response?: { data?: { error?: string } }; message?: string }) =>
      setError(e.response?.data?.error || e.message || 'QA action failed'),
  });

  if (isLoading || !grn) return <div className="p-6 text-slate-500">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <Link to="/goods-receipts" className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
        <ArrowLeft size={14} /> All Goods Receipts
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 font-mono">{grn.receiptNumber}</h2>
          <p className="text-sm text-slate-500">
            <Link to={`/orders/${grn.purchaseOrderId}`} className="text-blue-600 hover:underline">{grn.purchaseOrder?.poNumber}</Link>
            {' '}· {grn.warehouse?.name} · received {new Date(grn.receivedAt).toLocaleString()}
          </p>
        </div>
        <span className={`px-3 py-1 rounded text-xs font-semibold ${grn.status === 'REVERSED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}`}>
          {grn.status}
        </span>
      </div>

      <div className="bg-white border border-slate-100 rounded-xl p-3 flex gap-2 shadow-sm">
        {grn.status === 'POSTED' && (
          <>
            <button onClick={() => setShowLanded(true)} className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded flex items-center gap-1">
              <DollarSign size={14} /> Add Landed Cost
            </button>
            <button onClick={() => setShowReverse(true)} className="px-3 py-1.5 text-sm bg-rose-50 hover:bg-rose-100 text-rose-700 rounded flex items-center gap-1">
              <Undo2 size={14} /> Reverse Receipt
            </button>
          </>
        )}
        {grn.reverseReason && <span className="text-sm text-slate-500 ml-auto">Reversed: {grn.reverseReason}</span>}
      </div>

      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</div>}

      <section>
        <h3 className="font-semibold text-slate-800 mb-2">Lines</h3>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>{['Product', 'Qty', 'Lot', 'QA Status', 'Actions'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(grn.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{l.poLine?.product?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{l.qtyReceived}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{l.lot?.lotNumber ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      l.qaStatus === 'REJECTED' ? 'bg-rose-100 text-rose-700'
                      : l.qaStatus === 'RELEASED' ? 'bg-emerald-100 text-emerald-800'
                      : l.qaStatus === 'QUARANTINED' ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-700'
                    }`}>{l.qaStatus}</span>
                  </td>
                  <td className="px-4 py-2">
                    {grn.status === 'POSTED' && l.qaStatus === 'PENDING' && (
                      <div className="flex gap-1">
                        <button onClick={() => qa.mutate({ lineId: l.id, action: 'RELEASE' })} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded flex items-center gap-1"><Check size={12} /> Release</button>
                        <button onClick={() => qa.mutate({ lineId: l.id, action: 'REJECT', reason: 'Failed QA' })} className="px-2 py-1 text-xs bg-rose-600 text-white rounded flex items-center gap-1"><X size={12} /> Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-semibold text-slate-800 mb-2">Landed Costs</h3>
        {(grn.landedCosts ?? []).length === 0 ? (
          <div className="bg-white border border-slate-100 rounded-lg p-4 text-sm text-slate-400 text-center">No landed costs allocated.</div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>{['Type', 'Amount', 'Method', 'Allocated At', ''].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(grn.landedCosts ?? []).map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-slate-700">{c.costType}</td>
                    <td className="px-4 py-2 text-slate-700">{Number(c.amount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2 text-slate-700">{c.allocationMethod}</td>
                    <td className="px-4 py-2 text-slate-500">{new Date(c.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      {grn.status === 'POSTED' && (
                        <button
                          onClick={() => goodsReceiptService.removeLandedCost(grn.id, c.id).then(invalidate)}
                          className="text-xs text-rose-600 hover:underline"
                        >remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showLanded && (
        <LandedCostModal grnId={grn.id} onClose={() => setShowLanded(false)} onDone={() => { setShowLanded(false); invalidate(); }} />
      )}
      {showReverse && (
        <ReverseModal grnId={grn.id} onClose={() => setShowReverse(false)} onDone={() => { setShowReverse(false); invalidate(); }} />
      )}
    </div>
  );
}

function LandedCostModal({ grnId, onClose, onDone }: { grnId: string; onClose: () => void; onDone: () => void }) {
  const [costType, setCostType] = useState('FREIGHT');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('VALUE');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      await goodsReceiptService.addLandedCost(grnId, { costType, amount: Number(amount), allocationMethod: method });
      onDone();
    } catch (e) {
      const ex = e as { response?: { data?: { error?: string } }; message?: string };
      setErr(ex.response?.data?.error || ex.message || 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h3 className="font-semibold">Add Landed Cost</h3>
        <div>
          <label className="text-xs text-slate-500">Cost Type</label>
          <select value={costType} onChange={(e) => setCostType(e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm">
            {COST_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Amount</label>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Allocation Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm">
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <p className="text-xs text-slate-400 mt-1">VOLUME falls back to VALUE (no volume on products). WEIGHT falls back to VALUE if any product has no weight.</p>
        </div>
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-200 rounded">Cancel</button>
          <button onClick={submit} disabled={!amount || busy} className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50">{busy ? 'Allocating…' : 'Allocate'}</button>
        </div>
      </div>
    </div>
  );
}

function ReverseModal({ grnId, onClose, onDone }: { grnId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setBusy(true);
    try { await goodsReceiptService.reverse(grnId, reason); onDone(); }
    catch (e) {
      const ex = e as { response?: { data?: { error?: string } }; message?: string };
      setErr(ex.response?.data?.error || ex.message || 'Failed');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h3 className="font-semibold">Reverse Receipt</h3>
        <p className="text-xs text-slate-500">This will lock cost layers, quarantine lots, and restore PO line received quantities. Reversal fails if any inventory has been depleted.</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (required)" className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-200 rounded">Cancel</button>
          <button onClick={submit} disabled={!reason || busy} className="px-3 py-1.5 text-sm bg-rose-600 hover:bg-rose-700 text-white rounded disabled:opacity-50">{busy ? 'Reversing…' : 'Confirm Reversal'}</button>
        </div>
      </div>
    </div>
  );
}

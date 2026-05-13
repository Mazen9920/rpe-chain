/**
 * OrderDrawer — full production order detail with workflow actions.
 * Actions per status: DRAFT → Release/Cancel · RELEASED → Consume/Cancel · IN_PROGRESS → Post Output
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Play, PackageOpen, CheckSquare, XCircle } from 'lucide-react';
import { productionService } from '../../services';
import type { ProductionOrder } from '../../types/manufacturing';

interface Props { orderId: string | null; onClose: () => void; }

function fmt(v: number | string | null | undefined) {
  if (v == null) return '—';
  const n = Number(v);
  return isNaN(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export default function OrderDrawer({ orderId, onClose }: Props) {
  const qc = useQueryClient();
  const open = Boolean(orderId);
  const [outputQty, setOutputQty] = useState<number>(0);
  const [scrapQty, setScrapQty] = useState<number>(0);
  const [lotNumber, setLotNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: order, isLoading } = useQuery<ProductionOrder>({
    queryKey: ['production-order', orderId],
    queryFn: () => productionService.get(orderId!),
    enabled: open,
  });

  useEffect(() => {
    if (order && order.status === 'IN_PROGRESS' && outputQty === 0) {
      setOutputQty(order.plannedQty);
    }
  }, [order, outputQty]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['production-order', orderId] });
    qc.invalidateQueries({ queryKey: ['manufacturing', 'orders'] });
  };

  const handleErr = (e: unknown) => setActionError(e instanceof Error ? e.message : 'Action failed');

  const release = useMutation({ mutationFn: () => productionService.release(orderId!), onSuccess: () => { invalidate(); setActionError(null); }, onError: handleErr });
  const consume = useMutation({ mutationFn: () => productionService.consume(orderId!), onSuccess: () => { invalidate(); setActionError(null); }, onError: handleErr });
  const post = useMutation({
    mutationFn: () => productionService.output(orderId!, { qty: outputQty, scrapQty: scrapQty || undefined, lotNumber: lotNumber || undefined, expiryDate: expiryDate || undefined }),
    onSuccess: () => { invalidate(); setActionError(null); },
    onError: handleErr,
  });
  const cancel = useMutation({
    mutationFn: () => {
      const reason = prompt('Cancellation reason (optional):') || undefined;
      return productionService.cancel(orderId!, reason);
    },
    onSuccess: () => { invalidate(); setActionError(null); },
    onError: handleErr,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h3 className="text-base font-semibold text-slate-700">{order?.orderNumber || 'Loading…'}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        {isLoading || !order ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" value={order.status} />
              <Field label="Product" value={`${order.product?.sku} — ${order.product?.name}`} />
              <Field label="Warehouse" value={`${order.warehouse?.code} — ${order.warehouse?.name}`} />
              <Field label="BOM Version" value={`v${order.bom?.version}`} />
              <Field label="Planned Qty" value={String(order.plannedQty)} />
              <Field label="Produced / Scrap" value={`${order.producedQty} / ${order.scrapQty}`} />
              <Field label="Released" value={order.releasedAt ? new Date(order.releasedAt).toLocaleString() : '—'} />
              <Field label="Completed" value={order.completedAt ? new Date(order.completedAt).toLocaleString() : '—'} />
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Component Lines</h4>
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr><th className="px-2 py-1.5 text-left">SKU</th><th className="px-2 py-1.5 text-left">Name</th><th className="px-2 py-1.5 text-right">Planned</th><th className="px-2 py-1.5 text-right">Consumed</th><th className="px-2 py-1.5 text-right">Unit Cost</th></tr>
                  </thead>
                  <tbody>
                    {(order.lines || []).map((l) => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-mono text-slate-600">{l.componentProduct?.sku}</td>
                        <td className="px-2 py-1.5">{l.componentProduct?.name}</td>
                        <td className="px-2 py-1.5 text-right">{fmt(l.plannedQty)}</td>
                        <td className="px-2 py-1.5 text-right">{fmt(l.consumedQty)}</td>
                        <td className="px-2 py-1.5 text-right">{fmt(l.unitCostSnapshot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {order.outputs && order.outputs.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Outputs</h4>
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr><th className="px-2 py-1.5 text-left">Lot</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Component $</th><th className="px-2 py-1.5 text-right">Labor</th><th className="px-2 py-1.5 text-right">Overhead</th><th className="px-2 py-1.5 text-right">Unit Cost</th></tr>
                    </thead>
                    <tbody>
                      {order.outputs.map((o) => (
                        <tr key={o.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 font-mono">{o.lot?.lotNumber}</td>
                          <td className="px-2 py-1.5 text-right">{o.qty}</td>
                          <td className="px-2 py-1.5 text-right">{fmt(o.totalComponentCost)}</td>
                          <td className="px-2 py-1.5 text-right">{fmt(o.laborCost)}</td>
                          <td className="px-2 py-1.5 text-right">{fmt(o.overheadCost)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{fmt(o.unitCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {order.consumptions && order.consumptions.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Lot Genealogy ({order.consumptions.length})</h4>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr><th className="px-2 py-1.5 text-left">Lot</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Unit Cost</th></tr>
                    </thead>
                    <tbody>
                      {order.consumptions.map((c) => (
                        <tr key={c.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 font-mono">{c.lot?.lotNumber}</td>
                          <td className="px-2 py-1.5 text-right">{c.qtyConsumed}</td>
                          <td className="px-2 py-1.5 text-right">{fmt(c.unitCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {order.status === 'IN_PROGRESS' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Post Output</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500">Qty</label>
                    <input type="number" min={1} value={outputQty} onChange={(e) => setOutputQty(parseInt(e.target.value, 10) || 0)} className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Scrap Qty</label>
                    <input type="number" min={0} value={scrapQty} onChange={(e) => setScrapQty(parseInt(e.target.value, 10) || 0)} className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Lot # (optional)</label>
                    <input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="auto-generate" className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Expiry (optional)</label>
                    <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm" />
                  </div>
                </div>
              </div>
            )}

            {actionError && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div>}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              {order.status === 'DRAFT' && (
                <>
                  <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"><XCircle size={16} /> Cancel</button>
                  <button onClick={() => release.mutate()} disabled={release.isPending} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Play size={16} /> Release</button>
                </>
              )}
              {order.status === 'RELEASED' && (
                <>
                  <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"><XCircle size={16} /> Cancel</button>
                  <button onClick={() => consume.mutate()} disabled={consume.isPending} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"><PackageOpen size={16} /> Consume Components</button>
                </>
              )}
              {order.status === 'IN_PROGRESS' && (
                <button onClick={() => post.mutate()} disabled={post.isPending || outputQty <= 0} className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"><CheckSquare size={16} /> Post Output</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  );
}

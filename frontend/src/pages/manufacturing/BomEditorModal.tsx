/**
 * BomEditorModal — create or edit a draft BOM (lines: component, qtyPer, scrap%, uom).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, Plus, Trash2 } from 'lucide-react';
import { bomService, productService } from '../../services';
import type { Product } from '../../types/inventory';
import type { BillOfMaterials } from '../../types/manufacturing';

interface DraftLine {
  componentProductId: string;
  qtyPer: number;
  uom: string;
  scrapFactorPct: number;
}

interface Props {
  open: boolean;
  bomId?: string;
  defaultProductId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function BomEditorModal({ open, bomId, defaultProductId, onClose, onSaved }: Props) {
  const isEdit = Boolean(bomId);
  const [productId, setProductId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: () => productService.list(), enabled: open });
  const { data: bom } = useQuery<BillOfMaterials>({
    queryKey: ['bom', bomId],
    queryFn: () => bomService.get(bomId!),
    enabled: open && Boolean(bomId),
  });

  useEffect(() => {
    if (!open) return;
    if (isEdit && bom) {
      setProductId(bom.productId);
      setNotes(bom.notes || '');
      setLines((bom.lines || []).map((l) => ({
        componentProductId: l.componentProductId,
        qtyPer: Number(l.qtyPer),
        uom: l.uom,
        scrapFactorPct: Number(l.scrapFactorPct),
      })));
    } else if (!isEdit) {
      setProductId(defaultProductId || '');
      setNotes('');
      setLines([]);
    }
    setError(null);
  }, [open, isEdit, bom, defaultProductId]);

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const save = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error('Pick a finished-good product');
      if (lines.length === 0) throw new Error('Add at least one component line');
      for (const l of lines) {
        if (!l.componentProductId) throw new Error('Each line needs a component');
        if (!(l.qtyPer > 0)) throw new Error('Qty per must be positive');
      }
      const payload = {
        productId,
        notes: notes || undefined,
        lines: lines.map((l, i) => ({
          componentProductId: l.componentProductId,
          qtyPer: l.qtyPer,
          uom: l.uom || productById[l.componentProductId]?.uom || 'EA',
          scrapFactorPct: l.scrapFactorPct || 0,
          position: i + 1,
        })),
      };
      if (isEdit) return bomService.updateDraft(bomId!, payload);
      return bomService.createDraft(payload);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  if (!open) return null;

  const addLine = () => setLines([...lines, { componentProductId: '', qtyPer: 1, uom: 'EA', scrapFactorPct: 0 }]);
  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-700">{isEdit ? `Edit BOM v${bom?.version ?? ''}` : 'New BOM Draft'}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Finished-Good Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={isEdit}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">Select a product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700">Component Lines</label>
              <button onClick={addLine} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"><Plus size={14} /> Add</button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left">Component</th>
                    <th className="px-2 py-2 text-right">Qty / Unit</th>
                    <th className="px-2 py-2 text-left">UoM</th>
                    <th className="px-2 py-2 text-right">Scrap %</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr><td colSpan={5} className="p-4 text-center text-xs text-slate-400">No lines yet — click Add.</td></tr>
                  )}
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1">
                        <select value={l.componentProductId} onChange={(e) => updateLine(i, { componentProductId: e.target.value, uom: productById[e.target.value]?.uom || l.uom })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs">
                          <option value="">Select…</option>
                          {products.filter((p) => p.id !== productId).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1"><input type="number" min={0} step="0.0001" value={l.qtyPer} onChange={(e) => updateLine(i, { qtyPer: parseFloat(e.target.value) || 0 })} className="w-24 rounded border border-slate-200 px-2 py-1 text-right text-xs" /></td>
                      <td className="px-2 py-1"><input value={l.uom} onChange={(e) => updateLine(i, { uom: e.target.value })} className="w-20 rounded border border-slate-200 px-2 py-1 text-xs" /></td>
                      <td className="px-2 py-1"><input type="number" min={0} max={100} step="0.01" value={l.scrapFactorPct} onChange={(e) => updateLine(i, { scrapFactorPct: parseFloat(e.target.value) || 0 })} className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-xs" /></td>
                      <td className="px-2 py-1"><button onClick={() => removeLine(i)} className="rounded p-1 text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60">
            {save.isPending ? 'Saving…' : isEdit ? 'Save Draft' : 'Create Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

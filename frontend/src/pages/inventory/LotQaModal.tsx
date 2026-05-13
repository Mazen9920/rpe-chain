/**
 * LotQaModal — Full QA action modal for a Lot.
 * Supports:
 *   QUARANTINED  → enter qty to move to quarantine (QA_HOLD movement)
 *   RELEASED     → enter qty to release from quarantine (QA_RELEASE movement)
 *   REJECTED     → marks lot rejected (no stock movement required)
 *   PENDING      → revert to pending
 * warehouseId required when qty > 0.
 */
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, X } from 'lucide-react';
import { inventoryService } from '../../services';
import type { Lot, Warehouse } from '../../types/inventory';

const QA_OPTIONS = [
  { value: 'RELEASED', label: 'Release', description: 'Move qty from quarantine back to available', color: 'text-green-700 bg-green-50 border-green-200' },
  { value: 'QUARANTINED', label: 'Hold / Quarantine', description: 'Move qty to quarantine hold', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  { value: 'REJECTED', label: 'Reject', description: 'Mark lot as rejected (write off)', color: 'text-red-700 bg-red-50 border-red-200' },
  { value: 'PENDING', label: 'Reset to Pending', description: 'Revert lot QA status to pending review', color: 'text-slate-700 bg-slate-50 border-slate-200' },
];

interface LotQaModalProps {
  lot: Lot;
  onClose: () => void;
}

export default function LotQaModal({ lot, onClose }: LotQaModalProps) {
  const queryClient = useQueryClient();
  const [qaStatus, setQaStatus] = useState<string>(lot.qaStatus ?? 'PENDING');
  const [qty, setQty] = useState<number | ''>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['inventory', 'warehouses'],
    queryFn: inventoryService.warehouses,
  });

  useEffect(() => {
    // Pre-select first warehouse
    if (warehouses.length && !warehouseId) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  const needsQty = qaStatus === 'QUARANTINED' || qaStatus === 'RELEASED';

  const mutation = useMutation({
    mutationFn: () =>
      inventoryService.updateLotQaStatus(lot.id, {
        qaStatus,
        qty: needsQty && qty !== '' ? Number(qty) : undefined,
        warehouseId: needsQty && qty ? warehouseId : undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'lots'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
      onClose();
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setError(err.response?.data?.error ?? 'QA update failed');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsQty && qty !== '' && Number(qty) > 0 && !warehouseId) {
      setError('Warehouse is required when moving qty.');
      return;
    }
    mutation.mutate();
  };

  const selectedOption = QA_OPTIONS.find((o) => o.value === qaStatus);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <ShieldCheck size={18} className="text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">QA Action</h3>
              <p className="text-xs text-slate-500 font-mono">{lot.lotNumber} · {lot.product?.sku}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={17} /></button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          {/* Current status pill */}
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="text-slate-400">Current status:</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{lot.qaStatus ?? 'PENDING'}</span>
            <span className="text-slate-400">·</span>
            <span>Remaining qty: <strong>{lot.qtyRemaining}</strong></span>
          </div>

          {/* QA Status picker */}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-slate-700">New Status</legend>
            {QA_OPTIONS.map((opt) => (
              <label key={opt.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${qaStatus === opt.value ? opt.color : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <input type="radio" name="qaStatus" value={opt.value} checked={qaStatus === opt.value} onChange={() => { setQaStatus(opt.value); setError(null); }} className="mt-0.5 accent-slate-700" />
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-slate-500">{opt.description}</p>
                </div>
              </label>
            ))}
          </fieldset>

          {/* Qty + Warehouse — only shown for actions that move stock */}
          {needsQty ? (
            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Qty <span className="font-normal text-slate-400">(0 = status only)</span></span>
                <input
                  type="number" min={0} max={lot.qtyRemaining ?? undefined}
                  value={qty}
                  onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Warehouse</span>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500">
                  <option value="">Select…</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select>
              </label>
            </div>
          ) : null}

          {/* Notes */}
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Reason / Notes <span className="font-normal text-slate-400">(optional)</span></span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            disabled={mutation.isPending}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${selectedOption?.value === 'REJECTED' ? 'bg-red-600 hover:bg-red-700' : selectedOption?.value === 'QUARANTINED' ? 'bg-amber-600 hover:bg-amber-700' : selectedOption?.value === 'RELEASED' ? 'bg-green-700 hover:bg-green-800' : 'bg-slate-700 hover:bg-slate-800'}`}
          >
            {mutation.isPending ? 'Saving…' : `Apply — ${selectedOption?.label}`}
          </button>
        </div>
      </form>
    </div>
  );
}

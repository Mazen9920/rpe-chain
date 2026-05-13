import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { inventoryService } from '../../services';
import type { StockTransfer } from '../../types/inventory';

interface Props {
  transfer: StockTransfer;
  onClose: () => void;
}

export default function TransferShipModal({ transfer, onClose }: Props) {
  const queryClient = useQueryClient();
  const [lineQtys, setLineQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(transfer.lines.map((l) => [l.id, l.qtyRequested]))
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      inventoryService.shipTransfer(transfer.id, {
        lines: transfer.lines.map((l) => ({ lineId: l.id, qtyShipped: lineQtys[l.id] ?? l.qtyRequested })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
      onClose();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      setError(err.response?.data?.error || err.message || 'Ship failed');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    for (const line of transfer.lines) {
      const q = lineQtys[line.id] ?? 0;
      if (!Number.isFinite(q) || q <= 0) {
        setError(`Qty must be > 0 for ${line.product?.sku ?? line.productId}`);
        return;
      }
      if (q > line.qtyRequested) {
        setError(`Qty for ${line.product?.sku ?? line.productId} cannot exceed requested (${line.qtyRequested})`);
        return;
      }
    }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-800">Ship Transfer</h3>
            <p className="text-xs text-slate-500 font-mono">{transfer.transferNumber}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 text-sm">
          <p className="mb-3 text-slate-500 text-xs">
            {transfer.sourceWarehouse?.code} → {transfer.destinationWarehouse?.code}
          </p>
          <div className="space-y-3">
            {transfer.lines.map((line) => (
              <div key={line.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex-1">
                  <p className="font-medium text-slate-700">{line.product?.sku}</p>
                  <p className="text-xs text-slate-500">{line.product?.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Req: {line.qtyRequested}</span>
                  <input
                    type="number"
                    min={1}
                    max={line.qtyRequested}
                    required
                    value={lineQtys[line.id] ?? line.qtyRequested}
                    onChange={(e) => setLineQtys((prev) => ({ ...prev, [line.id]: Number(e.target.value) }))}
                    className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-right outline-none focus:border-blue-500"
                  />
                  <span className="text-xs text-slate-400">{line.product?.uom}</span>
                </div>
              </div>
            ))}
          </div>

          {error ? <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

          <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {mutation.isPending ? 'Shipping…' : 'Confirm Ship'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

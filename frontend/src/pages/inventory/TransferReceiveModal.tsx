import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { inventoryService } from '../../services';
import type { StockTransfer } from '../../types/inventory';

interface Props {
  transfer: StockTransfer;
  onClose: () => void;
}

export default function TransferReceiveModal({ transfer, onClose }: Props) {
  const queryClient = useQueryClient();

  const openLines = transfer.lines.filter((l) => l.qtyShipped - l.qtyReceived > 0);

  const [lineQtys, setLineQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(openLines.map((l) => [l.id, l.qtyShipped - l.qtyReceived]))
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      inventoryService.receiveTransfer(transfer.id, {
        lines: openLines.map((l) => ({ lineId: l.id, qtyReceived: lineQtys[l.id] ?? 0 })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
      onClose();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      setError(err.response?.data?.error || err.message || 'Receive failed');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    for (const line of openLines) {
      const q = lineQtys[line.id] ?? 0;
      const remaining = line.qtyShipped - line.qtyReceived;
      if (!Number.isFinite(q) || q < 0) {
        setError(`Invalid qty for ${line.product?.sku ?? line.productId}`);
        return;
      }
      if (q > remaining) {
        setError(`Qty for ${line.product?.sku ?? line.productId} cannot exceed remaining (${remaining})`);
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
            <h3 className="font-semibold text-slate-800">Receive Transfer</h3>
            <p className="text-xs text-slate-500 font-mono">{transfer.transferNumber}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 text-sm">
          <p className="mb-3 text-slate-500 text-xs">
            {transfer.sourceWarehouse?.code} → {transfer.destinationWarehouse?.code}
            {transfer.status === 'PARTIALLY_RECEIVED' ? (
              <span className="ml-2 rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">Partial — entering remaining</span>
            ) : null}
          </p>

          <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 text-xs font-medium text-slate-400">
            <span>Product</span><span>Shipped</span><span>Already rcvd</span><span>Receive now</span>
          </div>
          <div className="space-y-2">
            {transfer.lines.map((line) => {
              const remaining = line.qtyShipped - line.qtyReceived;
              const isDone = remaining <= 0;
              return (
                <div
                  key={line.id}
                  className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg px-3 py-2 ${isDone ? 'bg-green-50' : 'bg-slate-50'}`}
                >
                  <div>
                    <p className={`font-medium ${isDone ? 'text-slate-400' : 'text-slate-700'}`}>{line.product?.sku}</p>
                    <p className="text-xs text-slate-400">{line.product?.name}</p>
                  </div>
                  <span className="text-xs text-slate-500 text-right">{line.qtyShipped}</span>
                  <span className="text-xs text-slate-500 text-right">{line.qtyReceived}</span>
                  {isDone ? (
                    <span className="text-xs font-medium text-green-600 text-right">✓ Done</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      required
                      value={lineQtys[line.id] ?? remaining}
                      onChange={(e) => setLineQtys((prev) => ({ ...prev, [line.id]: Number(e.target.value) }))}
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-right outline-none focus:border-blue-500"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {error ? <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

          <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending || openLines.length === 0} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {mutation.isPending ? 'Receiving…' : 'Confirm Receive'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

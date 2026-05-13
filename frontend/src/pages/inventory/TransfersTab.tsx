import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, Plus, Send, Trash2 } from 'lucide-react';
import { inventoryService, productService } from '../../services';
import type { Product, StockTransfer, Warehouse } from '../../types/inventory';
import TransferShipModal from './TransferShipModal';
import TransferReceiveModal from './TransferReceiveModal';

interface TransferLine {
  key: number;
  productId: string;
  qtyRequested: number;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  IN_TRANSIT: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
};

let lineKey = 1;

export default function TransfersTab() {
  const queryClient = useQueryClient();
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([{ key: lineKey++, productId: '', qtyRequested: 1 }]);
  const [shipTarget, setShipTarget] = useState<StockTransfer | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<StockTransfer | null>(null);

  const { data: transfers = [], isLoading } = useQuery<StockTransfer[]>({ queryKey: ['inventory', 'transfers'], queryFn: inventoryService.transfers });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryService.warehouses });
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: productService.list });

  const create = useMutation({
    mutationFn: () =>
      inventoryService.createTransfer({
        sourceWarehouseId,
        destinationWarehouseId,
        notes: notes || undefined,
        lines: lines.map((l) => ({ productId: l.productId, qtyRequested: Number(l.qtyRequested) })),
      }),
    onSuccess: () => {
      setSourceWarehouseId('');
      setDestinationWarehouseId('');
      setNotes('');
      setLines([{ key: lineKey++, productId: '', qtyRequested: 1 }]);
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
    },
  });

  const addLine = () => setLines((prev) => [...prev, { key: lineKey++, productId: '', qtyRequested: 1 }]);
  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));
  const updateLine = (key: number, patch: Partial<TransferLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const canCreate = warehouses.length >= 2;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      {/* Transfer list */}
      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-800">Warehouse Transfers</h3>
          <p className="text-sm text-slate-500">Multi-line transfers with per-line partial receive support.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                {['Transfer', 'From → To', 'Status', 'Lines', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">Loading...</td></tr>
              ) : transfers.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No transfers yet.</td></tr>
              ) : transfers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{t.transferNumber}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {t.sourceWarehouse?.code} → {t.destinationWarehouse?.code}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs max-w-xs">
                    {t.lines.map((l) => (
                      <span key={l.id} className="mr-2 whitespace-nowrap">
                        {l.product?.sku ?? '?'} ×{l.qtyRequested}
                        {l.qtyShipped > 0 ? <span className="text-blue-500"> s:{l.qtyShipped}</span> : null}
                        {l.qtyReceived > 0 ? <span className="text-green-600"> r:{l.qtyReceived}</span> : null}
                      </span>
                    ))}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      {t.status === 'DRAFT' ? (
                        <button
                          onClick={() => setShipTarget(t)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <Send size={13} /> Ship
                        </button>
                      ) : null}
                      {(t.status === 'IN_TRANSIT' || t.status === 'PARTIALLY_RECEIVED') ? (
                        <button
                          onClick={() => setReceiveTarget(t)}
                          className="inline-flex items-center gap-1 rounded-lg border border-green-200 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                        >
                          <CheckCircle2 size={13} /> Receive
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create form */}
      <form onSubmit={submit} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
        <h4 className="mb-4 font-semibold text-slate-800">Create Transfer</h4>
        <div className="space-y-3">
          <select
            required
            value={sourceWarehouseId}
            onChange={(e) => setSourceWarehouseId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">Source warehouse</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>

          <select
            required
            value={destinationWarehouseId}
            onChange={(e) => setDestinationWarehouseId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">Destination warehouse</option>
            {warehouses.filter((w) => w.id !== sourceWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">Lines</span>
              <button type="button" onClick={addLine} className="inline-flex items-center gap-1 rounded text-xs text-blue-600 hover:underline">
                <Plus size={12} /> Add line
              </button>
            </div>
            {lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2">
                <select
                  required
                  value={line.productId}
                  onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                >
                  <option value="">Product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                </select>
                <input
                  type="number"
                  min={1}
                  required
                  value={line.qtyRequested}
                  onChange={(e) => updateLine(line.key, { qtyRequested: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-right outline-none focus:border-blue-500"
                />
                {lines.length > 1 ? (
                  <button type="button" onClick={() => removeLine(line.key)} className="rounded p-1 text-slate-400 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />

          <button
            disabled={!canCreate || create.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <ArrowRightLeft size={15} />
            {create.isPending ? 'Creating…' : 'Create Transfer'}
          </button>
          {!canCreate ? <p className="text-center text-xs text-slate-400">Need at least 2 warehouses.</p> : null}
        </div>
      </form>

      {shipTarget ? <TransferShipModal transfer={shipTarget} onClose={() => setShipTarget(null)} /> : null}
      {receiveTarget ? <TransferReceiveModal transfer={receiveTarget} onClose={() => setReceiveTarget(null)} /> : null}
    </div>
  );
}

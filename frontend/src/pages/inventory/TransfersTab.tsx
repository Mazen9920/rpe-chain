import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, Send } from 'lucide-react';
import { inventoryService, productService } from '../../services';
import type { Product, StockTransfer, Warehouse } from '../../types/inventory';

export default function TransfersTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ sourceWarehouseId: '', destinationWarehouseId: '', productId: '', qtyRequested: 1, notes: '' });
  const { data: transfers = [], isLoading } = useQuery<StockTransfer[]>({ queryKey: ['inventory', 'transfers'], queryFn: inventoryService.transfers });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryService.warehouses });
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: productService.list });

  const create = useMutation({
    mutationFn: () => inventoryService.createTransfer({ ...form, lines: [{ productId: form.productId, qtyRequested: Number(form.qtyRequested) }] }),
    onSuccess: () => {
      setForm({ sourceWarehouseId: '', destinationWarehouseId: '', productId: '', qtyRequested: 1, notes: '' });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
    },
  });
  const ship = useMutation({ mutationFn: inventoryService.shipTransfer, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] }) });
  const receive = useMutation({ mutationFn: inventoryService.receiveTransfer, onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
  } });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-800">Warehouse Transfers</h3>
          <p className="text-sm text-slate-500">Move stock between warehouses with shipped and received states.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50">{['Transfer', 'From', 'To', 'Status', 'Lines', 'Actions'].map((heading) => <th key={heading} className="px-5 py-3 text-left font-medium text-slate-500">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading transfers...</td></tr> : transfers.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No transfers yet.</td></tr> : transfers.map((transfer) => (
                <tr key={transfer.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{transfer.transferNumber}</td>
                  <td className="px-5 py-3 text-slate-600">{transfer.sourceWarehouse?.code}</td>
                  <td className="px-5 py-3 text-slate-600">{transfer.destinationWarehouse?.code}</td>
                  <td className="px-5 py-3"><span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{transfer.status}</span></td>
                  <td className="px-5 py-3 text-slate-600">{transfer.lines.map((line) => `${line.product?.sku ?? 'SKU'} x${line.qtyRequested}`).join(', ')}</td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      {transfer.status === 'DRAFT' ? <button onClick={() => ship.mutate(transfer.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Send size={13} />Ship</button> : null}
                      {transfer.status === 'IN_TRANSIT' ? <button onClick={() => receive.mutate(transfer.id)} className="inline-flex items-center gap-1 rounded-lg border border-green-200 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"><CheckCircle2 size={13} />Receive</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
        <h4 className="mb-4 font-semibold text-slate-800">Create Transfer</h4>
        <div className="space-y-3">
          <select required value={form.sourceWarehouseId} onChange={(event) => setForm((current) => ({ ...current, sourceWarehouseId: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">Source warehouse</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
          <select required value={form.destinationWarehouseId} onChange={(event) => setForm((current) => ({ ...current, destinationWarehouseId: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">Destination warehouse</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
          <select required value={form.productId} onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">Product</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
          </select>
          <input min={1} required type="number" value={form.qtyRequested} onChange={(event) => setForm((current) => ({ ...current, qtyRequested: Number(event.target.value) }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button disabled={warehouses.length < 2 || create.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><ArrowRightLeft size={15} />Create Transfer</button>
        </div>
      </form>
    </div>
  );
}

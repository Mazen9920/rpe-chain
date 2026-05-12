import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { inventoryService, productService } from '../../services';
import type { Product, StockAdjustmentInput, Warehouse } from '../../types/inventory';

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error ?? 'Request failed';
  }
  return 'Request failed';
}

interface StockAdjustmentModalProps {
  open: boolean;
  initialProductId?: string;
  initialWarehouseId?: string;
  onClose: () => void;
}

export default function StockAdjustmentModal({ open, initialProductId, initialWarehouseId, onClose }: StockAdjustmentModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StockAdjustmentInput>({ productId: '', warehouseId: '', qty: 1, notes: '' });
  const [error, setError] = useState<string | null>(null);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: productService.list,
    enabled: open,
  });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['inventory', 'warehouses'],
    queryFn: inventoryService.warehouses,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      productId: initialProductId || products[0]?.id || '',
      warehouseId: initialWarehouseId || warehouses[0]?.id || '',
      qty: 1,
      notes: '',
    });
    setError(null);
  }, [initialProductId, initialWarehouseId, open, products, warehouses]);

  const mutation = useMutation({
    mutationFn: (data: StockAdjustmentInput) => inventoryService.adjustStock(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ ...form, qty: Number(form.qty), notes: form.notes || null });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Adjust Stock</h3>
            <p className="text-sm text-slate-500">Creates an append-only adjustment movement.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close stock adjustment"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Product</span>
            <select required value={form.productId} onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500">
              <option value="" disabled>Select product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Warehouse</span>
            <select required value={form.warehouseId} onChange={(event) => setForm((current) => ({ ...current, warehouseId: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500">
              <option value="" disabled>Select warehouse</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Adjustment Qty</span>
            <input required type="number" value={form.qty} onChange={(event) => setForm((current) => ({ ...current, qty: Number(event.target.value) }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea rows={3} value={form.notes ?? ''} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button disabled={mutation.isPending} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">{mutation.isPending ? 'Posting...' : 'Post Adjustment'}</button>
        </div>
      </form>
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { inventoryService, productService } from '../../services';
import type { BinLocation, BinStockLevel, Lot, Product, StockAdjustmentInput, Warehouse } from '../../types/inventory';
import BarcodeInput, { LookupResult } from '../../components/BarcodeInput';

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
  const [form, setForm] = useState<StockAdjustmentInput & { binId?: string; lotId?: string }>({
    productId: '', warehouseId: '', qty: 1, notes: '', binId: '', lotId: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: productService.list, enabled: open });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryService.warehouses, enabled: open });
  const { data: bins = [] } = useQuery<BinLocation[]>({
    queryKey: ['inventory', 'bins', form.warehouseId],
    queryFn: () => inventoryService.bins({ warehouseId: form.warehouseId }),
    enabled: open && Boolean(form.warehouseId),
  });
  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ['inventory', 'lots', form.productId],
    queryFn: () => inventoryService.lots({ productId: form.productId }),
    enabled: open && Boolean(form.productId),
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      productId: initialProductId || products[0]?.id || '',
      warehouseId: initialWarehouseId || warehouses[0]?.id || '',
      qty: 1, notes: '', binId: '', lotId: '',
    });
    setError(null);
  }, [initialProductId, initialWarehouseId, open, products, warehouses]);

  const mutation = useMutation({
    mutationFn: (data: StockAdjustmentInput & { binId?: string; lotId?: string }) =>
      inventoryService.adjustStock({
        productId: data.productId,
        warehouseId: data.warehouseId,
        binId: data.binId || undefined,
        lotId: data.lotId || undefined,
        qty: Number(data.qty),
        notes: data.notes || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'bin-stock'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  if (!open) return null;

  const handleBarcode = (result: LookupResult) => {
    if (result.type === 'PRODUCT') {
      setForm((f) => ({ ...f, productId: result.entity.id as string }));
    } else if (result.type === 'BIN') {
      setForm((f) => ({ ...f, binId: result.entity.id as string, warehouseId: (result.entity.warehouseId as string) || f.warehouseId }));
    } else if (result.type === 'LOT') {
      setForm((f) => ({ ...f, lotId: result.entity.id as string, productId: (result.entity.productId as string) || f.productId }));
    }
  };

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
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Quick Scan</span>
            <BarcodeInput onResolve={handleBarcode} />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Product</span>
            <select required value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value, lotId: '' }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500">
              <option value="" disabled>Select product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Warehouse</span>
            <select required value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value, binId: '' }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500">
              <option value="" disabled>Select warehouse</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Bin <span className="font-normal text-slate-400">(optional)</span></span>
            <select aria-label="Select bin location" value={form.binId ?? ''} onChange={(e) => setForm((f) => ({ ...f, binId: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" disabled={!form.warehouseId}>
              <option value="">No specific bin</option>
              {bins.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.binType}</option>)}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Lot <span className="font-normal text-slate-400">(optional)</span></span>
            <select aria-label="Select lot" value={form.lotId ?? ''} onChange={(e) => setForm((f) => ({ ...f, lotId: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" disabled={!form.productId}>
              <option value="">No lot</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.lotNumber}{l.expiryDate ? ` · exp ${new Date(l.expiryDate).toLocaleDateString()}` : ''}</option>)}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Adjustment Qty</span>
            <input required type="number" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            <p className="text-xs text-slate-400">Positive = add stock · Negative = remove stock</p>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
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

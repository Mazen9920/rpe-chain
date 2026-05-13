import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { inventoryService, productService } from '../../services';
import type { BinLocation, BinStockLevel, Product } from '../../types/inventory';
import BarcodeInput, { LookupResult } from '../../components/BarcodeInput';

interface BinMoveModalProps {
  warehouseId: string;
  fromBin: BinLocation;
  bins: BinLocation[];
  onClose: () => void;
}

export default function BinMoveModal({ warehouseId, fromBin, bins, onClose }: BinMoveModalProps) {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState('');
  const [toBinId, setToBinId] = useState('');
  const [qty, setQty] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products', 'all'],
    queryFn: () => productService.list(),
  });
  const { data: binStock = [] } = useQuery<BinStockLevel[]>({
    queryKey: ['inventory', 'bin-stock', warehouseId, fromBin.id],
    queryFn: () => inventoryService.binStockLevels({ binId: fromBin.id }),
  });

  const productsInBin = useMemo(() => {
    const map = new Map<string, { product: Product; onHand: number }>();
    binStock.forEach((row) => {
      const product = products.find((p) => p.id === row.productId) ?? row.product as Product | undefined;
      if (product) map.set(row.productId, { product, onHand: row.onHand });
    });
    return Array.from(map.values());
  }, [binStock, products]);

  const availableQty = productsInBin.find((row) => row.product.id === productId)?.onHand ?? 0;
  const destinationBins = bins.filter((b) => b.id !== fromBin.id && b.isActive);

  const mutation = useMutation({
    mutationFn: () =>
      inventoryService.moveBetweenBins({
        productId,
        warehouseId,
        fromBinId: fromBin.id,
        toBinId,
        qty: Number(qty),
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'bin-stock', warehouseId] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
      onClose();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      setError(err.response?.data?.error || err.message || 'Move failed');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!productId || !toBinId || !qty || Number(qty) <= 0) {
      setError('Pick product, destination bin, and a positive qty.');
      return;
    }
    if (Number(qty) > availableQty) {
      setError(`Only ${availableQty} on hand in source bin.`);
      return;
    }
    mutation.mutate();
  };

  const handleBarcode = (result: LookupResult) => {
    if (result.type === 'BIN') {
      // If scanning a destination bin (different from source)
      const scannedId = result.entity.id as string;
      if (scannedId !== fromBin.id) setToBinId(scannedId);
    } else if (result.type === 'PRODUCT') {
      setProductId(result.entity.id as string);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-800">Move Stock Between Bins</h3>
            <p className="text-xs text-slate-500">
              From <span className="font-mono text-slate-700">{fromBin.code}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4 px-5 py-4 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium text-slate-600">Quick Scan</span>
            <BarcodeInput placeholder="Scan destination bin or product SKU…" onResolve={handleBarcode} />
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-slate-600">Product</span>
            <select
              required
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            >
              <option value="">Select product…</option>
              {productsInBin.map((row) => (
                <option key={row.product.id} value={row.product.id}>
                  {row.product.sku} · {row.product.name} ({row.onHand} on hand)
                </option>
              ))}
            </select>
            {productsInBin.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">Source bin has no stock to move.</p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-slate-600">Destination Bin</span>
            <select
              required
              value={toBinId}
              onChange={(event) => setToBinId(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            >
              <option value="">Select bin…</option>
              {destinationBins.map((bin) => (
                <option key={bin.id} value={bin.id}>
                  {bin.code} · {bin.binType}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-slate-600">Quantity</span>
            <input
              required
              type="number"
              min={1}
              max={availableQty || undefined}
              value={qty}
              onChange={(event) => setQty(event.target.value === '' ? '' : Number(event.target.value))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
            {productId ? (
              <p className="mt-1 text-xs text-slate-500">Available in source bin: {availableQty}</p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-slate-600">Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </label>

          {error ? <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Moving…' : 'Move Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

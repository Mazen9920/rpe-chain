import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Store } from 'lucide-react';
import { productService } from '../../services';
import type { Product } from '../../types/inventory';

type ShopifyMap = { inventoryItemId?: string; locationId?: string };

function readMap(product: Product): ShopifyMap {
  const ext = (product as unknown as { externalIds?: { shopify?: ShopifyMap } }).externalIds;
  return ext?.shopify ?? {};
}

interface Props {
  product: Product;
  onClose: () => void;
}

export default function ShopifyMappingModal({ product, onClose }: Props) {
  const current = readMap(product);
  const [inventoryItemId, setInventoryItemId] = useState(current.inventoryItemId ?? '');
  const [locationId, setLocationId] = useState(current.locationId ?? '');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existing = (product as unknown as { externalIds?: Record<string, unknown> }).externalIds ?? {};
      const shopify: ShopifyMap = {};
      if (inventoryItemId.trim()) shopify.inventoryItemId = inventoryItemId.trim();
      if (locationId.trim()) shopify.locationId = locationId.trim();
      const externalIds = { ...existing, shopify };
      return productService.update(product.id, { externalIds });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Save failed';
      setError(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Store size={18} className="text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Shopify Mapping</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div className="text-xs text-slate-500">
            {product.sku} · {product.name}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Inventory Item ID</label>
            <input
              value={inventoryItemId}
              onChange={(e) => setInventoryItemId(e.target.value)}
              placeholder="e.g. 44827289108547"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Location ID</label>
            <input
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="e.g. 75839176771"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <p className="text-xs text-slate-500">
            Required for outbound inventory sync from this app to Shopify after shipments. Leave blank to disable.
          </p>
          {error ? <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => { setError(null); saveMutation.mutate(); }}
            disabled={saveMutation.isPending}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Category, Product, ProductFormInput } from '../../types/inventory';

const emptyForm: ProductFormInput = {
  sku: '',
  name: '',
  description: '',
  categoryId: '',
  uom: 'each',
  reorderPoint: 10,
  reorderQty: 50,
  costPrice: '0.00',
  sellingPrice: '0.00',
  weightKg: '',
  hsCode: '',
  certifications: [],
};

function toForm(product?: Product | null): ProductFormInput {
  if (!product) return { ...emptyForm };
  const certifications = Array.isArray(product.certifications)
    ? product.certifications.map((item) => String(item)).join(', ')
    : '';

  return {
    sku: product.sku,
    name: product.name,
    description: product.description ?? '',
    categoryId: product.categoryId,
    uom: product.uom,
    reorderPoint: product.reorderPoint,
    reorderQty: product.reorderQty,
    costPrice: String(product.costPrice ?? '0.00'),
    sellingPrice: String(product.sellingPrice ?? '0.00'),
    weightKg: product.weightKg ? String(product.weightKg) : '',
    hsCode: product.hsCode ?? '',
    certifications,
  };
}

function normalize(form: ProductFormInput) {
  const certifications = typeof form.certifications === 'string'
    ? form.certifications.split(',').map((item) => item.trim()).filter(Boolean)
    : form.certifications;

  return {
    ...form,
    description: form.description || null,
    reorderPoint: Number(form.reorderPoint),
    reorderQty: Number(form.reorderQty),
    weightKg: form.weightKg || null,
    hsCode: form.hsCode || null,
    certifications,
  };
}

interface ProductFormSlideOverProps {
  open: boolean;
  product?: Product | null;
  categories: Category[];
  isSaving: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (data: ReturnType<typeof normalize>) => void;
}

export default function ProductFormSlideOver({
  open,
  product,
  categories,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ProductFormSlideOverProps) {
  const [form, setForm] = useState<ProductFormInput>(emptyForm);

  useEffect(() => {
    if (open) {
      const next = toForm(product);
      if (!next.categoryId && categories[0]) next.categoryId = categories[0].id;
      setForm(next);
    }
  }, [categories, open, product]);

  if (!open) return null;

  const update = (key: keyof ProductFormInput, value: string | number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(normalize(form));
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
      <form onSubmit={submit} className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{product ? 'Edit Product' : 'Add Product'}</h3>
            <p className="text-sm text-slate-500">Catalog fields used by inventory and procurement.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close product form">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">SKU</span>
              <input required value={form.sku} onChange={(e) => update('sku', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Name</span>
              <input required value={form.name} onChange={(e) => update('name', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Description</span>
            <textarea value={form.description ?? ''} onChange={(e) => update('description', e.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Category</span>
              <select required value={form.categoryId} onChange={(e) => update('categoryId', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500">
                <option value="" disabled>Select category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">UOM</span>
              <select value={form.uom} onChange={(e) => update('uom', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500">
                <option value="each">each</option>
                <option value="box">box</option>
                <option value="case">case</option>
                <option value="pair">pair</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Reorder Point</span>
              <input required min={0} type="number" value={form.reorderPoint} onChange={(e) => update('reorderPoint', Number(e.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Reorder Qty</span>
              <input required min={1} type="number" value={form.reorderQty} onChange={(e) => update('reorderQty', Number(e.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Cost Price</span>
              <input required min={0} step="0.01" type="number" value={form.costPrice} onChange={(e) => update('costPrice', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Selling Price</span>
              <input required min={0} step="0.01" type="number" value={form.sellingPrice} onChange={(e) => update('sellingPrice', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Weight kg</span>
              <input min={0} step="0.001" type="number" value={form.weightKg ?? ''} onChange={(e) => update('weightKg', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">HS Code</span>
              <input value={form.hsCode ?? ''} onChange={(e) => update('hsCode', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Certifications</span>
            <input value={String(form.certifications ?? '')} onChange={(e) => update('certifications', e.target.value)} placeholder="NIOSH, CE, EN149" className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" />
          </label>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-100 bg-white px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={isSaving} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
            {isSaving ? 'Saving...' : product ? 'Save Changes' : 'Create Product'}
          </button>
        </div>
      </form>
    </div>
  );
}

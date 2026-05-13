import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit2, PackagePlus, Search, Trash2, ShieldCheck } from 'lucide-react';
import { categoryService, productService } from '../../services';
import type { Category, Product } from '../../types/inventory';
import ProductFormSlideOver from './ProductFormSlideOver';
import CertificationsModal from './CertificationsModal';

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error ?? 'Request failed';
  }
  return 'Request failed';
}

export default function ProductsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [certsProduct, setCertsProduct] = useState<Product | null>(null);
  const [isFormOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: products = [], isLoading, isError } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: productService.list,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: categoryService.list,
  });

  const filtered = products.filter((product) => {
    const term = search.toLowerCase();
    return product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term);
  });

  const saveMutation = useMutation({
    mutationFn: (data: object) => editingProduct ? productService.update(editingProduct.id, data) : productService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setFormOpen(false);
      setEditingProduct(null);
      setFormError(null);
    },
    onError: (error) => setFormError(getErrorMessage(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => productService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const openCreate = () => {
    setEditingProduct(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setFormError(null);
    setFormOpen(true);
  };

  const deactivateProduct = (product: Product) => {
    if (!confirm(`Deactivate ${product.name}?`)) return;
    deactivateMutation.mutate(product.id);
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <Search size={15} className="text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or SKU"
              className="w-full text-sm outline-none text-slate-700 placeholder-slate-400"
            />
          </div>
          <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <PackagePlus size={16} />
            Add Product
          </button>
        </div>

        {isError ? (
          <div className="px-5 py-8 text-sm text-red-600">Unable to load products.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {['SKU', 'Name', 'Category', 'On Hand', 'Reserved', 'Reorder Point', 'Status', 'Actions'].map((heading) => (
                    <th key={heading} className="text-left px-5 py-3 text-slate-500 font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? Array.from({ length: 5 }).map((_, row) => (
                  <tr key={row}>{Array.from({ length: 8 }).map((_, cell) => <td key={cell} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>
                )) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">No products found.</td></tr>
                ) : filtered.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{product.sku}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">{product.name}</td>
                    <td className="px-5 py-3 text-slate-600">{product.category?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{product.totalOnHand ?? 0} {product.uom}</td>
                    <td className="px-5 py-3 text-slate-600">{product.totalReserved ?? 0}</td>
                    <td className="px-5 py-3 text-slate-600">{product.reorderPoint}</td>
                    <td className="px-5 py-3">
                      {product.isLowStock ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Low Stock</span> : <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">OK</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => openEdit(product)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                          <Edit2 size={13} /> Edit
                        </button>
                        <button onClick={() => setCertsProduct(product)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                          <ShieldCheck size={13} /> Certs
                        </button>
                        <button onClick={() => deactivateProduct(product)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                          <Trash2 size={13} /> Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProductFormSlideOver
        open={isFormOpen}
        product={editingProduct}
        categories={categories}
        isSaving={saveMutation.isPending}
        error={formError}
        onClose={() => setFormOpen(false)}
        onSubmit={(data) => saveMutation.mutate(data)}
      />
      {certsProduct ? (
        <CertificationsModal productId={certsProduct.id} productName={certsProduct.name} onClose={() => setCertsProduct(null)} />
      ) : null}
    </>
  );
}

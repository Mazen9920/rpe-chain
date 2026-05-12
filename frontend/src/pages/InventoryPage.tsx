import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { productService } from '../services';

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: productService.list,
  });

  const filtered = (products as { id: string; name: string; sku: string; uom: string; reorderPoint: number; totalOnHand: number; isLowStock: boolean; category?: { name: string } }[]).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Inventory</h2>
        <p className="text-slate-500 text-sm">{products.length} products across all warehouses</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Search size={15} className="text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or SKU…"
            className="flex-1 text-sm outline-none text-slate-700 placeholder-slate-400"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                {['SKU', 'Name', 'Category', 'On Hand', 'Reorder Point', 'Status'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-5 py-3">
                          <div className="h-4 bg-slate-100 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.sku}</td>
                      <td className="px-5 py-3 font-medium text-slate-800">{p.name}</td>
                      <td className="px-5 py-3 text-slate-600">{p.category?.name ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{p.totalOnHand ?? 0} {p.uom}</td>
                      <td className="px-5 py-3 text-slate-600">{p.reorderPoint}</td>
                      <td className="px-5 py-3">
                        {p.isLowStock ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Low Stock</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

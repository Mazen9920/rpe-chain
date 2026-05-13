/**
 * BomsTab — list, create draft, edit draft, activate, archive, clone BOMs.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, GitBranch, CheckCircle2, Archive, Copy, Edit2 } from 'lucide-react';
import { bomService, productService } from '../../services';
import type { BillOfMaterials } from '../../types/manufacturing';
import type { Product } from '../../types/inventory';
import BomEditorModal from './BomEditorModal';

export default function BomsTab() {
  const qc = useQueryClient();
  const [filterProductId, setFilterProductId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; bomId?: string; productId?: string }>({ open: false });

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: () => productService.list() });
  const { data: boms = [], isLoading } = useQuery<BillOfMaterials[]>({
    queryKey: ['manufacturing', 'boms', filterProductId, includeArchived],
    queryFn: () => bomService.list({ productId: filterProductId || undefined, includeArchived }),
  });

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['manufacturing', 'boms'] });
    qc.invalidateQueries({ queryKey: ['manufacturing', 'orders'] });
  };

  const activate = useMutation({ mutationFn: (id: string) => bomService.activate(id), onSuccess: invalidate });
  const archive = useMutation({ mutationFn: (id: string) => bomService.archive(id), onSuccess: invalidate });
  const clone = useMutation({ mutationFn: (id: string) => bomService.clone(id), onSuccess: (newBom) => { invalidate(); setEditor({ open: true, bomId: (newBom as BillOfMaterials).id }); } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Filter by product</label>
            <select value={filterProductId} onChange={(e) => setFilterProductId(e.target.value)} className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">All products</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        <button onClick={() => setEditor({ open: true })} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
          <Plus size={16} /> New BOM Draft
        </button>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : boms.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            <GitBranch className="mx-auto mb-2 text-slate-300" size={28} />
            No BOMs yet. Create a draft to define a finished good's components.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-4 py-2 text-left">Version</th>
                <th className="px-4 py-2 text-left">Lines</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Created</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {boms.map((b) => {
                const prod = b.product || productsById[b.productId];
                const isDraft = !b.isActive && !b.archivedAt;
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-700">{prod?.name || '—'}</div>
                      <div className="text-xs text-slate-400">{prod?.sku}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">v{b.version}</td>
                    <td className="px-4 py-2">{b._count?.lines ?? b.lines?.length ?? 0}</td>
                    <td className="px-4 py-2">
                      {b.archivedAt ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Archived</span>
                      ) : b.isActive ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Active</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Draft</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{new Date(b.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {isDraft && (
                          <>
                            <button onClick={() => setEditor({ open: true, bomId: b.id })} title="Edit" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><Edit2 size={14} /></button>
                            <button onClick={() => activate.mutate(b.id)} disabled={activate.isPending} title="Activate" className="rounded-md p-1.5 text-green-600 hover:bg-green-50"><CheckCircle2 size={14} /></button>
                          </>
                        )}
                        {!b.archivedAt && (
                          <button onClick={() => clone.mutate(b.id)} disabled={clone.isPending} title="Clone" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><Copy size={14} /></button>
                        )}
                        {b.isActive && (
                          <button onClick={() => { if (confirm('Archive this active BOM? Production planning will need a replacement.')) archive.mutate(b.id); }} title="Archive" className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50"><Archive size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <BomEditorModal
        open={editor.open}
        bomId={editor.bomId}
        defaultProductId={editor.productId}
        onClose={() => setEditor({ open: false })}
        onSaved={invalidate}
      />
    </div>
  );
}

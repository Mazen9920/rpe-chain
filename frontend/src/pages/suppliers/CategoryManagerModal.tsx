import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supplierService } from '../../services';

export default function CategoryManagerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({ queryKey: ['supplier-categories'], queryFn: supplierService.categories.list });

  const createMut = useMutation({
    mutationFn: () => supplierService.categories.create({ code, name, description: description || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-categories'] });
      setCode(''); setName(''); setDescription(''); setError(null);
    },
    onError: (e: unknown) => setError(extract(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => supplierService.categories.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-categories'] }),
    onError: (e: unknown) => setError(extract(e)),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-lg font-bold text-slate-800">Supplier categories</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

          <div className="rounded-lg border border-slate-100 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Add new (admin)</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            </div>
            <button
              onClick={() => createMut.mutate()}
              disabled={!code || !name || createMut.isPending}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
            >
              <Plus size={12} /> Create
            </button>
          </div>

          <div className="rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-500"><th className="px-3 py-2 text-left">Code</th><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Suppliers</th><th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{c._count?.supplierLinks ?? 0}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => deleteMut.mutate(c.id)} className="text-rose-500 hover:text-rose-700" title="Delete"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-400">No categories yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="border-t border-slate-100 px-5 py-3 text-right">
          <button onClick={onClose} className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200">Close</button>
        </footer>
      </div>
    </div>
  );
}

function extract(e: unknown) {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error || ax?.message || 'Operation failed';
}

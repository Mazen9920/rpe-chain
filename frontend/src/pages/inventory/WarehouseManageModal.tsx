import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit2, Plus, Trash2, X } from 'lucide-react';
import { inventoryService } from '../../services';
import type { Warehouse, WarehouseFormInput } from '../../types/inventory';

const emptyForm: WarehouseFormInput = { code: '', name: '', address: '', taxJurisdiction: '', country: '', currency: '' };

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error ?? 'Request failed';
  }
  return 'Request failed';
}

interface WarehouseManageModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WarehouseManageModal({ open, onClose }: WarehouseManageModalProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form, setForm] = useState<WarehouseFormInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const { data: warehouses = [], isLoading } = useQuery<Warehouse[]>({
    queryKey: ['inventory', 'warehouses'],
    queryFn: inventoryService.warehouses,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        code: editing.code,
        name: editing.name,
        address: editing.address ?? '',
        taxJurisdiction: editing.taxJurisdiction ?? '',
        country: editing.country ?? '',
        currency: editing.currency ?? '',
      });
    } else {
      setForm(emptyForm);
    }
  }, [editing, open]);

  const saveMutation = useMutation({
    mutationFn: (data: WarehouseFormInput) => editing ? inventoryService.updateWarehouse(editing.id, data) : inventoryService.createWarehouse(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
      setEditing(null);
      setForm(emptyForm);
      setError(null);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const deactivateMutation = useMutation({
    mutationFn: inventoryService.deactivateWarehouse,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'warehouses'] }),
    onError: (err) => setError(getErrorMessage(err)),
  });

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveMutation.mutate({
      code: form.code.trim(),
      name: form.name.trim(),
      address: form.address || null,
      taxJurisdiction: form.taxJurisdiction || null,
      country: form.country || null,
      currency: form.currency || null,
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Manage Warehouses</h3>
            <p className="text-sm text-slate-500">Create, edit, or deactivate inventory locations.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close warehouse manager"><X size={18} /></button>
        </div>

        <div className="grid max-h-[calc(90vh-73px)] grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_360px]">
          <div className="overflow-x-auto border-b border-slate-100 lg:border-b-0 lg:border-r">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50">{['Code', 'Name', 'Country', 'Currency', 'Tax', 'Address', 'Actions'].map((heading) => <th key={heading} className="text-left px-5 py-3 text-slate-500 font-medium">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? Array.from({ length: 3 }).map((_, row) => <tr key={row}>{Array.from({ length: 5 }).map((_, cell) => <td key={cell} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>) : warehouses.map((warehouse) => (
                  <tr key={warehouse.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{warehouse.code}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">{warehouse.name}</td>
                    <td className="px-5 py-3 text-slate-600">{warehouse.country ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{warehouse.currency ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{warehouse.taxJurisdiction ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{warehouse.address ?? '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => { setEditing(warehouse); setError(null); }} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label={`Edit ${warehouse.name}`}><Edit2 size={14} /></button>
                        <button onClick={() => deactivateMutation.mutate(warehouse.id)} className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50" aria-label={`Deactivate ${warehouse.name}`}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={submit} className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-800">{editing ? 'Edit Warehouse' : 'Add Warehouse'}</h4>
              {editing ? <button type="button" onClick={() => { setEditing(null); setError(null); }} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600"><Plus size={14} /> New</button> : null}
            </div>
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <label className="block space-y-1 text-sm"><span className="font-medium text-slate-700">Code</span><input required value={form.code} onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium text-slate-700">Name</span><input required value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium text-slate-700">Tax Jurisdiction</span><input value={form.taxJurisdiction ?? ''} onChange={(e) => setForm((current) => ({ ...current, taxJurisdiction: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium text-slate-700">Country</span><input value={form.country ?? ''} placeholder="e.g. AE, GB, US" onChange={(e) => setForm((current) => ({ ...current, country: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium text-slate-700">Currency</span><input value={form.currency ?? ''} placeholder="e.g. AED, GBP, USD" onChange={(e) => setForm((current) => ({ ...current, currency: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium text-slate-700">Address</span><textarea rows={3} value={form.address ?? ''} onChange={(e) => setForm((current) => ({ ...current, address: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500" /></label>
            <button disabled={saveMutation.isPending} className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">{saveMutation.isPending ? 'Saving...' : editing ? 'Save Warehouse' : 'Create Warehouse'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}

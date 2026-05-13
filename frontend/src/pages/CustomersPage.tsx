import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, X, Search } from 'lucide-react';
import { customerService } from '../services';
import type { Customer, PaymentTerms } from '../types/fulfillment';

const PAYMENT_TERMS: PaymentTerms[] = ['NET_15', 'NET_30', 'NET_60', 'NET_90', 'COD', 'PREPAID'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'EGP'];

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['customers', { search }],
    queryFn: () => customerService.list({ search: search || undefined, limit: 100 }),
  });

  const items: Customer[] = data?.items ?? [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Customers</h2>
          <p className="text-slate-500 text-sm">{data?.total ?? 0} customers</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> New Customer
        </button>
      </div>

      <div className="mb-4 relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, code, email..."
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Code', 'Name', 'Email', 'Currency', 'Terms', 'Status', ''].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium text-xs uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">No customers yet</td></tr>
            ) : items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{c.code}</td>
                <td className="px-5 py-3 font-medium text-slate-800">{c.name}</td>
                <td className="px-5 py-3 text-slate-600">{c.email ?? '—'}</td>
                <td className="px-5 py-3 text-slate-600">{c.currency}</td>
                <td className="px-5 py-3 text-slate-600">{c.paymentTerms}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <Link to={`/customers/${c.id}`} className="text-indigo-600 hover:text-indigo-700 text-xs font-medium">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateCustomerModal onClose={() => setShowCreate(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['customers'] }); setShowCreate(false); }} />}
    </div>
  );
}

function CreateCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<Partial<Customer>>({
    code: '',
    name: '',
    email: '',
    phone: '',
    currency: 'USD',
    paymentTerms: 'NET_30',
    billingAddress: '',
    shippingAddress: '',
    taxId: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => customerService.create(form),
    onSuccess: onCreated,
    onError: (e: { response?: { data?: { message?: string; error?: string } } }) =>
      setErr(e.response?.data?.message || e.response?.data?.error || 'Failed to create'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">New Customer</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Code *"><input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input" /></Field>
            <Field label="Name *"><input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
            <Field label="Email"><input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" /></Field>
            <Field label="Phone"><input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" /></Field>
            <Field label="Currency">
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="input">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Payment Terms">
              <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value as PaymentTerms })} className="input">
                {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Tax ID"><input value={form.taxId ?? ''} onChange={(e) => setForm({ ...form, taxId: e.target.value })} className="input" /></Field>
            <Field label="Credit Limit"><input type="number" value={String(form.creditLimit ?? '')} onChange={(e) => setForm({ ...form, creditLimit: e.target.value ? Number(e.target.value) : null })} className="input" /></Field>
          </div>
          <Field label="Billing Address"><textarea rows={2} value={form.billingAddress ?? ''} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} className="input" /></Field>
          <Field label="Shipping Address"><textarea rows={2} value={form.shippingAddress ?? ''} onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })} className="input" /></Field>
          {err && <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{err}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={!form.code || !form.name || mut.isPending}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg"
          >
            {mut.isPending ? 'Saving...' : 'Create'}
          </button>
        </div>
      </div>
      <style>{`.input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.875rem; }
        .input:focus { outline: none; box-shadow: 0 0 0 2px #6366f1; }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, Plus, Star, Trash2 } from 'lucide-react';
import { customerService } from '../services';
import type { CustomerContact } from '../types/fulfillment';

export default function CustomerDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showAddContact, setShowAddContact] = useState(false);

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customerService.getById(id),
    enabled: !!id,
  });

  const setPrimary = useMutation({
    mutationFn: (contactId: string) => customerService.contacts.setPrimary(id, contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer', id] }),
  });
  const delContact = useMutation({
    mutationFn: (contactId: string) => customerService.contacts.delete(id, contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer', id] }),
  });

  if (isLoading || !customer) return <div className="p-6 text-slate-400">Loading...</div>;

  return (
    <div className="p-6 max-w-5xl">
      <Link to="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft size={14} /> Back to customers
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-mono text-xs text-slate-500">{customer.code}</div>
            <h2 className="text-2xl font-bold text-slate-800">{customer.name}</h2>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${customer.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {customer.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Email" value={customer.email} />
          <Stat label="Phone" value={customer.phone} />
          <Stat label="Currency" value={customer.currency} />
          <Stat label="Payment Terms" value={customer.paymentTerms} />
          <Stat label="Tax ID" value={customer.taxId} />
          <Stat label="Credit Limit" value={customer.creditLimit != null ? String(customer.creditLimit) : null} />
        </div>
        {customer.billingAddress && <div className="mt-4 text-sm"><div className="text-xs text-slate-500 uppercase mb-1">Billing</div><div className="text-slate-700 whitespace-pre-line">{customer.billingAddress}</div></div>}
        {customer.shippingAddress && <div className="mt-4 text-sm"><div className="text-xs text-slate-500 uppercase mb-1">Shipping</div><div className="text-slate-700 whitespace-pre-line">{customer.shippingAddress}</div></div>}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">Contacts</h3>
          <button onClick={() => setShowAddContact(true)} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
            <Plus size={14} /> Add contact
          </button>
        </div>
        {(customer.contacts ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No contacts</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-slate-500 text-xs uppercase border-b border-slate-100">
              <th className="text-left py-2">Name</th><th className="text-left py-2">Role</th><th className="text-left py-2">Email</th><th className="text-left py-2">Phone</th><th className="text-left py-2">Primary</th><th></th>
            </tr></thead>
            <tbody>
              {customer.contacts?.map((c) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2">{c.name}</td>
                  <td className="py-2 text-slate-600">{c.role ?? '—'}</td>
                  <td className="py-2 text-slate-600">{c.email ?? '—'}</td>
                  <td className="py-2 text-slate-600">{c.phone ?? '—'}</td>
                  <td className="py-2">
                    {c.isPrimary ? <Star size={14} className="text-amber-500" fill="currentColor" /> :
                      <button onClick={() => setPrimary.mutate(c.id)} className="text-xs text-indigo-600 hover:underline">Make primary</button>}
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={() => { if (confirm(`Delete ${c.name}?`)) delContact.mutate(c.id); }} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddContact && <AddContactModal customerId={id} onClose={() => setShowAddContact(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['customer', id] }); setShowAddContact(false); }} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="text-slate-800 font-medium">{value ?? '—'}</div>
    </div>
  );
}

function AddContactModal({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Partial<CustomerContact>>({ name: '', email: '', phone: '', role: '', isPrimary: false });
  const mut = useMutation({
    mutationFn: () => customerService.contacts.add(customerId, form),
    onSuccess: onDone,
  });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold mb-4">Add Contact</h3>
        <div className="space-y-3 text-sm">
          <input placeholder="Name *" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          <input placeholder="Role" value={form.role ?? ''} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          <input type="email" placeholder="Email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          <input placeholder="Phone" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" checked={!!form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> Primary contact
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={!form.name || mut.isPending} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg">
            {mut.isPending ? 'Saving...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

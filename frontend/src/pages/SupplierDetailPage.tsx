/**
 * SupplierDetailPage — full-page view at /suppliers/:id with URL-synced tabs:
 * Overview · Products · Contacts · Documents · Performance · Activity.
 */
import { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Building2, Edit, Trash2, ShieldCheck, Info, Package, Users, FileText,
  TrendingUp, History, Plus, Upload, Download, RefreshCcw, Tag, Star,
} from 'lucide-react';
import { supplierService, productService } from '../services';
import type {
  Supplier, SupplierContact, SupplierDocument, SupplierPerformance,
  SupplierProductLink, SupplierActivityEntry, SupplierApprovalStatus,
} from '../types/supplier';
import SupplierFormSlideOver from './suppliers/SupplierFormSlideOver';
import {
  approvalBadge, riskBadge, fmtBytes, fmtDate, fmtPct,
  APPROVAL_STATUSES, DOC_CATEGORIES,
} from './suppliers/shared';

type Tab = 'overview' | 'products' | 'contacts' | 'documents' | 'performance' | 'activity';
const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'overview',    label: 'Overview',    icon: Info },
  { id: 'products',    label: 'Products',    icon: Package },
  { id: 'contacts',    label: 'Contacts',    icon: Users },
  { id: 'documents',   label: 'Documents',   icon: FileText },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'activity',    label: 'Activity',    icon: History },
];

function normalizeTab(v: string | null): Tab {
  return TABS.some((t) => t.id === v) ? (v as Tab) : 'overview';
}

function extract(e: unknown) {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error || ax?.message || 'Operation failed';
}

export default function SupplierDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = normalizeTab(params.get('tab'));
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getById(id),
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: (payload: Partial<Supplier>) => supplierService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier', id] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setEditOpen(false);
      setEditError(null);
    },
    onError: (e: unknown) => setEditError(extract(e)),
  });

  const deactivateMut = useMutation({
    mutationFn: () => supplierService.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); nav('/suppliers'); },
  });

  const setApprovalMut = useMutation({
    mutationFn: (status: SupplierApprovalStatus) => supplierService.setApproval(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier', id] }),
  });

  const changeTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (!supplier) return <div className="p-6 text-rose-600">Supplier not found.</div>;

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link to="/suppliers" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft size={12} /> Back to suppliers</Link>
      </div>

      <header className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
            <Building2 size={22} /> {supplier.name}
            <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${approvalBadge(supplier.approvalStatus)}`}>
              {supplier.approvalStatus.replace('_', ' ')}
            </span>
            {supplier.riskRating && (
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${riskBadge(supplier.riskRating)}`}>{supplier.riskRating} RISK</span>
            )}
          </h2>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{supplier.code}</span> · {supplier.country ?? '—'} · {supplier.currency} · {supplier.paymentTerms} · {supplier.leadTimeDays}d lead time
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={supplier.approvalStatus}
            onChange={(e) => setApprovalMut.mutate(e.target.value as SupplierApprovalStatus)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-semibold"
            title="Change approval status"
          >
            {APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button onClick={() => { setEditOpen(true); setEditError(null); }} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Edit size={12} /> Edit</button>
          <button
            onClick={() => { if (confirm(`Deactivate supplier "${supplier.name}"?`)) deactivateMut.mutate(); }}
            disabled={deactivateMut.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            <Trash2 size={12} /> Deactivate
          </button>
        </div>
      </header>

      <div className="mb-5 flex overflow-x-auto rounded-xl border border-slate-100 bg-white p-1 shadow-sm">
        {TABS.map(({ id: tid, label, icon: Icon }) => {
          const active = tid === tab;
          return (
            <button key={tid} onClick={() => changeTab(tid)} className={`inline-flex min-w-max items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${active ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Icon size={16} /> {label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab supplier={supplier} />}
      {tab === 'products' && <ProductsTab supplierId={id} />}
      {tab === 'contacts' && <ContactsTab supplierId={id} />}
      {tab === 'documents' && <DocumentsTab supplierId={id} />}
      {tab === 'performance' && <PerformanceTab supplierId={id} />}
      {tab === 'activity' && <ActivityTab supplierId={id} />}

      <SupplierFormSlideOver
        open={editOpen}
        supplier={supplier}
        onClose={() => setEditOpen(false)}
        onSubmit={async (data) => { await updateMut.mutateAsync(data); }}
        saving={updateMut.isPending}
        error={editError}
      />
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────

function OverviewTab({ supplier }: { supplier: Supplier }) {
  const qc = useQueryClient();
  const { data: categories = [] } = useQuery({ queryKey: ['supplier-categories'], queryFn: supplierService.categories.list });
  const linked = new Set((supplier.categoryLinks ?? []).map((l) => l.categoryId));

  const attach = useMutation({
    mutationFn: (catId: string) => supplierService.categories.attach(supplier.id, catId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier', supplier.id] }),
  });
  const detach = useMutation({
    mutationFn: (catId: string) => supplierService.categories.detach(supplier.id, catId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier', supplier.id] }),
  });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card title="Commercial">
        <Row label="Legal name" value={supplier.legalName} />
        <Row label="Tax ID" value={supplier.taxId} />
        <Row label="Tax registered" value={supplier.taxRegistered ? 'Yes' : 'No'} />
        <Row label="Currency" value={supplier.currency} />
        <Row label="Payment terms" value={supplier.paymentTerms} />
        <Row label="Incoterms" value={supplier.incoterms} />
        <Row label="Lead time" value={`${supplier.leadTimeDays} days`} />
      </Card>

      <Card title="Primary contact">
        <Row label="Contact" value={supplier.primaryContact} />
        <Row label="Email" value={supplier.email} />
        <Row label="Phone" value={supplier.phone} />
        <Row label="Website" value={supplier.website} />
      </Card>

      <Card title="Address">
        <Row label="Line 1" value={supplier.addressLine1} />
        <Row label="Line 2" value={supplier.addressLine2} />
        <Row label="City" value={supplier.city} />
        <Row label="State / Region" value={supplier.state} />
        <Row label="Postal code" value={supplier.postalCode} />
        <Row label="Country" value={supplier.country} />
      </Card>

      <Card title="Banking">
        <Row label="Bank" value={supplier.bankName} />
        <Row label="Account" value={supplier.bankAccountNumber} />
        <Row label="IBAN" value={supplier.iban} />
        <Row label="SWIFT / BIC" value={supplier.swift} />
      </Card>

      <Card title="Categories" wide>
        <div className="flex flex-wrap gap-2">
          {categories.length === 0 && <p className="text-xs text-slate-400">No categories defined yet.</p>}
          {categories.map((c) => {
            const isOn = linked.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => (isOn ? detach.mutate(c.id) : attach.mutate(c.id))}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition ${isOn ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <Tag size={11} /> {c.name}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Notes" wide>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{supplier.notes || <span className="text-slate-400">No notes.</span>}</p>
      </Card>
    </div>
  );
}

function Card({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-100 bg-white p-4 shadow-sm ${wide ? 'md:col-span-2' : ''}`}>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="min-w-[120px] text-xs font-medium text-slate-500">{label}</dt>
      <dd className="flex-1 text-right font-medium text-slate-700">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

// ─── Products ───────────────────────────────────────────────────────────────

function ProductsTab({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const { data: links = [] } = useQuery({ queryKey: ['supplier-products', supplierId], queryFn: () => supplierService.products.list(supplierId) });
  const { data: allProducts = [] } = useQuery({ queryKey: ['products'], queryFn: () => productService.list() });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ productId: '', supplierSku: '', agreedPrice: '', moq: '1', leadTimeDays: '', priority: '1' });

  const upsert = useMutation({
    mutationFn: () => supplierService.products.upsert(supplierId, {
      productId: form.productId,
      supplierSku: form.supplierSku || null,
      agreedPrice: Number(form.agreedPrice),
      moq: Number(form.moq),
      leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
      priority: Number(form.priority) as 1 | 2 | 3,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-products', supplierId] });
      qc.invalidateQueries({ queryKey: ['supplier', supplierId] });
      setAdding(false); setError(null);
      setForm({ productId: '', supplierSku: '', agreedPrice: '', moq: '1', leadTimeDays: '', priority: '1' });
    },
    onError: (e: unknown) => setError(extract(e)),
  });

  const remove = useMutation({
    mutationFn: (productId: string) => supplierService.products.remove(supplierId, productId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-products', supplierId] }),
  });

  const linkedIds = new Set(links.map((l) => l.productId));
  const candidates = (allProducts as Array<{ id: string; sku: string; name: string }>).filter((p) => !linkedIds.has(p.id));

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">{links.length} product(s) supplied</h3>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"><Plus size={12} /> Link product</button>
      </div>

      {adding && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          {error && <div className="mb-2 rounded-md border border-rose-200 bg-rose-100 px-3 py-1.5 text-xs text-rose-700">{error}</div>}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="md:col-span-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm">
              <option value="">— choose product —</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
            <input placeholder="Supplier SKU" value={form.supplierSku} onChange={(e) => setForm({ ...form, supplierSku: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="number" step="0.01" placeholder="Price" value={form.agreedPrice} onChange={(e) => setForm({ ...form, agreedPrice: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="number" placeholder="MOQ" value={form.moq} onChange={(e) => setForm({ ...form, moq: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="number" placeholder="Lead days" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
              <option value="1">Primary</option><option value="2">Secondary</option><option value="3">Backup</option>
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <button disabled={!form.productId || !form.agreedPrice || upsert.isPending} onClick={() => upsert.mutate()} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60">Save link</button>
            <button onClick={() => { setAdding(false); setError(null); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>{['Priority', 'SKU', 'Product', 'Supplier SKU', 'Agreed Price', 'MOQ', 'Lead Time', ''].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {links.map((l: SupplierProductLink) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-2"><PriorityPill p={l.priority} /></td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{l.product?.sku}</td>
                <td className="px-4 py-2 font-medium text-slate-700">{l.product?.name}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{l.supplierSku || '—'}</td>
                <td className="px-4 py-2 text-slate-700">{Number(l.agreedPrice).toFixed(2)}</td>
                <td className="px-4 py-2 text-slate-700">{l.moq}</td>
                <td className="px-4 py-2 text-slate-700">{l.leadTimeDays != null ? `${l.leadTimeDays}d` : '—'}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => { if (confirm('Remove this product link?')) remove.mutate(l.productId); }} className="text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {links.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400">No products linked yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriorityPill({ p }: { p: 1 | 2 | 3 }) {
  const map = { 1: ['PRIMARY', 'bg-emerald-100 text-emerald-700'], 2: ['SECONDARY', 'bg-amber-100 text-amber-700'], 3: ['BACKUP', 'bg-slate-100 text-slate-600'] } as const;
  const [label, css] = map[p];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${css}`}>{label}</span>;
}

// ─── Contacts ───────────────────────────────────────────────────────────────

function ContactsTab({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const { data: contacts = [] } = useQuery({ queryKey: ['supplier-contacts', supplierId], queryFn: () => supplierService.contacts.list(supplierId) });
  const [editing, setEditing] = useState<SupplierContact | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<SupplierContact>>({ name: '', role: '', email: '', phone: '', isPrimary: false });
  const [error, setError] = useState<string | null>(null);

  const start = (c?: SupplierContact) => {
    if (c) { setEditing(c); setForm(c); } else { setEditing(null); setForm({ name: '', role: '', email: '', phone: '', isPrimary: false }); }
    setAdding(true); setError(null);
  };

  const save = useMutation({
    mutationFn: () => editing
      ? supplierService.contacts.update(supplierId, editing.id, form)
      : supplierService.contacts.create(supplierId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-contacts', supplierId] });
      qc.invalidateQueries({ queryKey: ['supplier', supplierId] });
      setAdding(false); setEditing(null);
    },
    onError: (e: unknown) => setError(extract(e)),
  });

  const remove = useMutation({
    mutationFn: (cid: string) => supplierService.contacts.delete(supplierId, cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-contacts', supplierId] }),
  });

  const setPrimary = useMutation({
    mutationFn: (cid: string) => supplierService.contacts.update(supplierId, cid, { isPrimary: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-contacts', supplierId] }),
  });

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">{contacts.length} contact(s)</h3>
        <button onClick={() => start()} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"><Plus size={12} /> Add contact</button>
      </div>

      {adding && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
          {error && <div className="rounded-md border border-rose-200 bg-rose-100 px-3 py-1.5 text-xs text-rose-700">{error}</div>}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <input placeholder="Name *" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input placeholder="Role" value={form.role ?? ''} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="email" placeholder="Email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input placeholder="Phone" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <label className="md:col-span-2 inline-flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={!!form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> Mark as primary
            </label>
          </div>
          <div className="flex gap-2">
            <button disabled={!form.name || save.isPending} onClick={() => save.mutate()} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60">{editing ? 'Save changes' : 'Add contact'}</button>
            <button onClick={() => { setAdding(false); setEditing(null); setError(null); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {contacts.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-slate-800">
                {c.name}
                {c.isPrimary && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><Star size={10} /> PRIMARY</span>}
              </p>
              <p className="text-xs text-slate-500">{c.role || '—'} · {c.email || '—'} · {c.phone || '—'}</p>
            </div>
            <div className="flex items-center gap-2">
              {!c.isPrimary && <button onClick={() => setPrimary.mutate(c.id)} className="text-xs font-semibold text-emerald-700 hover:underline">Set primary</button>}
              <button onClick={() => start(c)} className="text-slate-500 hover:text-slate-800"><Edit size={14} /></button>
              <button onClick={() => { if (confirm('Delete this contact?')) remove.mutate(c.id); }} className="text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {contacts.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-400">No contacts yet.</p>}
      </div>
    </div>
  );
}

// ─── Documents ──────────────────────────────────────────────────────────────

function DocumentsTab({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState('');
  const { data: docs = [] } = useQuery({
    queryKey: ['supplier-docs', supplierId, category],
    queryFn: () => supplierService.documents.list(supplierId, { category: category || undefined }),
  });

  const [uploading, setUploading] = useState(false);
  const [upCategory, setUpCategory] = useState<typeof DOC_CATEGORIES[number]>('CONTRACT');
  const [upTitle, setUpTitle] = useState('');
  const [upExpires, setUpExpires] = useState('');
  const [upFile, setUpFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      if (!upFile) throw new Error('Pick a file');
      const fd = new FormData();
      fd.append('file', upFile);
      fd.append('category', upCategory);
      if (upTitle) fd.append('title', upTitle);
      if (upExpires) fd.append('expiresAt', upExpires);
      return supplierService.documents.upload(supplierId, fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-docs', supplierId] });
      setUploading(false); setError(null); setUpFile(null); setUpTitle(''); setUpExpires('');
    },
    onError: (e: unknown) => setError(extract(e)),
  });

  const remove = useMutation({
    mutationFn: (docId: string) => supplierService.documents.delete(docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-docs', supplierId] }),
  });

  const handleDownload = async (doc: SupplierDocument) => {
    const blob = await supplierService.documents.download(doc.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = doc.filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-700">{docs.length} document(s)</h3>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
            <option value="">All categories</option>
            {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </div>
        <button onClick={() => setUploading(true)} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"><Upload size={12} /> Upload</button>
      </div>

      {uploading && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
          {error && <div className="rounded-md border border-rose-200 bg-rose-100 px-3 py-1.5 text-xs text-rose-700">{error}</div>}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <select value={upCategory} onChange={(e) => setUpCategory(e.target.value as typeof DOC_CATEGORIES[number])} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
              {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
            <input placeholder="Title (optional)" value={upTitle} onChange={(e) => setUpTitle(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="date" value={upExpires} onChange={(e) => setUpExpires(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input type="file" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <div className="flex gap-2">
            <button disabled={!upFile || upload.isPending} onClick={() => upload.mutate()} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60">Upload file</button>
            <button onClick={() => { setUploading(false); setError(null); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
          <p className="text-[11px] text-slate-400">Allowed: PDF, PNG, JPG, DOCX, XLSX, TXT · max 10 MB</p>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {docs.map((d: SupplierDocument) => {
          const expiresSoon = d.expiresAt && new Date(d.expiresAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
          return (
            <div key={d.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium text-slate-800">{d.title}</p>
                <p className="text-xs text-slate-500">
                  {d.category.replace('_', ' ')} · {d.filename} · {fmtBytes(d.sizeBytes)} · uploaded {fmtDate(d.createdAt)}
                  {d.expiresAt && (
                    <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${expiresSoon ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      Expires {fmtDate(d.expiresAt)}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDownload(d)} className="text-slate-500 hover:text-slate-800" title="Download"><Download size={14} /></button>
                <button onClick={() => { if (confirm('Delete this document?')) remove.mutate(d.id); }} className="text-rose-500 hover:text-rose-700" title="Delete"><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
        {docs.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-400">No documents.</p>}
      </div>
    </div>
  );
}

// ─── Performance ────────────────────────────────────────────────────────────

function PerformanceTab({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ['supplier-perf', supplierId], queryFn: () => supplierService.performance.list(supplierId) });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', onTimeRate: '', fillRate: '', defectRate: '', leadTimeMean: '', leadTimeStd: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [recompute, setRecompute] = useState<string | null>(null);

  const upsert = useMutation({
    mutationFn: () => supplierService.performance.upsert(supplierId, {
      periodStart: form.periodStart, periodEnd: form.periodEnd,
      onTimeRate: form.onTimeRate === '' ? null : Number(form.onTimeRate),
      fillRate: form.fillRate === '' ? null : Number(form.fillRate),
      defectRate: form.defectRate === '' ? null : Number(form.defectRate),
      leadTimeMean: form.leadTimeMean === '' ? null : Number(form.leadTimeMean),
      leadTimeStd: form.leadTimeStd === '' ? null : Number(form.leadTimeStd),
      notes: form.notes || null,
      source: 'MANUAL',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-perf', supplierId] });
      setAdding(false); setError(null);
      setForm({ periodStart: '', periodEnd: '', onTimeRate: '', fillRate: '', defectRate: '', leadTimeMean: '', leadTimeStd: '', notes: '' });
    },
    onError: (e: unknown) => setError(extract(e)),
  });

  const recomputeMut = useMutation({
    mutationFn: () => supplierService.performance.recompute(supplierId),
    onSuccess: (r) => setRecompute(r.message || r.status),
    onError: (e: unknown) => setRecompute(extract(e)),
  });

  // Tiny line: max bar widths for last 12 periods
  const chart = useMemo(() => {
    const sorted = [...rows].sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime());
    return sorted.slice(-12);
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Trend (last 12 periods)</h3>
          <button onClick={() => recomputeMut.mutate()} disabled={recomputeMut.isPending} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCcw size={12} /> Recompute (auto)</button>
        </div>
        {recompute && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{recompute}</div>}
        {chart.length === 0 ? (
          <p className="text-xs text-slate-400">No performance data yet. Add a manual scorecard below.</p>
        ) : (
          <div className="space-y-2">
            {chart.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-xs">
                <span className="w-24 font-mono text-slate-500">{fmtDate(r.periodStart)}</span>
                <Bar label="On-time" value={r.onTimeRate} color="bg-emerald-400" />
                <Bar label="Fill"    value={r.fillRate}   color="bg-blue-400" />
                <Bar label="Defect"  value={r.defectRate} color="bg-rose-400" />
                <span className="w-20 text-right font-bold text-slate-700">Score: {r.overallScore == null ? '—' : (r.overallScore * 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Scorecards</h3>
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"><Plus size={12} /> Add scorecard</button>
        </div>
        {adding && (
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
            {error && <div className="rounded-md border border-rose-200 bg-rose-100 px-3 py-1.5 text-xs text-rose-700">{error}</div>}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <PerfInput type="date" label="Period start *" value={form.periodStart} onChange={(v) => setForm({ ...form, periodStart: v })} />
              <PerfInput type="date" label="Period end *" value={form.periodEnd} onChange={(v) => setForm({ ...form, periodEnd: v })} />
              <PerfInput label="On-time (0–1)" value={form.onTimeRate} onChange={(v) => setForm({ ...form, onTimeRate: v })} />
              <PerfInput label="Fill (0–1)"    value={form.fillRate}   onChange={(v) => setForm({ ...form, fillRate: v })} />
              <PerfInput label="Defect (0–1)"  value={form.defectRate} onChange={(v) => setForm({ ...form, defectRate: v })} />
              <PerfInput label="LT mean (d)"   value={form.leadTimeMean} onChange={(v) => setForm({ ...form, leadTimeMean: v })} />
              <PerfInput label="LT std (d)"    value={form.leadTimeStd}  onChange={(v) => setForm({ ...form, leadTimeStd: v })} />
              <PerfInput label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
            </div>
            <div className="flex gap-2">
              <button disabled={!form.periodStart || !form.periodEnd || upsert.isPending} onClick={() => upsert.mutate()} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60">Save scorecard</button>
              <button onClick={() => { setAdding(false); setError(null); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{['Period', 'On-time', 'Fill', 'Defect', 'LT mean', 'LT std', 'Score', 'Source'].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: SupplierPerformance) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-xs">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                  <td className="px-4 py-2">{fmtPct(r.onTimeRate)}</td>
                  <td className="px-4 py-2">{fmtPct(r.fillRate)}</td>
                  <td className="px-4 py-2">{fmtPct(r.defectRate)}</td>
                  <td className="px-4 py-2">{r.leadTimeMean ?? '—'}</td>
                  <td className="px-4 py-2">{r.leadTimeStd ?? '—'}</td>
                  <td className="px-4 py-2 font-bold">{r.overallScore == null ? '—' : (r.overallScore * 100).toFixed(0)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{r.source}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400">No scorecards yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex flex-1 items-center gap-2">
      <span className="w-14 text-[10px] text-slate-400">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-[10px] text-slate-500">{value == null ? '—' : (value * 100).toFixed(0)}</span>
    </div>
  );
}
function PerfInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
    </label>
  );
}

// ─── Activity ───────────────────────────────────────────────────────────────

function ActivityTab({ supplierId }: { supplierId: string }) {
  const { data: events = [] } = useQuery({ queryKey: ['supplier-activity', supplierId], queryFn: () => supplierService.activity(supplierId, { limit: 50 }) });
  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">Latest 50 events</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {events.map((e: SupplierActivityEntry) => (
          <div key={e.id} className="flex items-baseline justify-between gap-3 px-4 py-2 text-xs">
            <span className="font-mono text-slate-400">{new Date(e.occurredAt).toLocaleString()}</span>
            <span className="flex-1 font-semibold text-slate-700">{e.eventType}</span>
            <span className="text-slate-500">{e.entityType}</span>
          </div>
        ))}
        {events.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-400">No activity yet.</p>}
      </div>
    </div>
  );
}

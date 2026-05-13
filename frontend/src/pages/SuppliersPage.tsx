/**
 * SuppliersPage — polished list with KPI cards, filters, search, and create.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Search, Tag } from 'lucide-react';
import { supplierService } from '../services';
import type { Supplier } from '../types/supplier';
import SupplierFormSlideOver from './suppliers/SupplierFormSlideOver';
import CategoryManagerModal from './suppliers/CategoryManagerModal';
import { APPROVAL_STATUSES, RISK_RATINGS, approvalBadge, riskBadge } from './suppliers/shared';

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [country, setCountry] = useState('');
  const [riskRating, setRiskRating] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: kpis } = useQuery({ queryKey: ['supplier-kpis'], queryFn: supplierService.kpis });
  const { data: categories = [] } = useQuery({ queryKey: ['supplier-categories'], queryFn: supplierService.categories.list });

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', { search, approvalStatus, country, riskRating, categoryId }],
    queryFn: () => supplierService.list({
      search: search || undefined,
      approvalStatus: approvalStatus || undefined,
      country: country || undefined,
      riskRating: riskRating || undefined,
      categoryId: categoryId || undefined,
      limit: 200,
    }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const createMut = useMutation({
    mutationFn: (payload: Partial<Supplier>) => supplierService.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier-kpis'] });
      setFormOpen(false);
      setSaveError(null);
    },
    onError: (e: unknown) => setSaveError(extractError(e)),
  });

  const countries = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.country && s.add(r.country));
    return Array.from(s).sort();
  }, [rows]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users size={20} /> Suppliers</h2>
          <p className="text-slate-500 text-sm">{total} suppliers · CRUD, contacts, products, documents, performance</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCatManagerOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Tag size={14} /> Categories</button>
          <button onClick={() => { setFormOpen(true); setSaveError(null); }} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"><Plus size={14} /> New supplier</button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'Active',         value: kpis?.active ?? 0,                tone: 'text-slate-700' },
          { label: 'Preferred',      value: kpis?.preferred ?? 0,             tone: 'text-emerald-600' },
          { label: 'Under review',   value: kpis?.underReview ?? 0,           tone: 'text-amber-600' },
          { label: 'Blocked',        value: kpis?.blocked ?? 0,               tone: 'text-rose-600' },
          { label: 'Docs ≤30d exp',  value: kpis?.documentsExpiringSoon ?? 0, tone: (kpis?.documentsExpiringSoon ?? 0) > 0 ? 'text-amber-600' : 'text-slate-700' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className={`mt-1 text-lg font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name, legal name, email…"
            className="w-full rounded-md border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <select value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
          <option value="">All statuses</option>
          {APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={riskRating} onChange={(e) => setRiskRating(e.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
          <option value="">All risk</option>
          {RISK_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['Code', 'Name', 'Status', 'Categories', 'Country', 'Lead Time', 'Terms', 'Currency', 'Risk'].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-400">No suppliers match the current filters.</td></tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500"><Link to={`/suppliers/${s.id}`}>{s.code}</Link></td>
                  <td className="px-5 py-3 font-medium text-slate-800"><Link to={`/suppliers/${s.id}`}>{s.name}</Link></td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${approvalBadge(s.approvalStatus)}`}>
                      {s.approvalStatus.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    <div className="flex flex-wrap gap-1">
                      {(s.categoryLinks ?? []).map((l) => (
                        <span key={l.categoryId} className="rounded-full bg-slate-100 px-2 py-0.5">{l.category?.name || l.categoryId}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{s.country ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{s.leadTimeDays} d</td>
                  <td className="px-5 py-3 text-slate-600">{s.paymentTerms}</td>
                  <td className="px-5 py-3 text-slate-600">{s.currency}</td>
                  <td className="px-5 py-3">
                    {s.riskRating ? (
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${riskBadge(s.riskRating)}`}>{s.riskRating}</span>
                    ) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SupplierFormSlideOver
        open={formOpen}
        supplier={null}
        onClose={() => setFormOpen(false)}
        onSubmit={async (d) => { await createMut.mutateAsync(d); }}
        saving={createMut.isPending}
        error={saveError}
      />

      {catManagerOpen && <CategoryManagerModal onClose={() => setCatManagerOpen(false)} />}
    </div>
  );
}

function extractError(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error || ax?.message || 'Operation failed';
}

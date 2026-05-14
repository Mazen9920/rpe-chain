import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, X } from 'lucide-react';
import { apInvoiceService, paymentService, apAgingService, settingsService } from '../services';
import type { InvoiceStatus, InvoiceType, AgingBucket } from '../types/ap';

type Tab = 'invoices' | 'match' | 'payments' | 'aging';

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  RECEIVED: 'bg-blue-100 text-blue-700',
  MATCHED: 'bg-emerald-100 text-emerald-700',
  EXCEPTION: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-indigo-100 text-indigo-700',
  PARTIALLY_PAID: 'bg-cyan-100 text-cyan-700',
  PAID: 'bg-emerald-100 text-emerald-800',
  VOID: 'bg-rose-100 text-rose-700',
};

const BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: 'Current',
  '1_30': '1–30',
  '31_60': '31–60',
  '61_90': '61–90',
  OVER_90: '90+',
};

const fmt = (n?: number | null, cur = 'USD') => {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 });
};

export default function AccountsPayablePage() {
  const [tab, setTab] = useState<Tab>('invoices');
  const [tolerancesOpen, setTolerancesOpen] = useState(false);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Accounts Payable</h2>
          <p className="text-sm text-slate-500">Supplier invoices, matching, payments & aging</p>
        </div>
        <button
          onClick={() => setTolerancesOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <Settings size={14} /> Match tolerances
        </button>
      </div>

      <KpiBar />

      <div className="border-b border-slate-200 flex gap-1">
        {([
          ['invoices', 'Invoices'],
          ['match', 'Match Queue'],
          ['payments', 'Payments'],
          ['aging', 'Aging'],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'match' && <MatchQueueTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'aging' && <AgingTab />}

      {tolerancesOpen && <MatchTolerancesDrawer onClose={() => setTolerancesOpen(false)} />}
    </div>
  );
}

function MatchTolerancesDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{
    global: { qtyPct: number; pricePct: number; qtySource: string; priceSource: string };
    overrides: Array<{ supplierId: string; supplierCode: string; supplierName: string; qtyPct: number | null; pricePct: number | null }>;
    bounds: { min: number; max: number };
  }>({ queryKey: ['settings', 'match-tolerances'], queryFn: settingsService.getMatchTolerances });

  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');

  const updateGlobal = useMutation({
    mutationFn: (body: { qtyPct?: number; pricePct?: number }) => settingsService.updateGlobalMatchTolerances(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'match-tolerances'] });
      setQty('');
      setPrice('');
    },
  });

  const onSaveGlobal = () => {
    const body: { qtyPct?: number; pricePct?: number } = {};
    if (qty !== '') body.qtyPct = Number(qty);
    if (price !== '') body.pricePct = Number(price);
    if (Object.keys(body).length > 0) updateGlobal.mutate(body);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-xl bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <div className="text-sm text-slate-500">Settings</div>
            <div className="text-lg font-semibold text-slate-800">3-way match tolerances</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-6">
          {isLoading || !data ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-sm font-medium text-slate-700 mb-3">Global defaults</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <label className="block">
                    <span className="text-slate-600">Qty tolerance % <span className="text-xs text-slate-400">(current: {data.global.qtyPct}% · {data.global.qtySource})</span></span>
                    <input
                      type="number" min={data.bounds.min} max={data.bounds.max} step="0.1"
                      value={qty} onChange={(e) => setQty(e.target.value)}
                      placeholder={String(data.global.qtyPct)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-600">Price tolerance % <span className="text-xs text-slate-400">(current: {data.global.pricePct}% · {data.global.priceSource})</span></span>
                    <input
                      type="number" min={data.bounds.min} max={data.bounds.max} step="0.1"
                      value={price} onChange={(e) => setPrice(e.target.value)}
                      placeholder={String(data.global.pricePct)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                </div>
                <button
                  onClick={onSaveGlobal}
                  disabled={updateGlobal.isPending || (qty === '' && price === '')}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Save globals
                </button>
                {updateGlobal.isError ? (
                  <div className="mt-2 text-xs text-red-600">{(updateGlobal.error as Error)?.message || 'Update failed'}</div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-sm font-medium text-slate-700 mb-3">Per-supplier overrides ({data.overrides.length})</div>
                {data.overrides.length === 0 ? (
                  <div className="text-xs text-slate-500">No overrides. Use a supplier's detail page to set per-supplier tolerances.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 text-xs uppercase">
                        <th className="py-1">Supplier</th><th>Qty %</th><th>Price %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.overrides.map((o) => (
                        <tr key={o.supplierId}>
                          <td className="py-2 text-slate-700">{o.supplierCode} — {o.supplierName}</td>
                          <td className="py-2">{o.qtyPct != null ? `${o.qtyPct}%` : <span className="text-slate-400">—</span>}</td>
                          <td className="py-2">{o.pricePct != null ? `${o.pricePct}%` : <span className="text-slate-400">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="text-xs text-slate-500">
                Tolerances resolve: <strong>per-supplier override</strong> → <strong>global</strong> → defaults (2% qty / 1% price). Allowed range: {data.bounds.min}–{data.bounds.max}%.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiBar() {
  const { data } = useQuery({ queryKey: ['ap-kpis'], queryFn: () => apInvoiceService.kpis() });
  const card = (label: string, value: string, hint?: string, tone: 'default' | 'warn' = 'default') => (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-5 py-3 flex-1 min-w-[160px]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${tone === 'warn' ? 'text-amber-700' : 'text-slate-800'}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
  return (
    <div className="flex gap-3 flex-wrap">
      {card('Total invoices', String(data?.total ?? '—'))}
      {card('Open liability', fmt(data?.openLiability))}
      {card('Exceptions', String(data?.exceptionCount ?? '—'), 'Awaiting override', data?.exceptionCount ? 'warn' : 'default')}
      {card('In matching', String((data?.byStatus?.RECEIVED ?? 0) + (data?.byStatus?.MATCHED ?? 0)))}
    </div>
  );
}

function InvoicesTab() {
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [type, setType] = useState<InvoiceType | ''>('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ap-invoices', { status, type, search }],
    queryFn: () => apInvoiceService.list({
      status: status || undefined,
      invoiceType: type || undefined,
      search: search || undefined,
      limit: 100,
    }),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by invoice #..."
          className="px-3 py-1.5 border border-slate-200 rounded-md text-sm flex-1 min-w-[200px]"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)} className="px-2 py-1.5 border border-slate-200 rounded-md text-sm">
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as InvoiceType)} className="px-2 py-1.5 border border-slate-200 rounded-md text-sm">
          <option value="">All types</option>
          <option value="STANDARD">Standard</option>
          <option value="CREDIT_NOTE">Credit Note</option>
          <option value="DEBIT_NOTE">Debit Note</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>{['Invoice #', 'Supplier', 'Type', 'Status', 'Amount', 'Paid', 'Due', ''].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-400">No invoices yet</td></tr>
            ) : rows.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link to={`/ap/invoices/${inv.id}`} className="text-blue-600 hover:underline">{inv.invoiceNumber}</Link>
                </td>
                <td className="px-5 py-3 text-slate-700">{inv.supplier?.name ?? '—'}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{inv.invoiceType}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                </td>
                <td className="px-5 py-3 text-slate-700 tabular-nums">{fmt(inv.amount, inv.currency)}</td>
                <td className="px-5 py-3 text-slate-500 tabular-nums">{fmt(inv.paidAmount, inv.currency)}</td>
                <td className="px-5 py-3 text-slate-500">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</td>
                <td className="px-5 py-3 text-right">
                  <Link to={`/ap/invoices/${inv.id}`} className="text-xs text-blue-600 hover:underline">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchQueueTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ap-match-queue'],
    queryFn: () => apInvoiceService.list({ status: 'EXCEPTION', limit: 100 }),
  });
  const received = useQuery({
    queryKey: ['ap-match-received'],
    queryFn: () => apInvoiceService.list({ status: 'RECEIVED', limit: 100 }),
  });
  const exceptions = data?.rows ?? [];
  const pending = received.data?.rows ?? [];

  const Section = ({ title, rows, tone }: { title: string; rows: typeof exceptions; tone: 'amber' | 'blue' }) => (
    <div className="space-y-2">
      <h3 className={`text-sm font-semibold ${tone === 'amber' ? 'text-amber-800' : 'text-blue-800'}`}>{title} ({rows.length})</h3>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>{['Invoice #', 'Supplier', 'PO', 'Amount', 'Variance', ''].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">None</td></tr>
            ) : rows.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link to={`/ap/invoices/${inv.id}`} className="text-blue-600 hover:underline">{inv.invoiceNumber}</Link>
                </td>
                <td className="px-5 py-3 text-slate-700">{inv.supplier?.name ?? '—'}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{inv.purchaseOrderId ? inv.purchaseOrderId.slice(0, 8) : '—'}</td>
                <td className="px-5 py-3 tabular-nums">{fmt(inv.amount, inv.currency)}</td>
                <td className="px-5 py-3 tabular-nums text-amber-700">{fmt(inv.varianceAmount, inv.currency)}</td>
                <td className="px-5 py-3 text-right">
                  <Link to={`/ap/invoices/${inv.id}`} className="text-xs text-blue-600 hover:underline">Resolve →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (isLoading) return <div className="text-sm text-slate-400 p-6 text-center">Loading…</div>;
  return (
    <div className="space-y-6">
      <Section title="Exceptions" rows={exceptions} tone="amber" />
      <Section title="Pending match (RECEIVED)" rows={pending} tone="blue" />
    </div>
  );
}

function PaymentsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ap-payments'],
    queryFn: () => paymentService.list({ limit: 100 }),
  });
  const rows = data?.rows ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>{['Date', 'Supplier', 'Amount', 'Method', 'Reference', 'Status', 'Applications'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">No payments yet</td></tr>
          ) : rows.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="px-5 py-3 text-slate-700">{new Date(p.paymentDate).toLocaleDateString()}</td>
              <td className="px-5 py-3 text-slate-700">{p.supplier?.name ?? '—'}</td>
              <td className="px-5 py-3 tabular-nums">{fmt(p.amount, p.currency)}</td>
              <td className="px-5 py-3 text-xs text-slate-500">{p.method}</td>
              <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.reference ?? '—'}</td>
              <td className="px-5 py-3">
                <span className={`text-xs px-2 py-0.5 rounded ${p.status === 'VOIDED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{p.status}</span>
              </td>
              <td className="px-5 py-3 text-xs text-slate-500">
                {/* @ts-expect-error _count is from list endpoint */}
                {p._count?.applications ?? p.applications?.length ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgingTab() {
  const { data, isLoading } = useQuery({ queryKey: ['ap-aging-summary'], queryFn: () => apAgingService.summary() });
  if (isLoading) return <div className="text-sm text-slate-400 p-6 text-center">Loading…</div>;
  if (!data) return null;
  const buckets: AgingBucket[] = ['CURRENT', '1_30', '31_60', '61_90', 'OVER_90'];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        {buckets.map((b) => (
          <div key={b} className="bg-white rounded-xl border border-slate-100 shadow-sm px-5 py-3 flex-1 min-w-[140px]">
            <div className="text-xs text-slate-500">{BUCKET_LABELS[b]}</div>
            <div className={`text-lg font-bold tabular-nums ${b === 'OVER_90' ? 'text-rose-700' : b === '61_90' ? 'text-amber-700' : 'text-slate-800'}`}>
              {fmt(data.totals[b])}
            </div>
          </div>
        ))}
        <div className="bg-slate-800 text-white rounded-xl shadow-sm px-5 py-3 flex-1 min-w-[140px]">
          <div className="text-xs opacity-70">Total open</div>
          <div className="text-lg font-bold tabular-nums">{fmt(data.totals.total)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Supplier</th>
              {buckets.map((b) => <th key={b} className="px-5 py-3 font-medium text-right">{BUCKET_LABELS[b]}</th>)}
              <th className="px-5 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.suppliers.length === 0 ? (
              <tr><td colSpan={buckets.length + 2} className="px-5 py-12 text-center text-slate-400">No open invoices</td></tr>
            ) : data.suppliers.map((s) => (
              <tr key={s.supplierId} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <Link to={`/suppliers/${s.supplierId}`} className="text-blue-600 hover:underline">{s.supplierName}</Link>
                  <span className="ml-2 text-xs font-mono text-slate-400">{s.supplierCode}</span>
                </td>
                {buckets.map((b) => (
                  <td key={b} className={`px-5 py-3 text-right tabular-nums ${s[b] > 0 && (b === 'OVER_90' || b === '61_90') ? 'text-amber-700 font-medium' : 'text-slate-700'}`}>
                    {s[b] > 0 ? fmt(s[b]) : '—'}
                  </td>
                ))}
                <td className="px-5 py-3 text-right tabular-nums font-semibold">{fmt(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

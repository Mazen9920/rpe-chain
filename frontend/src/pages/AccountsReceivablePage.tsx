import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { arInvoiceService, customerPaymentService, arAgingService, arCreditNoteService } from '../services';
import type { CustomerInvoiceStatus, InvoiceType, AgingBucket } from '../types/ar';
import { formatMoney } from '../utils/format';

type Tab = 'invoices' | 'payments' | 'aging' | 'credit-notes';

const STATUS_COLORS: Record<CustomerInvoiceStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  POSTED: 'bg-blue-100 text-blue-700',
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

const fmt = (n?: number | null, cur = 'USD') => formatMoney(n, cur);

export default function AccountsReceivablePage() {
  const [tab, setTab] = useState<Tab>('invoices');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Accounts Receivable</h2>
          <p className="text-sm text-slate-500">Customer invoices, payments & aging</p>
        </div>
      </div>

      <KpiBar />

      <div className="border-b border-slate-200 flex gap-1">
        {([
          ['invoices', 'Invoices'],
          ['payments', 'Payments'],
          ['aging', 'Aging'],
          ['credit-notes', 'Credit Notes'],
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
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'aging' && <AgingTab />}
      {tab === 'credit-notes' && <CreditNotesTab />}
    </div>
  );
}

function KpiBar() {
  const { data } = useQuery({ queryKey: ['ar-kpis'], queryFn: () => arInvoiceService.kpis() });
  const card = (label: string, value: string) => (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-5 py-3 flex-1 min-w-[160px]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-800">{value}</div>
    </div>
  );
  return (
    <div className="flex gap-3 flex-wrap">
      {card('Total invoices', String(data?.total ?? '—'))}
      {card('Open receivable', fmt(data?.openReceivable))}
      {card('Posted', String(data?.byStatus?.POSTED ?? 0))}
      {card('Partially paid', String(data?.byStatus?.PARTIALLY_PAID ?? 0))}
      {card('Paid', String(data?.byStatus?.PAID ?? 0))}
    </div>
  );
}

function InvoicesTab() {
  const [status, setStatus] = useState<CustomerInvoiceStatus | ''>('');
  const [type, setType] = useState<InvoiceType | ''>('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ar-invoices', { status, type, search }],
    queryFn: () => arInvoiceService.list({
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
        <select value={status} onChange={(e) => setStatus(e.target.value as CustomerInvoiceStatus)} className="px-2 py-1.5 border border-slate-200 rounded-md text-sm">
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
            <tr>{['Invoice #', 'Customer', 'Type', 'Status', 'Amount', 'Paid', 'Due', ''].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
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
                  <Link to={`/ar/invoices/${inv.id}`} className="text-blue-600 hover:underline">{inv.invoiceNumber}</Link>
                </td>
                <td className="px-5 py-3 text-slate-700">{inv.customer?.name ?? '—'}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{inv.invoiceType}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                </td>
                <td className="px-5 py-3 text-slate-700 tabular-nums">{fmt(inv.amount, inv.currency)}</td>
                <td className="px-5 py-3 text-slate-500 tabular-nums">{fmt(inv.paidAmount, inv.currency)}</td>
                <td className="px-5 py-3 text-slate-500">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</td>
                <td className="px-5 py-3 text-right">
                  <Link to={`/ar/invoices/${inv.id}`} className="text-xs text-blue-600 hover:underline">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ar-payments'],
    queryFn: () => customerPaymentService.list({ limit: 100 }),
  });
  const rows = data?.rows ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>{['Date', 'Customer', 'Amount', 'Method', 'Reference', 'Status', ''].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
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
              <td className="px-5 py-3 text-slate-700">{p.customer?.name ?? '—'}</td>
              <td className="px-5 py-3 tabular-nums">{fmt(p.amount, p.currency)}</td>
              <td className="px-5 py-3 text-xs text-slate-500">{p.method}</td>
              <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.reference ?? '—'}</td>
              <td className="px-5 py-3">
                <span className={`text-xs px-2 py-0.5 rounded ${p.status === 'VOIDED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{p.status}</span>
              </td>
              <td className="px-5 py-3 text-right">
                <Link to={`/ar/payments/${p.id}`} className="text-xs text-blue-600 hover:underline">View →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgingTab() {
  const { data, isLoading } = useQuery({ queryKey: ['ar-aging-summary'], queryFn: () => arAgingService.summary() });
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
              {fmt(data.totals[b], data.reportingCurrency)}
            </div>
          </div>
        ))}
        <div className="bg-slate-800 text-white rounded-xl shadow-sm px-5 py-3 flex-1 min-w-[140px]">
          <div className="text-xs opacity-70">Total open</div>
          <div className="text-lg font-bold tabular-nums">{fmt(data.totals.total, data.reportingCurrency)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Customer</th>
              {buckets.map((b) => <th key={b} className="px-5 py-3 font-medium text-right">{BUCKET_LABELS[b]}</th>)}
              <th className="px-5 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.customers.length === 0 ? (
              <tr><td colSpan={buckets.length + 2} className="px-5 py-12 text-center text-slate-400">No open invoices</td></tr>
            ) : data.customers.map((c) => (
              <tr key={c.customerId} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <Link to={`/customers/${c.customerId}`} className="text-blue-600 hover:underline">{c.customerName}</Link>
                  <span className="ml-2 text-xs font-mono text-slate-400">{c.customerCode}</span>
                </td>
                {buckets.map((b) => (
                  <td key={b} className={`px-5 py-3 text-right tabular-nums ${c[b] > 0 && (b === 'OVER_90' || b === '61_90') ? 'text-amber-700 font-medium' : 'text-slate-700'}`}>
                    {c[b] > 0 ? fmt(c[b], data.reportingCurrency) : '—'}
                  </td>
                ))}
                <td className="px-5 py-3 text-right tabular-nums font-semibold">{fmt(c.total, data.reportingCurrency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreditNotesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ar-credit-notes'],
    queryFn: () => arCreditNoteService.list({ limit: 100 }),
  });
  const rows = data?.rows ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>{['Credit Note #', 'Customer', 'Status', 'Amount', 'Date', 'Original invoice', ''].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {isLoading ? (
            <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">No credit notes</td></tr>
          ) : rows.map((cn) => (
            <tr key={cn.id} className="hover:bg-slate-50">
              <td className="px-5 py-3 font-mono text-xs">
                <Link to={`/ar/invoices/${cn.id}`} className="text-blue-600 hover:underline">{cn.invoiceNumber}</Link>
              </td>
              <td className="px-5 py-3 text-slate-700">{cn.customer?.name ?? '—'}</td>
              <td className="px-5 py-3">
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[cn.status]}`}>{cn.status}</span>
              </td>
              <td className="px-5 py-3 tabular-nums">{fmt(cn.amount, cn.currency)}</td>
              <td className="px-5 py-3 text-slate-500">{new Date(cn.invoiceDate).toLocaleDateString()}</td>
              <td className="px-5 py-3 font-mono text-xs">
                {cn.creditedInvoiceId ? (
                  <Link to={`/ar/invoices/${cn.creditedInvoiceId}`} className="text-blue-600 hover:underline">
                    {cn.creditedInvoice?.invoiceNumber ?? cn.creditedInvoiceId.slice(0, 8)}
                  </Link>
                ) : '—'}
              </td>
              <td className="px-5 py-3 text-right">
                <Link to={`/ar/invoices/${cn.id}`} className="text-xs text-blue-600 hover:underline">View →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

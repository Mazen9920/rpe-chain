import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileText, Users, ShoppingBag } from 'lucide-react';
import { reportsService } from '../services';
import { formatMoney } from '../utils/format';

type Tab = 'ap-aging' | 'supplier-scorecards' | 'sales-fulfillment';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'ap-aging', label: 'AP Aging', icon: FileText },
  { id: 'supplier-scorecards', label: 'Supplier Scorecards', icon: Users },
  { id: 'sales-fulfillment', label: 'Sales Fulfillment', icon: ShoppingBag },
];

const money = (n: number | null | undefined, ccy?: string) =>
  n == null ? '—' : formatMoney(n, ccy || 'USD');
const pct = (n: number | null | undefined) => (n == null ? '—' : `${(Number(n) * 100).toFixed(1)}%`);
const bucketColor: Record<string, string> = {
  CURRENT: 'bg-emerald-50 text-emerald-700',
  '1-30': 'bg-amber-50 text-amber-700',
  '31-60': 'bg-orange-50 text-orange-700',
  '61-90': 'bg-red-50 text-red-700',
  '90+': 'bg-red-100 text-red-800 font-semibold',
};

type AgingRow = {
  supplierCode: string; supplierName: string;
  invoiceNumber: string; invoiceDate: string; dueDate: string;
  daysOverdue: number; bucket: string;
  amount: number; paidAmount: number; outstanding: number;
  currency: string; status: string;
};

type AgingResp = { rows: AgingRow[]; summary: { totalOutstanding: number; buckets: Record<string, number>; invoiceCount: number } };

function ApAgingReport() {
  const { data, isLoading } = useQuery<AgingResp>({
    queryKey: ['report', 'ap-aging'],
    queryFn: () => reportsService.apAging(),
  });

  return (
    <div>
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <div className="text-sm text-slate-500">Outstanding supplier invoices by age bucket.</div>
        <button
          onClick={() => reportsService.downloadCsv('/reports/ap-aging', 'ap-aging.csv')}
          className="inline-flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-slate-900 text-white rounded-lg px-3 py-1.5"
        >
          <Download size={14} /> CSV
        </button>
      </div>
      {data?.summary ? (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 p-4 bg-slate-50 border-b border-slate-100">
          <div>
            <div className="text-xs text-slate-500">Outstanding</div>
            <div className="font-bold text-slate-800">{money(data.summary.totalOutstanding)}</div>
          </div>
          {['CURRENT', '1-30', '31-60', '61-90', '90+'].map((b) => (
            <div key={b}>
              <div className={`text-xs inline-block px-1.5 py-0.5 rounded ${bucketColor[b]}`}>{b}</div>
              <div className="font-bold text-slate-800">{money(data.summary.buckets[b] || 0)}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['Supplier', 'Invoice #', 'Due Date', 'Days Overdue', 'Bucket', 'Outstanding', 'Status'].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            ) : !data?.rows.length ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No outstanding invoices.</td></tr>
            ) : data.rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{r.supplierCode} — {r.supplierName}</td>
                <td className="px-4 py-3">{r.invoiceNumber}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(r.dueDate).toLocaleDateString()}</td>
                <td className="px-4 py-3">{r.daysOverdue}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${bucketColor[r.bucket]}`}>{r.bucket}</span></td>
                <td className="px-4 py-3 font-semibold">{money(r.outstanding, r.currency)}</td>
                <td className="px-4 py-3 text-slate-500">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ScorecardRow = {
  supplierCode: string; supplierName: string;
  hasData: boolean;
  onTimeRate?: number | null;
  fillRate?: number | null;
  defectRate?: number | null;
  leadTimeMean?: number | null;
  overallScore?: number | null;
  source?: string;
};

function SupplierScorecardsReport() {
  const { data, isLoading } = useQuery<{ rows: ScorecardRow[]; summary: { total: number; withData: number } }>({
    queryKey: ['report', 'supplier-scorecards'],
    queryFn: () => reportsService.supplierScorecards(),
  });

  return (
    <div>
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <div className="text-sm text-slate-500">On-time, fill-rate, defect-rate and overall composite scores.</div>
        <button
          onClick={() => reportsService.downloadCsv('/reports/supplier-scorecards', 'supplier-scorecards.csv')}
          className="inline-flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-slate-900 text-white rounded-lg px-3 py-1.5"
        >
          <Download size={14} /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['Supplier', 'On-time', 'Fill rate', 'Defect rate', 'Lead time', 'Overall', 'Source'].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            ) : !data?.rows.length ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No suppliers found.</td></tr>
            ) : data.rows.map((r) => (
              <tr key={r.supplierCode} className={`hover:bg-slate-50 ${r.hasData ? '' : 'opacity-50'}`}>
                <td className="px-4 py-3 font-medium">{r.supplierCode} — {r.supplierName}</td>
                <td className="px-4 py-3">{r.hasData ? pct(r.onTimeRate) : '—'}</td>
                <td className="px-4 py-3">{r.hasData ? pct(r.fillRate) : '—'}</td>
                <td className="px-4 py-3">{r.hasData ? pct(r.defectRate) : '—'}</td>
                <td className="px-4 py-3">{r.hasData && r.leadTimeMean != null ? `${r.leadTimeMean.toFixed(1)}d` : '—'}</td>
                <td className={`px-4 py-3 font-semibold ${
                  r.overallScore == null ? '' :
                  r.overallScore < 0.7 ? 'text-red-600' :
                  r.overallScore < 0.85 ? 'text-orange-600' : 'text-green-700'
                }`}>{r.hasData ? pct(r.overallScore) : '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.source || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.summary ? (
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
          {data.summary.withData} of {data.summary.total} suppliers have performance data.
        </div>
      ) : null}
    </div>
  );
}

type FulfillmentRow = {
  orderNumber: string;
  orderedAt: string;
  status: string;
  customerCode: string | null;
  customerName: string;
  qtyOrdered: number;
  qtyShipped: number;
  fillRate: number | null;
  revenue: number;
  currency: string;
  cycleHours: number | null;
  deliveredAt: string | null;
};

type FulfillmentResp = {
  rows: FulfillmentRow[];
  summary: {
    orderCount: number;
    totalRevenue: number;
    totalOrdered: number;
    totalShipped: number;
    overallFillRate: number | null;
    avgCycleHours: number | null;
  };
};

function SalesFulfillmentReport() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, isLoading } = useQuery<FulfillmentResp>({
    queryKey: ['report', 'sales-fulfillment', from, to],
    queryFn: () => reportsService.salesFulfillment({ from: from || undefined, to: to || undefined }),
  });

  return (
    <div>
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
          <label className="text-slate-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
        </div>
        <button
          onClick={() => reportsService.downloadCsv('/reports/sales-fulfillment', 'sales-fulfillment.csv', { ...(from ? { from } : {}), ...(to ? { to } : {}) })}
          className="inline-flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-slate-900 text-white rounded-lg px-3 py-1.5"
        >
          <Download size={14} /> CSV
        </button>
      </div>
      {data?.summary ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-slate-50 border-b border-slate-100">
          <div><div className="text-xs text-slate-500">Orders</div><div className="font-bold text-slate-800">{data.summary.orderCount}</div></div>
          <div><div className="text-xs text-slate-500">Revenue</div><div className="font-bold text-slate-800">{money(data.summary.totalRevenue)}</div></div>
          <div><div className="text-xs text-slate-500">Ordered</div><div className="font-bold text-slate-800">{data.summary.totalOrdered}</div></div>
          <div><div className="text-xs text-slate-500">Fill rate</div><div className="font-bold text-slate-800">{pct(data.summary.overallFillRate)}</div></div>
          <div><div className="text-xs text-slate-500">Avg cycle</div><div className="font-bold text-slate-800">{data.summary.avgCycleHours != null ? `${data.summary.avgCycleHours.toFixed(1)}h` : '—'}</div></div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['Order', 'Customer', 'Status', 'Ordered', 'Shipped', 'Fill rate', 'Revenue', 'Cycle', 'Date'].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            ) : !data?.rows.length ? (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">No orders match.</td></tr>
            ) : data.rows.map((r) => (
              <tr key={r.orderNumber} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{r.orderNumber}</td>
                <td className="px-4 py-3">{r.customerCode ? `${r.customerCode} — ` : ''}{r.customerName}</td>
                <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{r.status}</span></td>
                <td className="px-4 py-3">{r.qtyOrdered}</td>
                <td className="px-4 py-3">{r.qtyShipped}</td>
                <td className="px-4 py-3">{pct(r.fillRate)}</td>
                <td className="px-4 py-3">{money(r.revenue, r.currency)}</td>
                <td className="px-4 py-3 text-slate-500">{r.cycleHours != null ? `${r.cycleHours.toFixed(1)}h` : '—'}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(r.orderedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('ap-aging');

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><BarChart3 size={20} /> Reports</h2>
        <p className="text-slate-500 text-sm">Cross-module operational reports. Export to CSV for further analysis.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="border-b border-slate-100 flex">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 ${
                  tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
        {tab === 'ap-aging' && <ApAgingReport />}
        {tab === 'supplier-scorecards' && <SupplierScorecardsReport />}
        {tab === 'sales-fulfillment' && <SalesFulfillmentReport />}
      </div>
    </div>
  );
}

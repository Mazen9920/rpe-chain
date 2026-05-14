import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerPaymentService } from '../services';
import { formatMoney } from '../utils/format';

const fmt = (n?: number | null, cur = 'USD') => formatMoney(n, cur);

export default function CustomerPaymentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: p, isLoading } = useQuery({
    queryKey: ['ar-payment', id],
    queryFn: () => customerPaymentService.getById(id),
    enabled: !!id,
  });

  const voidPay = useMutation({
    mutationFn: (reason: string) => customerPaymentService.void(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ar-payment', id] });
      qc.invalidateQueries({ queryKey: ['ar-payments'] });
      qc.invalidateQueries({ queryKey: ['ar-kpis'] });
      qc.invalidateQueries({ queryKey: ['ar-invoices'] });
    },
    onError: (e: { response?: { data?: { error?: string; code?: string } } }) =>
      setActionError(`${e.response?.data?.error ?? 'Void failed'}${e.response?.data?.code ? ` (${e.response.data.code})` : ''}`),
  });

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (!p) return <div className="p-6 text-sm text-rose-600">Payment not found</div>;

  const cur = p.currency;
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/ar" className="text-xs text-blue-600 hover:underline">← Back to AR</Link>
          <h2 className="text-xl font-bold text-slate-800 mt-1">
            Customer payment
            <span className={`ml-3 text-xs px-2 py-0.5 rounded ${p.status === 'VOIDED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{p.status}</span>
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            <Link to={`/customers/${p.customerId}`} className="text-blue-600 hover:underline">{p.customer?.name}</Link>
            {p.reference && <> · ref <span className="font-mono">{p.reference}</span></>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {p.status === 'POSTED' && (
            <button onClick={() => {
              setActionError('');
              const reason = window.prompt('Void reason:');
              if (reason) voidPay.mutate(reason);
            }} disabled={voidPay.isPending} className="px-3 py-1.5 border border-rose-300 text-rose-700 text-sm rounded-md hover:bg-rose-50 disabled:opacity-50">Void</button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md px-4 py-2">{actionError}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Amount" value={fmt(p.amount, cur)} bold />
        <Stat label="Date" value={new Date(p.paymentDate).toLocaleDateString()} />
        <Stat label="Method" value={p.method} />
        <Stat label="Currency" value={p.fxRate ? `${cur} @ ${p.fxRate}` : cur} />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <h3 className="px-5 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Applications</h3>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>{['Invoice', 'Status', 'Amount applied'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(p.applications ?? []).map((app) => (
              <tr key={app.id}>
                <td className="px-5 py-3 font-mono text-xs">
                  {app.invoiceId && (
                    <Link to={`/ar/invoices/${app.invoiceId}`} className="text-blue-600 hover:underline">
                      {app.invoice?.invoiceNumber ?? app.invoiceId.slice(0, 8)}
                    </Link>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">{app.invoice?.status ?? '—'}</td>
                <td className="px-5 py-3 tabular-nums">{fmt(app.amountApplied, cur)}</td>
              </tr>
            ))}
            {(!p.applications || p.applications.length === 0) && (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-400">No applications</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {p.notes && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 text-sm text-slate-600">
          <div className="text-xs text-slate-400 mb-1">Notes</div>
          {p.notes}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`tabular-nums text-slate-800 ${bold ? 'text-base font-bold' : 'text-sm'}`}>{value}</div>
    </div>
  );
}

import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentService } from '../services';

const fmt = (n?: number | null, cur = 'USD') =>
  Number(n ?? 0).toLocaleString(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 });

export default function PaymentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [err, setErr] = useState('');

  const { data: payment, isLoading } = useQuery({
    queryKey: ['ap-payment', id],
    queryFn: () => paymentService.getById(id),
    enabled: !!id,
  });

  const voidPayment = useMutation({
    mutationFn: (reason: string) => paymentService.void(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ap-payment', id] });
      qc.invalidateQueries({ queryKey: ['ap-payments'] });
      qc.invalidateQueries({ queryKey: ['ap-kpis'] });
    },
    onError: (e: { response?: { data?: { error?: string; code?: string } } }) =>
      setErr(`${e.response?.data?.error ?? 'Void failed'}${e.response?.data?.code ? ` (${e.response.data.code})` : ''}`),
  });

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (!payment) return <div className="p-6 text-sm text-rose-600">Payment not found</div>;

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/ap" className="text-xs text-blue-600 hover:underline">← Back to AP</Link>
          <h2 className="text-xl font-bold text-slate-800 mt-1">
            Payment {payment.id.slice(0, 8)}
            <span className={`ml-3 text-xs px-2 py-0.5 rounded ${payment.status === 'VOIDED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {payment.status}
            </span>
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            <Link to={`/suppliers/${payment.supplierId}`} className="text-blue-600 hover:underline">{payment.supplier?.name}</Link>
            {' · '} {new Date(payment.paymentDate).toLocaleDateString()}
          </p>
        </div>
        {payment.status === 'POSTED' && (
          <button
            onClick={() => {
              setErr('');
              const reason = window.prompt('Void reason:');
              if (reason) voidPayment.mutate(reason);
            }}
            disabled={voidPayment.isPending}
            className="px-3 py-1.5 border border-rose-300 text-rose-700 text-sm rounded-md hover:bg-rose-50 disabled:opacity-50"
          >
            Void payment
          </button>
        )}
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md px-4 py-2">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Amount" value={fmt(payment.amount, payment.currency)} bold />
        <Stat label="Method" value={payment.method} />
        <Stat label="Reference" value={payment.reference ?? '—'} />
        <Stat label="Created by" value={payment.createdBy?.name ?? '—'} />
      </div>

      {payment.notes && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-5 py-3 text-sm text-slate-700">{payment.notes}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <h3 className="px-5 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Applications</h3>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>{['Invoice #', 'Invoice total', 'Applied', 'Status'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(payment.applications ?? []).map((app) => (
              <tr key={app.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs">
                  {app.invoice && <Link to={`/ap/invoices/${app.invoice.id}`} className="text-blue-600 hover:underline">{app.invoice.invoiceNumber}</Link>}
                </td>
                <td className="px-5 py-3 tabular-nums">{fmt(app.invoice?.amount, app.invoice?.currency ?? payment.currency)}</td>
                <td className="px-5 py-3 tabular-nums">{fmt(app.amountApplied, payment.currency)}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{app.invoice?.status ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payment.voidedAt && (
        <div className="bg-rose-50 border border-rose-200 rounded-md px-4 py-3 text-sm text-rose-700">
          Voided {new Date(payment.voidedAt).toLocaleString()} by {payment.voidedBy?.name ?? '—'}
          {payment.voidReason && <>: {payment.voidReason}</>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`tabular-nums ${bold ? 'text-base font-bold' : 'text-sm'} text-slate-800`}>{value}</div>
    </div>
  );
}

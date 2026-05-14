import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apInvoiceService } from '../services';
import type { InvoiceStatus, MatchStatus } from '../types/ap';
import { formatMoney } from '../utils/format';

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

const MATCH_COLORS: Record<MatchStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  MATCHED: 'bg-emerald-100 text-emerald-700',
  QTY_VARIANCE: 'bg-amber-100 text-amber-800',
  PRICE_VARIANCE: 'bg-amber-100 text-amber-800',
  NO_PO: 'bg-blue-100 text-blue-700',
  NO_RECEIPT: 'bg-rose-100 text-rose-700',
};

const fmt = (n?: number | null, cur = 'USD') => formatMoney(n, cur);

export default function SupplierInvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['ap-invoice', id],
    queryFn: () => apInvoiceService.getById(id),
    enabled: !!id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ap-invoice', id] });
    qc.invalidateQueries({ queryKey: ['ap-kpis'] });
    qc.invalidateQueries({ queryKey: ['ap-invoices'] });
    qc.invalidateQueries({ queryKey: ['ap-match-queue'] });
    qc.invalidateQueries({ queryKey: ['ap-match-received'] });
  };

  const submit = useMutation({
    mutationFn: () => apInvoiceService.submit(id),
    onSuccess: invalidate,
    onError: (e: { response?: { data?: { error?: string } } }) => setActionError(e.response?.data?.error ?? 'Submit failed'),
  });
  const rematch = useMutation({
    mutationFn: () => apInvoiceService.rematch(id),
    onSuccess: invalidate,
    onError: (e: { response?: { data?: { error?: string } } }) => setActionError(e.response?.data?.error ?? 'Rematch failed'),
  });
  const approve = useMutation({
    mutationFn: (overrideReason?: string) => apInvoiceService.approve(id, overrideReason),
    onSuccess: invalidate,
    onError: (e: { response?: { data?: { error?: string; code?: string } } }) =>
      setActionError(`${e.response?.data?.error ?? 'Approve failed'}${e.response?.data?.code ? ` (${e.response.data.code})` : ''}`),
  });
  const voidInv = useMutation({
    mutationFn: (reason: string) => apInvoiceService.void(id, reason),
    onSuccess: invalidate,
    onError: (e: { response?: { data?: { error?: string; code?: string } } }) =>
      setActionError(`${e.response?.data?.error ?? 'Void failed'}${e.response?.data?.code ? ` (${e.response.data.code})` : ''}`),
  });

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (!invoice) return <div className="p-6 text-sm text-rose-600">Invoice not found</div>;

  const cur = invoice.currency;
  const balance = Number(invoice.amount) - Number(invoice.paidAmount);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/ap" className="text-xs text-blue-600 hover:underline">← Back to AP</Link>
          <h2 className="text-xl font-bold text-slate-800 mt-1">
            {invoice.invoiceNumber}
            <span className={`ml-3 text-xs px-2 py-0.5 rounded ${STATUS_COLORS[invoice.status]}`}>{invoice.status}</span>
            {invoice.invoiceType !== 'STANDARD' && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">{invoice.invoiceType}</span>
            )}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            <Link to={`/suppliers/${invoice.supplierId}`} className="text-blue-600 hover:underline">{invoice.supplier?.name}</Link>
            {invoice.purchaseOrderId && (
              <> · <Link to={`/orders/${invoice.purchaseOrderId}`} className="text-blue-600 hover:underline">PO {invoice.purchaseOrderId.slice(0, 8)}</Link></>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {invoice.status === 'DRAFT' && (
            <button onClick={() => { setActionError(''); submit.mutate(); }} disabled={submit.isPending} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50">Submit for matching</button>
          )}
          {(invoice.status === 'EXCEPTION' || invoice.status === 'RECEIVED') && (
            <button onClick={() => { setActionError(''); rematch.mutate(); }} disabled={rematch.isPending} className="px-3 py-1.5 bg-slate-700 text-white text-sm rounded-md hover:bg-slate-800 disabled:opacity-50">Rematch</button>
          )}
          {invoice.status === 'MATCHED' && (
            <button onClick={() => { setActionError(''); approve.mutate(undefined); }} disabled={approve.isPending} className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-md hover:bg-emerald-700 disabled:opacity-50">Approve</button>
          )}
          {invoice.status === 'EXCEPTION' && (
            <button onClick={() => {
              setActionError('');
              const reason = window.prompt('Override reason (required to approve with variances):');
              if (reason) approve.mutate(reason);
            }} disabled={approve.isPending} className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded-md hover:bg-amber-700 disabled:opacity-50">Override & approve</button>
          )}
          {!['VOID', 'PAID'].includes(invoice.status) && Number(invoice.paidAmount) === 0 && (
            <button onClick={() => {
              setActionError('');
              const reason = window.prompt('Void reason:');
              if (reason) voidInv.mutate(reason);
            }} disabled={voidInv.isPending} className="px-3 py-1.5 border border-rose-300 text-rose-700 text-sm rounded-md hover:bg-rose-50 disabled:opacity-50">Void</button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md px-4 py-2">{actionError}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Subtotal" value={fmt(invoice.subtotal, cur)} />
        <Stat label="Tax" value={fmt(invoice.taxAmount, cur)} />
        <Stat label="Total" value={fmt(invoice.amount, cur)} bold />
        <Stat label="Variance" value={fmt(invoice.varianceAmount, cur)} tone={Number(invoice.varianceAmount) ? 'warn' : 'default'} />
        <Stat label="Matched" value={fmt(invoice.matchedAmount, cur)} />
        <Stat label="Paid" value={fmt(invoice.paidAmount, cur)} />
        <Stat label="Open balance" value={fmt(balance, cur)} bold />
        <Stat label="Due date" value={invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'} />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>{['Description', 'PO Line', 'GRN Line', 'Qty', 'Unit', 'Total', 'Match', 'Variance'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(invoice.lines ?? []).map((line) => (
              <tr key={line.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-slate-700">{line.description ?? line.poLine?.product?.name ?? '—'}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{line.poLineId ? line.poLineId.slice(0, 8) : '—'}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{line.grnLineId ? line.grnLineId.slice(0, 8) : '—'}</td>
                <td className="px-5 py-3 tabular-nums">{Number(line.quantity).toLocaleString()}</td>
                <td className="px-5 py-3 tabular-nums">{fmt(line.unitPrice, cur)}</td>
                <td className="px-5 py-3 tabular-nums">{fmt(line.lineTotal, cur)}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${MATCH_COLORS[line.matchStatus]}`}>{line.matchStatus}</span>
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {line.qtyVariance != null && <div>Qty: {Number(line.qtyVariance).toFixed(2)}</div>}
                  {line.priceVariance != null && <div>Price: {Number(line.priceVariance).toFixed(2)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invoice.paymentApplications && invoice.paymentApplications.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
          <h3 className="px-5 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Payments applied</h3>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>{['Payment date', 'Reference', 'Method', 'Applied', 'Status'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.paymentApplications.map((app) => (
                <tr key={app.id}>
                  <td className="px-5 py-3 text-slate-700">{app.payment ? new Date(app.payment.paymentDate).toLocaleDateString() : '—'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{app.payment?.reference ?? '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">{app.payment?.method ?? '—'}</td>
                  <td className="px-5 py-3 tabular-nums">{fmt(app.amountApplied, cur)}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${app.payment?.status === 'VOIDED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {app.payment?.status ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: 'default' | 'warn' }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`tabular-nums ${bold ? 'text-base font-bold' : 'text-sm'} ${tone === 'warn' ? 'text-amber-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

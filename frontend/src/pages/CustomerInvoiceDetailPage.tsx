import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { arInvoiceService } from '../services';
import type { CustomerInvoiceStatus } from '../types/ar';
import { formatMoney } from '../utils/format';

const STATUS_COLORS: Record<CustomerInvoiceStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  POSTED: 'bg-blue-100 text-blue-700',
  PARTIALLY_PAID: 'bg-cyan-100 text-cyan-700',
  PAID: 'bg-emerald-100 text-emerald-800',
  VOID: 'bg-rose-100 text-rose-700',
};

const fmt = (n?: number | null, cur = 'USD') => formatMoney(n, cur);

export default function CustomerInvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['ar-invoice', id],
    queryFn: () => arInvoiceService.getById(id),
    enabled: !!id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ar-invoice', id] });
    qc.invalidateQueries({ queryKey: ['ar-kpis'] });
    qc.invalidateQueries({ queryKey: ['ar-invoices'] });
  };

  const voidInv = useMutation({
    mutationFn: (reason: string) => arInvoiceService.void(id, reason),
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
          <Link to="/ar" className="text-xs text-blue-600 hover:underline">← Back to AR</Link>
          <h2 className="text-xl font-bold text-slate-800 mt-1">
            {invoice.invoiceNumber}
            <span className={`ml-3 text-xs px-2 py-0.5 rounded ${STATUS_COLORS[invoice.status]}`}>{invoice.status}</span>
            {invoice.invoiceType !== 'STANDARD' && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">{invoice.invoiceType}</span>
            )}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            <Link to={`/customers/${invoice.customerId}`} className="text-blue-600 hover:underline">{invoice.customer?.name}</Link>
            {invoice.salesOrderId && (
              <> · <Link to={`/sales-orders/${invoice.salesOrderId}`} className="text-blue-600 hover:underline">SO {invoice.salesOrderId.slice(0, 8)}</Link></>
            )}
            {invoice.shipmentId && (
              <> · <Link to={`/shipments/${invoice.shipmentId}`} className="text-blue-600 hover:underline">Shipment {invoice.shipmentId.slice(0, 8)}</Link></>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
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
        <Stat label="Paid" value={fmt(invoice.paidAmount, cur)} />
        <Stat label="Open balance" value={fmt(balance, cur)} bold />
        <Stat label="Invoice date" value={new Date(invoice.invoiceDate).toLocaleDateString()} />
        <Stat label="Due date" value={new Date(invoice.dueDate).toLocaleDateString()} />
        <Stat label="Currency" value={invoice.fxRate ? `${cur} @ ${invoice.fxRate}` : cur} />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>{['Description', 'Product', 'Qty', 'Unit', 'Total'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(invoice.lines ?? []).map((line) => (
              <tr key={line.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-slate-700">{line.description ?? line.product?.name ?? '—'}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{line.product?.sku ?? '—'}</td>
                <td className="px-5 py-3 tabular-nums">{Number(line.quantity).toLocaleString()}</td>
                <td className="px-5 py-3 tabular-nums">{fmt(line.unitPrice, cur)}</td>
                <td className="px-5 py-3 tabular-nums">{fmt(line.lineTotal, cur)}</td>
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
              <tr>{['Payment date', 'Reference', 'Method', 'Applied', 'Status', ''].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
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
                  <td className="px-5 py-3 text-right">
                    {app.paymentId && <Link to={`/ar/payments/${app.paymentId}`} className="text-xs text-blue-600 hover:underline">View →</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invoice.creditNotes && invoice.creditNotes.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <h3 className="px-5 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Credit notes</h3>
          <ul className="divide-y divide-slate-100">
            {invoice.creditNotes.map((cn) => (
              <li key={cn.id} className="px-5 py-2 text-sm flex justify-between">
                <Link to={`/ar/invoices/${cn.id}`} className="text-blue-600 hover:underline font-mono text-xs">{cn.invoiceNumber}</Link>
                <span className="tabular-nums">{fmt(cn.amount, cn.currency)}</span>
              </li>
            ))}
          </ul>
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

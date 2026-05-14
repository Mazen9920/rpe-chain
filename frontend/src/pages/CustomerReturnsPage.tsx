import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerReturnService, type CustomerReturn, type CustomerReturnStatus } from '../services';

const STATUS_FILTERS: Array<{ value: ''; label: 'All' } | { value: CustomerReturnStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'REJECTED', label: 'Rejected' },
];

const STATUS_COLORS: Record<CustomerReturnStatus, string> = {
  REQUESTED: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-sky-100 text-sky-700',
  RECEIVED: 'bg-indigo-100 text-indigo-700',
  REFUNDED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-slate-200 text-slate-600',
};

export default function CustomerReturnsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | CustomerReturnStatus>('');
  const [selected, setSelected] = useState<CustomerReturn | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customer-returns', status],
    queryFn: () => customerReturnService.list(status ? { status: status as CustomerReturnStatus } : undefined),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['customer-returns'] });
    if (selected) qc.invalidateQueries({ queryKey: ['customer-return', selected.id] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => customerReturnService.approve(id),
    onSuccess: (r) => { setSelected(r); invalidate(); },
  });
  const receive = useMutation({
    mutationFn: (id: string) => customerReturnService.receive(id),
    onSuccess: (r) => { setSelected(r); invalidate(); },
  });
  const refund = useMutation({
    mutationFn: (id: string) => customerReturnService.refund(id),
    onSuccess: (r) => { setSelected(r); invalidate(); },
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => customerReturnService.reject(id, reason),
    onSuccess: (r) => { setSelected(r); invalidate(); },
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Customer Returns</h1>
          <p className="text-sm text-slate-500">RMA workflow: Requested → Approved → Received → Refunded.</p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | CustomerReturnStatus)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value || 'all'} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">RMA #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No returns yet.</td></tr>
            )}
            {items.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{r.returnNumber}</td>
                <td className="px-4 py-3">{r.customer?.name ?? r.customerId}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.customerInvoice?.invoiceNumber ?? r.customerInvoiceId.slice(0, 8)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3">{r.currency} {Number(r.totalAmount).toFixed(2)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    className="text-blue-600 hover:underline"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-30 flex items-end justify-end bg-slate-900/40">
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-sm text-slate-500">{selected.returnNumber}</div>
                <h2 className="text-xl font-semibold">{selected.customer?.name}</h2>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-900">✕</button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">Invoice {selected.customerInvoice?.invoiceNumber}</span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">Warehouse {selected.warehouse?.code}</span>
            </div>

            {selected.reason && (
              <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Reason: {selected.reason}</p>
            )}

            <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((l) => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{l.product?.sku ?? l.productId.slice(0, 8)} — {l.product?.name}</td>
                      <td className="px-3 py-2 text-right">{Number(l.qty)}</td>
                      <td className="px-3 py-2 text-right">{Number(l.unitPrice).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.creditNote && (
              <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                Credit note <strong>{selected.creditNote.invoiceNumber}</strong> issued
                ({Number(selected.creditNote.amount).toFixed(2)})
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {selected.status === 'REQUESTED' && (
                <>
                  <button
                    onClick={() => approve.mutate(selected.id)}
                    disabled={approve.isPending}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      const reason = prompt('Reject reason?');
                      if (reason) reject.mutate({ id: selected.id, reason });
                    }}
                    disabled={reject.isPending}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              )}
              {selected.status === 'APPROVED' && (
                <button
                  onClick={() => receive.mutate(selected.id)}
                  disabled={receive.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Receive into warehouse
                </button>
              )}
              {selected.status === 'RECEIVED' && (
                <button
                  onClick={() => refund.mutate(selected.id)}
                  disabled={refund.isPending}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Issue credit note
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

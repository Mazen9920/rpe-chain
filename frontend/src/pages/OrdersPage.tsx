import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { purchaseOrderService, supplierService, productService, inventoryService } from '../services';
import type { PoListResponse, PoKpis, PoStatus } from '../types/procurement';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-indigo-100 text-indigo-700',
  SENT: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-800',
  RECEIVED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-rose-100 text-rose-700',
  CLOSED: 'bg-slate-200 text-slate-600',
};

const STATUS_OPTIONS: (PoStatus | '')[] = [
  '', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED',
];

interface SupplierLite { id: string; name: string; code: string; currency?: string }
interface ProductLite { id: string; sku: string; name: string; uom: string }

export default function OrdersPage() {
  const [status, setStatus] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: kpis } = useQuery<PoKpis>({
    queryKey: ['po-kpis'],
    queryFn: () => purchaseOrderService.kpis(),
  });

  const { data, isLoading } = useQuery<PoListResponse>({
    queryKey: ['purchase-orders', { status, supplierId, search }],
    queryFn: () => purchaseOrderService.list({
      status: status || undefined,
      supplierId: supplierId || undefined,
      search: search || undefined,
      limit: 100,
    }),
  });

  const orders = data?.rows ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Purchase Orders</h2>
          <p className="text-slate-500 text-sm">{data?.total ?? 0} total · workflow: Draft → Approve → Send → Receive → Close</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2"
        >
          <Plus size={16} /> New PO
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: 'Draft', val: kpis?.draft },
          { label: 'Pending Approval', val: kpis?.pendingApproval },
          { label: 'Approved', val: kpis?.approved },
          { label: 'Sent', val: kpis?.sent },
          { label: 'Partially Received', val: kpis?.partiallyReceived },
          { label: 'Received This Month', val: kpis?.receivedThisMonth },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-lg border border-slate-100 p-3 shadow-sm">
            <p className="text-xs text-slate-500">{k.label}</p>
            <p className="text-lg font-semibold text-slate-800">{k.val ?? '—'}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-slate-100 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Open Value</p>
          <p className="text-lg font-semibold text-slate-800">${(kpis?.openValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-100 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Cancel Rate</p>
          <p className="text-lg font-semibold text-slate-800">{((kpis?.cancelRate ?? 0) * 100).toFixed(1)}%</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-100 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Cancelled</p>
          <p className="text-lg font-semibold text-slate-800">{kpis?.cancelled ?? 0}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-100 p-3 shadow-sm">
          <p className="text-xs text-slate-500">In Transit</p>
          <p className="text-lg font-semibold text-slate-800">{kpis?.inTransit ?? 0}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="PO number or supplier"
            className="pl-7 pr-2 py-1.5 border border-slate-200 rounded-md text-sm w-64"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-md text-sm">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <SupplierFilter value={supplierId} onChange={setSupplierId} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left">
              {['PO Number', 'Supplier', 'Status', 'Currency', 'Total', 'Expected', 'Created'].map((h) => (
                <th key={h} className="px-5 py-3 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-5 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                ))}</tr>
              ))
            ) : orders.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">No purchase orders yet</td></tr>
            ) : orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link to={`/orders/${o.id}`} className="text-blue-600 hover:underline">{o.poNumber}</Link>
                </td>
                <td className="px-5 py-3 font-medium text-slate-800">{o.supplier?.name ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[o.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-600">{o.currency}</td>
                <td className="px-5 py-3 text-slate-600">{Number(o.totalAmount).toLocaleString()}</td>
                <td className="px-5 py-3 text-slate-500">{o.expectedDate ? new Date(o.expectedDate).toLocaleDateString() : '—'}</td>
                <td className="px-5 py-3 text-slate-500">{new Date(o.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreatePoModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function SupplierFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ['supplier-options'],
    queryFn: () => supplierService.list({ limit: 200, isActive: true }),
  });
  const rows = (data?.rows ?? []) as SupplierLite[];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-md text-sm min-w-[200px]">
      <option value="">All suppliers</option>
      {rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

interface LineDraft {
  productId: string;
  qtyOrdered: number;
  unitPrice: number;
  expectedDate?: string;
  notes?: string;
}

function CreatePoModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [fxRate, setFxRate] = useState<string>('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ productId: '', qtyOrdered: 1, unitPrice: 0 }]);

  const { data: suppliers } = useQuery({
    queryKey: ['supplier-options'],
    queryFn: () => supplierService.list({ limit: 200, isActive: true }),
  });
  const { data: products } = useQuery({
    queryKey: ['product-options'],
    queryFn: () => productService.list({ limit: 500 }),
  });

  const create = useMutation({
    mutationFn: () => purchaseOrderService.create({
      supplierId,
      currency,
      fxRate: fxRate ? Number(fxRate) : undefined,
      expectedDate: expectedDate || undefined,
      notes: notes || undefined,
      lines: lines.filter((l) => l.productId && l.qtyOrdered > 0),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['po-kpis'] });
      onClose();
    },
  });

  const supplierList = (suppliers?.rows ?? []) as SupplierLite[];
  const productList = (products?.rows ?? products ?? []) as ProductLite[];

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold">New Purchase Order</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Supplier *</label>
              <select value={supplierId} onChange={(e) => {
                setSupplierId(e.target.value);
                const s = supplierList.find((x) => x.id === e.target.value);
                if (s?.currency) setCurrency(s.currency);
              }} className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-sm">
                <option value="">Select supplier…</option>
                {supplierList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">Currency</label>
              <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500">FX Rate (functional/PO)</label>
              <input type="number" step="0.000001" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="default 1" className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Expected Date</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-sm" />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-medium text-slate-700">Lines</h4>
              <button
                onClick={() => setLines([...lines, { productId: '', qtyOrdered: 1, unitPrice: 0 }])}
                className="text-xs text-blue-600 hover:underline"
              >+ Add line</button>
            </div>
            <table className="w-full text-sm border border-slate-100 rounded">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left">Product</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit Price</th>
                  <th className="px-2 py-2 text-left">Expected</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      <select value={l.productId} onChange={(e) => {
                        const next = [...lines]; next[idx] = { ...l, productId: e.target.value }; setLines(next);
                      }} className="w-full px-1 py-1 border border-slate-200 rounded text-xs">
                        <option value="">Select…</option>
                        {productList.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1"><input type="number" value={l.qtyOrdered} onChange={(e) => { const n=[...lines]; n[idx]={...l, qtyOrdered: Number(e.target.value)}; setLines(n); }} className="w-20 px-1 py-1 border border-slate-200 rounded text-xs text-right" /></td>
                    <td className="px-2 py-1"><input type="number" step="0.01" value={l.unitPrice} onChange={(e) => { const n=[...lines]; n[idx]={...l, unitPrice: Number(e.target.value)}; setLines(n); }} className="w-24 px-1 py-1 border border-slate-200 rounded text-xs text-right" /></td>
                    <td className="px-2 py-1"><input type="date" value={l.expectedDate ?? ''} onChange={(e) => { const n=[...lines]; n[idx]={...l, expectedDate: e.target.value}; setLines(n); }} className="px-1 py-1 border border-slate-200 rounded text-xs" /></td>
                    <td className="px-2 py-1 text-right">
                      <button onClick={() => setLines(lines.filter((_, i) => i !== idx))} className="text-xs text-rose-600 hover:underline">remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {create.error instanceof Error && (
            <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">
              {create.error.message}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-200 rounded-md">Cancel</button>
          <button
            disabled={!supplierId || lines.filter((l) => l.productId).length === 0 || create.isPending}
            onClick={() => create.mutate()}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
          >{create.isPending ? 'Creating…' : 'Create Draft'}</button>
        </div>
      </div>
    </div>
  );
}

// Re-export to satisfy unused import in some bundles
void inventoryService;

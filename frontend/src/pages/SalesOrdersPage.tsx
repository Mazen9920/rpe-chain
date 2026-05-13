import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, X, Search, Trash2 } from 'lucide-react';
import { salesOrderService, customerService, productService, inventoryService } from '../services';
import type { SalesOrder, SOStatus, CreateSOLine } from '../types/fulfillment';

const STATUS_TABS: Array<{ key: 'all' | SOStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'RECEIVED', label: 'Received' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'ALLOCATED', label: 'Allocated' },
  { key: 'PICKED', label: 'Picked' },
  { key: 'PACKED', label: 'Packed' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'DELIVERED', label: 'Delivered' },
];

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  ALLOCATED: 'bg-indigo-100 text-indigo-700',
  PICKED: 'bg-violet-100 text-violet-700',
  PACKED: 'bg-purple-100 text-purple-700',
  SHIPPED: 'bg-cyan-100 text-cyan-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  RETURNED: 'bg-amber-100 text-amber-700',
};

export default function SalesOrdersPage() {
  const [tab, setTab] = useState<'all' | SOStatus>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const { data: kpis } = useQuery({ queryKey: ['so-kpis'], queryFn: () => salesOrderService.kpis() });
  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders', { tab, search }],
    queryFn: () => salesOrderService.list({ status: tab === 'all' ? undefined : tab, search: search || undefined, limit: 100 }),
  });

  const items: SalesOrder[] = data?.items ?? [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Sales Orders</h2>
          <p className="text-slate-500 text-sm">{data?.total ?? 0} orders</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Order
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Total" value={kpis?.total ?? 0} />
        <KpiCard label="Open" value={kpis?.open ?? 0} accent="text-blue-600" />
        <KpiCard label="In Fulfillment" value={kpis?.inFulfillment ?? 0} accent="text-indigo-600" />
        <KpiCard label="Ready to Ship" value={kpis?.readyToShip ?? 0} accent="text-purple-600" />
        <KpiCard label="Shipped" value={kpis?.shipped ?? 0} accent="text-green-600" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t.key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order #, customer..." className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Order #', 'Customer', 'Warehouse', 'Status', 'Total', 'Ordered', ''].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium text-xs uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">No sales orders</td></tr>
            ) : items.map((so) => (
              <tr key={so.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs text-slate-700">{so.orderNumber}</td>
                <td className="px-5 py-3 font-medium text-slate-800">{so.customerName}</td>
                <td className="px-5 py-3 text-slate-600">{so.warehouse?.code ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[so.status]}`}>{so.status}</span>
                </td>
                <td className="px-5 py-3 text-slate-700">{so.currency} {Number(so.totalAmount).toFixed(2)}</td>
                <td className="px-5 py-3 text-slate-500">{new Date(so.orderedAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right">
                  <Link to={`/sales-orders/${so.id}`} className="text-indigo-600 hover:text-indigo-700 text-xs font-medium">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateSOModal onClose={() => setShowCreate(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); qc.invalidateQueries({ queryKey: ['so-kpis'] }); setShowCreate(false); }} />}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold ${accent ?? 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

interface ProductOpt { id: string; sku: string; name: string; sellingPrice?: number; type?: string; isActive?: boolean }
interface WarehouseOpt { id: string; code: string; name: string }

function CreateSOModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<CreateSOLine[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const { data: custData } = useQuery({ queryKey: ['customers-active'], queryFn: () => customerService.list({ isActive: true, limit: 200 }) });
  const { data: prodData } = useQuery({ queryKey: ['products-sellable'], queryFn: () => productService.list({ limit: 500 }) });
  const { data: whData } = useQuery({ queryKey: ['warehouses'], queryFn: () => inventoryService.warehouses() });

  const products: ProductOpt[] = (prodData as { items?: ProductOpt[] } | ProductOpt[] | undefined)
    ? (Array.isArray(prodData) ? prodData : (prodData as { items?: ProductOpt[] }).items ?? [])
    : [];
  const sellableProducts = products.filter((p) => (p.type === 'FINISHED' || p.type === 'PACKAGING') && p.isActive !== false);
  const warehouses: WarehouseOpt[] = Array.isArray(whData) ? whData : [];

  const customer = custData?.items.find((c) => c.id === customerId);

  const total = lines.reduce((sum, l) => sum + (l.qty || 0) * (l.unitPrice || 0), 0);

  const mut = useMutation({
    mutationFn: () => salesOrderService.create({
      customerId,
      warehouseId,
      currency: customer?.currency,
      notes: notes || undefined,
      lines: lines.filter((l) => l.productId && l.qty > 0),
    }),
    onSuccess: onCreated,
    onError: (e: { response?: { data?: { message?: string; error?: string; details?: unknown } } }) => {
      const data = e.response?.data;
      setErr((data?.message || data?.error || 'Failed to create') + (data?.details ? ` — ${JSON.stringify(data.details)}` : ''));
    },
  });

  const addLine = () => setLines([...lines, { productId: '', qty: 1, unitPrice: 0 }]);
  const updateLine = (i: number, patch: Partial<CreateSOLine>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const onPickProduct = (i: number, productId: string) => {
    const p = sellableProducts.find((x) => x.id === productId);
    updateLine(i, { productId, unitPrice: p?.sellingPrice ?? 0 });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">New Sales Order</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Customer *</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <option value="">— Select —</option>
                {custData?.items.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-600">Line Items *</label>
              <button onClick={addLine} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"><Plus size={12} /> Add line</button>
            </div>
            {lines.length === 0 ? (
              <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg p-4 text-center">No lines yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr>
                  <th className="text-left py-1">Product</th>
                  <th className="text-right py-1 w-20">Qty</th>
                  <th className="text-right py-1 w-28">Unit Price</th>
                  <th className="text-right py-1 w-28">Line Total</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1">
                        <select value={l.productId} onChange={(e) => onPickProduct(i, e.target.value)} className="w-full px-2 py-1 border border-slate-200 rounded text-sm">
                          <option value="">—</option>
                          {sellableProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                        </select>
                      </td>
                      <td className="py-1"><input type="number" min="1" value={l.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} className="w-full px-2 py-1 border border-slate-200 rounded text-sm text-right" /></td>
                      <td className="py-1"><input type="number" step="0.01" value={l.unitPrice ?? 0} onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })} className="w-full px-2 py-1 border border-slate-200 rounded text-sm text-right" /></td>
                      <td className="py-1 text-right text-slate-600">{((l.qty || 0) * (l.unitPrice || 0)).toFixed(2)}</td>
                      <td className="py-1 text-right"><button onClick={() => removeLine(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-slate-100"><td colSpan={3} className="py-2 text-right text-xs text-slate-500 uppercase">Total</td><td className="py-2 text-right font-bold text-slate-800">{customer?.currency ?? 'USD'} {total.toFixed(2)}</td><td></td></tr></tfoot>
              </table>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>

          {err && <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{err}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={!customerId || !warehouseId || lines.length === 0 || mut.isPending} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg">
            {mut.isPending ? 'Creating...' : 'Create Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

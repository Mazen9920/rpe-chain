import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react';
import { inventoryService, productService } from '../../services';
import type { CycleCount, CycleCountLine, Product, Warehouse } from '../../types/inventory';
import BarcodeInput, { LookupResult } from '../../components/BarcodeInput';

type CountMap = Record<string, number>;

const STATUS_OPTIONS = ['ALL', 'OPEN', 'POSTED', 'CANCELLED'];

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  POSTED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

function varianceClass(v: number | null | undefined) {
  if (v == null || v === 0) return 'text-slate-400';
  return v > 0 ? 'font-semibold text-green-700' : 'font-semibold text-red-600';
}

export default function CycleCountsTab() {
  const queryClient = useQueryClient();

  const [filterWarehouseId, setFilterWarehouseId] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [createWarehouseId, setCreateWarehouseId] = useState('');
  const [scopeMode, setScopeMode] = useState<'ALL' | 'PRODUCTS'>('ALL');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [counts, setCounts] = useState<CountMap>({});
  const [flashLineId, setFlashLineId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryService.warehouses });
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: productService.list });
  const { data: cycleCounts = [], isLoading } = useQuery<CycleCount[]>({
    queryKey: ['inventory', 'cycle-counts', filterWarehouseId, filterStatus],
    queryFn: () => inventoryService.cycleCounts({ warehouseId: filterWarehouseId || undefined, status: filterStatus !== 'ALL' ? filterStatus : undefined }),
  });

  const create = useMutation({
    mutationFn: () => inventoryService.createCycleCount({
      warehouseId: createWarehouseId || warehouses[0]?.id,
      productIds: scopeMode === 'PRODUCTS' && selectedProductIds.length ? selectedProductIds : undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventory', 'cycle-counts'] }); setSelectedProductIds([]); },
  });
  const updateLine = useMutation({
    mutationFn: ({ countId, lineId, countedQty }: { countId: string; lineId: string; countedQty: number }) => inventoryService.updateCycleCountLine(countId, lineId, { countedQty }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'cycle-counts'] }),
  });
  const post = useMutation({
    mutationFn: inventoryService.postCycleCount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'cycle-counts'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
    },
  });
  const cancel = useMutation({
    mutationFn: inventoryService.cancelCycleCount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'cycle-counts'] }),
  });

  const handleBarcodeForCount = (count: CycleCount) => (result: LookupResult) => {
    if (result.type !== 'PRODUCT') return;
    const line = count.lines.find((l: CycleCountLine) => l.productId === (result.entity.id as string));
    if (!line) return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashLineId(line.id);
    flashTimer.current = setTimeout(() => setFlashLineId(null), 1800);
    setCounts((c) => ({ ...c, [line.id]: c[line.id] ?? line.countedQty ?? line.expectedQty }));
  };

  const toggleProduct = (id: string) =>
    setSelectedProductIds((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  const selectedWarehouseForCreate = createWarehouseId || warehouses[0]?.id || '';

  return (
    <div className="space-y-4">
      {/* Create count panel */}
      <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">Start New Cycle Count</h3>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex-1 space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Warehouse</span>
              <select value={selectedWarehouseForCreate} onChange={(e) => setCreateWarehouseId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setScopeMode('ALL')} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${scopeMode === 'ALL' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>All Stock</button>
              <button type="button" onClick={() => setScopeMode('PRODUCTS')} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${scopeMode === 'PRODUCTS' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Select Products</button>
            </div>
            {scopeMode === 'PRODUCTS' ? (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2 space-y-1">
                {products.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50 text-sm">
                    <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProduct(p.id)} className="accent-slate-700" />
                    <span className="font-mono text-xs text-slate-500">{p.sku}</span>
                    <span className="text-slate-700">{p.name}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <button
            disabled={!selectedWarehouseForCreate || create.isPending || (scopeMode === 'PRODUCTS' && selectedProductIds.length === 0)}
            onClick={() => create.mutate()}
            className="inline-flex items-center gap-2 self-end rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:self-start"
          >
            <ClipboardCheck size={16} />{create.isPending ? 'Creating…' : 'Start Count'}
          </button>
        </div>
        {create.isError ? <p className="text-xs text-red-600">{(create.error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create count'}</p> : null}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterWarehouseId} onChange={(e) => setFilterWarehouseId(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">
          <option value="">All Warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s}</option>)}
        </select>
      </div>

      {/* Count cards */}
      {isLoading
        ? <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-slate-500">Loading cycle counts…</div>
        : cycleCounts.length === 0
        ? <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-slate-500">No cycle counts found.</div>
        : cycleCounts.map((count) => {
          const nonZeroLines = count.lines.filter((l: CycleCountLine) => l.varianceQty !== null && l.varianceQty !== 0).length;
          const countedLines = count.lines.filter((l: CycleCountLine) => l.countedQty !== null).length;
          return (
            <div key={count.id} className="rounded-xl border border-slate-100 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800">{count.countNumber}</h3>
                  <p className="text-sm text-slate-500">
                    {count.warehouse?.code} · {count.lines.length} lines
                    {count.status === 'OPEN' ? ` · ${countedLines}/${count.lines.length} counted` : ''}
                    {count.status !== 'OPEN' && nonZeroLines > 0 ? ` · ${nonZeroLines} variances` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[count.status] ?? 'bg-slate-100 text-slate-600'}`}>{count.status}</span>
                  {count.status === 'OPEN' ? (
                    <>
                      {nonZeroLines > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <AlertTriangle size={11} />{nonZeroLines} variance{nonZeroLines > 1 ? 's' : ''}
                        </span>
                      ) : null}
                      <button onClick={() => post.mutate(count.id)} disabled={post.isPending} className="inline-flex items-center gap-1 rounded-lg border border-green-200 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"><CheckCircle2 size={13} />Post</button>
                      <button onClick={() => cancel.mutate(count.id)} disabled={cancel.isPending} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"><XCircle size={13} />Cancel</button>
                    </>
                  ) : null}
                </div>
              </div>

              {count.status === 'OPEN' ? (
                <div className="border-b border-slate-100 px-5 py-3">
                  <p className="mb-1 text-xs font-medium text-slate-500">Scan product to jump to its count line</p>
                  <BarcodeInput placeholder="Scan product SKU or barcode…" onResolve={handleBarcodeForCount(count)} />
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50">{['Product', 'Expected', 'Counted', 'Variance', 'Actions'].map((h) => <th key={h} className="px-5 py-3 text-left font-medium text-slate-500">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {count.lines.map((line: CycleCountLine) => (
                      <tr key={line.id} className={`transition-colors hover:bg-slate-50 ${flashLineId === line.id ? 'bg-green-50' : ''}`}>
                        <td className="px-5 py-3 font-medium text-slate-800">{line.product?.sku} · {line.product?.name}</td>
                        <td className="px-5 py-3 text-slate-600">{line.expectedQty}</td>
                        <td className="px-5 py-3"><input disabled={count.status !== 'OPEN'} type="number" min={0} value={counts[line.id] ?? line.countedQty ?? line.expectedQty} onChange={(e) => setCounts((c) => ({ ...c, [line.id]: Number(e.target.value) }))} className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" /></td>
                        <td className={`px-5 py-3 ${varianceClass(line.varianceQty)}`}>{line.varianceQty != null ? (line.varianceQty > 0 ? `+${line.varianceQty}` : line.varianceQty) : '—'}</td>
                        <td className="px-5 py-3">{count.status === 'OPEN' ? <button onClick={() => updateLine.mutate({ countId: count.id, lineId: line.id, countedQty: counts[line.id] ?? line.countedQty ?? line.expectedQty })} disabled={updateLine.isPending} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Save</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
    </div>
  );
}

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { inventoryService } from '../../services';
import type { CycleCount, CycleCountLine, Warehouse } from '../../types/inventory';
import BarcodeInput, { LookupResult } from '../../components/BarcodeInput';

/** Per-line qty state — keyed by lineId */
type CountMap = Record<string, number>;

export default function CycleCountsTab() {
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState('');
  const [counts, setCounts] = useState<CountMap>({});
  // Track "scanned line highlight" — shows green flash when barcode resolves a line
  const [flashLineId, setFlashLineId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['inventory', 'warehouses'], queryFn: inventoryService.warehouses });
  const selectedWarehouseId = warehouseId || warehouses[0]?.id || '';
  const { data: cycleCounts = [], isLoading } = useQuery<CycleCount[]>({ queryKey: ['inventory', 'cycle-counts'], queryFn: () => inventoryService.cycleCounts() });

  const create = useMutation({
    mutationFn: () => inventoryService.createCycleCount({ warehouseId: selectedWarehouseId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'cycle-counts'] }),
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

  /** When a product barcode is scanned, find the matching open count line and flash+focus it */
  const handleBarcodeForCount = (count: CycleCount) => (result: LookupResult) => {
    if (result.type !== 'PRODUCT') return;
    const productId = result.entity.id as string;
    const line = count.lines.find((l: CycleCountLine) => l.productId === productId);
    if (!line) return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashLineId(line.id);
    flashTimer.current = setTimeout(() => setFlashLineId(null), 1800);
    // Pre-populate count input if not already set
    setCounts((c) => ({ ...c, [line.id]: c[line.id] ?? line.countedQty ?? line.expectedQty }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <select value={selectedWarehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
        </select>
        <button disabled={!selectedWarehouseId || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><ClipboardCheck size={16} />Start Cycle Count</button>
      </div>

      {isLoading ? <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-slate-500">Loading cycle counts...</div> : cycleCounts.length === 0 ? <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-slate-500">No cycle counts yet.</div> : cycleCounts.map((count) => (
        <div key={count.id} className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">{count.countNumber}</h3>
              <p className="text-sm text-slate-500">{count.warehouse?.code} · {count.lines.length} lines</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{count.status}</span>
              {count.status === 'OPEN' ? <button onClick={() => post.mutate(count.id)} className="inline-flex items-center gap-1 rounded-lg border border-green-200 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"><CheckCircle2 size={13} />Post</button> : null}
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
              <thead><tr className="bg-slate-50">{['Product', 'Expected', 'Counted', 'Variance', 'Actions'].map((heading) => <th key={heading} className="px-5 py-3 text-left font-medium text-slate-500">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {count.lines.map((line) => (
                  <tr key={line.id} className={`transition-colors hover:bg-slate-50 ${flashLineId === line.id ? 'bg-green-50' : ''}`}>
                    <td className="px-5 py-3 font-medium text-slate-800">{line.product?.sku} · {line.product?.name}</td>
                    <td className="px-5 py-3 text-slate-600">{line.expectedQty}</td>
                    <td className="px-5 py-3"><input disabled={count.status !== 'OPEN'} type="number" value={counts[line.id] ?? line.countedQty ?? line.expectedQty} onChange={(event) => setCounts((current) => ({ ...current, [line.id]: Number(event.target.value) }))} className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-500" /></td>
                    <td className="px-5 py-3 text-slate-600">{line.varianceQty ?? '—'}</td>
                    <td className="px-5 py-3">{count.status === 'OPEN' ? <button onClick={() => updateLine.mutate({ countId: count.id, lineId: line.id, countedQty: counts[line.id] ?? line.countedQty ?? line.expectedQty })} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Save Count</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

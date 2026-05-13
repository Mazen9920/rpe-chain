/**
 * CostRollupTab — visualize component cost tree (standard or FIFO mode).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, Download } from 'lucide-react';
import { bomService, productService, inventoryService } from '../../services';
import type { Product, Warehouse } from '../../types/inventory';
import type { CostRollupResponse, RollupNode } from '../../types/manufacturing';

function fmt(v: number | undefined) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

type FlatRow = { depth: number; sku: string; name: string; qtyPer: number; unitCost: number; labor: number; overhead: number; lineCost: number };

function flatten(node: RollupNode, depth: number, out: FlatRow[]) {
  out.push({ depth, sku: node.sku, name: node.name, qtyPer: node.qtyPer, unitCost: node.unitCost, labor: node.labor, overhead: node.overhead, lineCost: node.lineCost });
  for (const c of node.components) flatten(c, depth + 1, out);
}

function downloadCsv(data: CostRollupResponse) {
  const rows: FlatRow[] = [];
  flatten(data.tree, 0, rows);
  const header = ['Depth', 'SKU', 'Name', 'Qty/Unit', 'Unit Cost', 'Labor', 'Overhead', 'Line Cost'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.depth, r.sku, `"${r.name.replace(/"/g, '""')}"`, r.qtyPer, r.unitCost, r.labor, r.overhead, r.lineCost].join(','));
  }
  lines.push(['', '', `"TOTAL UNIT COST"`, '', '', '', '', data.totalUnitCost].join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cost-rollup-${data.tree.sku}-${data.mode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function NodeRow({ node, depth }: { node: RollupNode; depth: number }) {
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-3 py-2 text-sm">
          <div style={{ paddingLeft: depth * 16 }} className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-400">{node.sku}</span>
            <span className="font-medium text-slate-700">{node.name}</span>
            {node.collapsedReason && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{node.collapsedReason}</span>}
          </div>
        </td>
        <td className="px-3 py-2 text-right text-sm">{fmt(node.qtyPer)}</td>
        <td className="px-3 py-2 text-right text-sm">{fmt(node.unitCost)}</td>
        <td className="px-3 py-2 text-right text-sm">{fmt(node.labor)}</td>
        <td className="px-3 py-2 text-right text-sm">{fmt(node.overhead)}</td>
        <td className="px-3 py-2 text-right text-sm font-semibold text-slate-800">{fmt(node.lineCost)}</td>
      </tr>
      {node.components.map((c, i) => <NodeRow key={i} node={c} depth={depth + 1} />)}
    </>
  );
}

export default function CostRollupTab() {
  const [productId, setProductId] = useState('');
  const [mode, setMode] = useState<'standard' | 'fifo'>('standard');
  const [warehouseId, setWarehouseId] = useState('');

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ['products'], queryFn: () => productService.list() });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ['warehouses'], queryFn: () => inventoryService.warehouses() });

  const { data, isLoading, error } = useQuery<CostRollupResponse>({
    queryKey: ['cost-rollup', productId, mode, warehouseId],
    queryFn: () => bomService.costRollup(productId, { mode, warehouseId: mode === 'fifo' ? warehouseId : undefined }),
    enabled: Boolean(productId) && (mode === 'standard' || Boolean(warehouseId)),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Finished Good</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Cost Source</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'standard' | 'fifo')} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="standard">Standard (product cost price)</option>
              <option value="fifo">FIFO (live cost layers)</option>
            </select>
          </div>
          {mode === 'fifo' && (
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        {!productId ? (
          <div className="p-10 text-center text-sm text-slate-400">
            <Calculator className="mx-auto mb-2 text-slate-300" size={28} />
            Pick a finished-good to roll up its component cost.
          </div>
        ) : isLoading ? (
          <div className="p-6 text-center text-sm text-slate-400">Calculating…</div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-rose-600">{(error as Error).message}</div>
        ) : data ? (
          <>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="text-sm text-slate-500">Mode: <span className="font-semibold text-slate-700">{data.mode.toUpperCase()}</span>{data.warehouseId ? ` · Warehouse: ${warehouses.find((w) => w.id === data.warehouseId)?.code}` : ''}</div>
              <div className="flex items-center gap-3">
                <div className="text-base font-bold text-slate-800">Total Unit Cost: {fmt(data.totalUnitCost)}</div>
                <button onClick={() => downloadCsv(data)} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"><Download size={14} /> CSV</button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Component</th>
                  <th className="px-3 py-2 text-right">Qty/Unit</th>
                  <th className="px-3 py-2 text-right">Unit Cost</th>
                  <th className="px-3 py-2 text-right">Labor</th>
                  <th className="px-3 py-2 text-right">Overhead</th>
                  <th className="px-3 py-2 text-right">Line Cost</th>
                </tr>
              </thead>
              <tbody>
                <NodeRow node={data.tree} depth={0} />
              </tbody>
            </table>
          </>
        ) : null}
      </div>
    </div>
  );
}

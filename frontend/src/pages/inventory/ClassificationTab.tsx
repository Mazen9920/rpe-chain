import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, X } from 'lucide-react';
import { inventoryService } from '../../services';

type CellData = { count: number; onHandValue: number };
type MatrixResp = {
  matrix: {
    A: { X: CellData; Y: CellData; Z: CellData };
    B: { X: CellData; Y: CellData; Z: CellData };
    C: { X: CellData; Y: CellData; Z: CellData };
    unclassified: CellData;
  };
  totalProducts: number;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  abcClass: string | null;
  xyzClass: string | null;
  reorderPoint: number;
  reorderQty: number;
  onHand: number;
};

const ABC_BANDS: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
const XYZ_BANDS: Array<'X' | 'Y' | 'Z'> = ['X', 'Y', 'Z'];

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function ClassificationTab() {
  const qc = useQueryClient();
  const [drill, setDrill] = useState<{ abc?: string; xyz?: string } | null>(null);

  const matrixQuery = useQuery<MatrixResp>({
    queryKey: ['inventory', 'classification', 'matrix'],
    queryFn: inventoryService.classificationMatrix,
  });

  const runMutation = useMutation({
    mutationFn: (dryRun: boolean) => inventoryService.runClassification(dryRun),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'classification'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const drillQuery = useQuery<{ total: number; rows: ProductRow[] }>({
    queryKey: ['inventory', 'classification', 'drill', drill?.abc, drill?.xyz],
    queryFn: () => inventoryService.classificationProducts({ abc: drill?.abc, xyz: drill?.xyz, limit: 200 }),
    enabled: !!drill,
  });

  const matrix = matrixQuery.data?.matrix;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">ABC / XYZ Classification</h2>
          <p className="text-sm text-slate-500">Revenue band × demand variability. Click any cell to drill into products.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runMutation.mutate(true)}
            disabled={runMutation.isPending}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} /> Dry-run
          </button>
          <button
            onClick={() => runMutation.mutate(false)}
            disabled={runMutation.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={14} /> Run classification
          </button>
        </div>
      </div>

      {runMutation.data ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {runMutation.data.dryRun ? 'Dry-run complete.' : 'Classification updated.'} Total: {runMutation.data.total} · class changes: {runMutation.data.classChanges} · ROP updates: {runMutation.data.ropUpdates}
        </div>
      ) : null}

      {matrixQuery.isLoading ? (
        <div className="text-sm text-slate-500">Loading matrix…</div>
      ) : !matrix ? (
        <div className="text-sm text-red-600">Unable to load classification matrix.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="grid grid-cols-[80px_repeat(3,1fr)] gap-2 text-sm">
            <div />
            {XYZ_BANDS.map((x) => (
              <div key={x} className="text-center font-semibold text-slate-600">{x} <span className="text-xs font-normal text-slate-400">({x === 'X' ? 'stable' : x === 'Y' ? 'variable' : 'erratic'})</span></div>
            ))}
            {ABC_BANDS.map((a) => (
              <Row key={a} abc={a} matrix={matrix} onClick={(xyz) => setDrill({ abc: a, xyz })} />
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setDrill({})}
              className="text-slate-600 hover:text-slate-800 underline-offset-2 hover:underline"
            >
              Unclassified: {matrix.unclassified.count} ({fmtMoney(matrix.unclassified.onHandValue)})
            </button>
            <div className="text-slate-500">Total products: {matrixQuery.data?.totalProducts}</div>
          </div>
        </div>
      )}

      {drill ? (
        <div className="fixed inset-0 z-40 bg-black/40 flex justify-end" onClick={() => setDrill(null)}>
          <div className="w-full max-w-2xl bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div>
                <div className="text-sm text-slate-500">Drill-down</div>
                <div className="text-lg font-semibold text-slate-800">
                  {drill.abc || drill.xyz ? `${drill.abc ?? ''}${drill.xyz ?? ''} band` : 'Unclassified'}
                </div>
              </div>
              <button onClick={() => setDrill(null)} className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="p-5">
              {drillQuery.isLoading ? (
                <div className="text-sm text-slate-500">Loading…</div>
              ) : !drillQuery.data || drillQuery.data.rows.length === 0 ? (
                <div className="text-sm text-slate-500">No products in this band.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">SKU</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Name</th>
                      <th className="text-right px-3 py-2 text-slate-500 font-medium">On Hand</th>
                      <th className="text-right px-3 py-2 text-slate-500 font-medium">ROP</th>
                      <th className="text-right px-3 py-2 text-slate-500 font-medium">ROQ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drillQuery.data.rows.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.sku}</td>
                        <td className="px-3 py-2 text-slate-800">{p.name}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{p.onHand}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{p.reorderPoint}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{p.reorderQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ abc, matrix, onClick }: { abc: 'A' | 'B' | 'C'; matrix: MatrixResp['matrix']; onClick: (xyz: 'X' | 'Y' | 'Z') => void }) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 font-semibold text-slate-600">{abc}</div>
      {XYZ_BANDS.map((x) => {
        const cell = matrix[abc][x];
        return (
          <button
            key={x}
            onClick={() => onClick(x)}
            className="rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition"
          >
            <div className="text-2xl font-semibold text-slate-800">{cell.count}</div>
            <div className="text-xs text-slate-500">{fmtMoney(cell.onHandValue)} on hand</div>
          </button>
        );
      })}
    </>
  );
}

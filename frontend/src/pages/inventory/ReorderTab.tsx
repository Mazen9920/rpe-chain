/**
 * ReorderTab — Phase 1 final: persistent reorder recommendations.
 * Reads saved ReorderRecommendation rows (status=PENDING) and lets the user
 * (1) generate fresh recommendations from current stock vs reorder points
 * (2) dismiss recommendations (persisted, status=DISMISSED).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackageSearch, Sparkles, X } from 'lucide-react';
import { inventoryService } from '../../services';

interface SavedRow {
  id: string;
  productId: string;
  suggestedQty: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reasoning: {
    totalOnHand?: number;
    reorderPoint?: number;
    shortfall?: number;
    supplierName?: string | null;
    leadTimeDays?: number | null;
  };
  createdAt: string;
  product: { id: string; sku: string; name: string; uom: string; reorderPoint: number | null };
  targetSupplier: { id: string; code: string; name: string } | null;
}

const URGENCY_BG: Record<string, string> = {
  CRITICAL: 'bg-red-50',
  HIGH:     'bg-orange-50',
  MEDIUM:   'bg-amber-50',
  LOW:      '',
};

const URGENCY_PILL: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH:     'bg-orange-100 text-orange-700',
  MEDIUM:   'bg-amber-100 text-amber-700',
  LOW:      'bg-slate-100 text-slate-600',
};

export default function ReorderTab() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading, isError, refetch } = useQuery<SavedRow[]>({
    queryKey: ['inventory', 'reorder-saved'],
    queryFn: () => inventoryService.savedReorder('PENDING'),
  });

  const generate = useMutation({
    mutationFn: inventoryService.generateReorder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'reorder-saved'] }),
  });

  const dismiss = useMutation({
    mutationFn: inventoryService.dismissReorder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'reorder-saved'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-600" />
          <div>
            <p className="font-semibold text-amber-800">
              {rows.length === 0 ? 'No pending recommendations' : `${rows.length} saved reorder recommendation${rows.length > 1 ? 's' : ''}`}
            </p>
            <p className="text-xs text-amber-700">Persisted in the ReorderRecommendation table. Drafted POs and dismissals are tracked.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            <Sparkles size={13} />
            {generate.isPending ? 'Generating…' : 'Generate Recommendations'}
          </button>
          <button onClick={() => refetch()} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">Refresh</button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-slate-500">Loading recommendations…</div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-red-600">Failed to load recommendations.</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-100 bg-white p-12 text-center">
          <PackageSearch size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600">No pending reorder recommendations.</p>
          <p className="mt-1 text-sm text-slate-400">Click "Generate Recommendations" to scan stock levels.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {['Urgency', 'Product', 'On Hand', 'Reorder Point', 'Shortfall', 'Suggested Qty', 'Supplier', 'Lead Time', 'Created', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className={`hover:bg-slate-50 ${URGENCY_BG[row.urgency] ?? ''}`}>
                    <td className="px-5 py-3"><span className={`rounded px-2 py-0.5 text-[10px] font-bold ${URGENCY_PILL[row.urgency]}`}>{row.urgency}</span></td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{row.product.name}</p>
                      <p className="font-mono text-xs text-slate-400">{row.product.sku}</p>
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-700">{row.reasoning.totalOnHand ?? '—'} <span className="text-xs font-normal text-slate-400">{row.product.uom}</span></td>
                    <td className="px-5 py-3 text-slate-600">{row.reasoning.reorderPoint ?? row.product.reorderPoint ?? '—'}</td>
                    <td className="px-5 py-3"><span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">−{row.reasoning.shortfall ?? 0}</span></td>
                    <td className="px-5 py-3 font-semibold text-slate-700">{row.suggestedQty}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.targetSupplier
                        ? <><p className="font-medium">{row.targetSupplier.name}</p><p className="text-xs text-slate-400">{row.targetSupplier.code}</p></>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.reasoning.leadTimeDays != null ? `${row.reasoning.leadTimeDays}d` : '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => dismiss.mutate(row.id)}
                        disabled={dismiss.isPending}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60"
                      ><X size={11} /> Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

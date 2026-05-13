/**
 * ReportsTab — Slice 8: Inventory Reports & CSV Export
 * Three report types:
 *  1. Stock Snapshot — current on-hand per product per warehouse
 *  2. Movement History — all stock movements with date-range filter
 *  3. Valuation Summary — FIFO-costed value per product per warehouse
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, Loader2 } from 'lucide-react';
import { inventoryService } from '../../services';
import type { Warehouse } from '../../types/inventory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StockSnapshotRow {
  warehouseCode: string;
  warehouseName: string;
  sku: string;
  productName: string;
  uom: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number | null;
}

interface MovementRow {
  date: string;
  sku: string;
  productName: string;
  warehouse: string;
  qty: number;
  uom: string;
  reasonCode: string;
  lot: string | null;
  sourceDoc: string | null;
  notes: string | null;
}

interface ValuationRow {
  sku: string;
  productName: string;
  uom: string;
  warehouseCode: string;
  warehouseName: string;
  onHand: number;
  avgUnitCost: number;
  totalValue: number;
}

type ReportType = 'stock-snapshot' | 'movement-history' | 'valuation-summary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function today() {
  return new Date().toISOString().slice(0, 10);
}
function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ReportsTab() {
  const [activeReport, setActiveReport] = useState<ReportType>('stock-snapshot');
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [from, setFrom] = useState(thirtyDaysAgo());
  const [to, setTo] = useState(today());
  const [preview, setPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['inventory', 'warehouses'],
    queryFn: inventoryService.warehouses,
  });

  // Preview queries — only enabled when user clicks "Preview"
  const snapshotQ = useQuery<StockSnapshotRow[]>({
    queryKey: ['report', 'stock-snapshot', warehouseId],
    queryFn: () => inventoryService.reportStockSnapshot({ warehouseId: warehouseId || undefined }),
    enabled: preview && activeReport === 'stock-snapshot',
  });

  const movementQ = useQuery<MovementRow[]>({
    queryKey: ['report', 'movement-history', warehouseId, productId, from, to],
    queryFn: () =>
      inventoryService.reportMovementHistory({
        warehouseId: warehouseId || undefined,
        productId: productId || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    enabled: preview && activeReport === 'movement-history',
  });

  const valuationQ = useQuery<ValuationRow[]>({
    queryKey: ['report', 'valuation-summary', warehouseId],
    queryFn: () => inventoryService.reportValuationSummary({ warehouseId: warehouseId || undefined }),
    enabled: preview && activeReport === 'valuation-summary',
  });

  const handlePreview = () => setPreview(true);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const baseParams = {
        warehouseId: warehouseId || undefined,
        productId: productId || undefined,
        ...(activeReport === 'movement-history' ? { from: from || undefined, to: to || undefined } : {}),
      };
      const pathMap: Record<ReportType, string> = {
        'stock-snapshot': '/inventory/reports/stock-snapshot',
        'movement-history': '/inventory/reports/movement-history',
        'valuation-summary': '/inventory/reports/valuation-summary',
      };
      const nameMap: Record<ReportType, string> = {
        'stock-snapshot': 'stock-snapshot.csv',
        'movement-history': 'movement-history.csv',
        'valuation-summary': 'valuation-summary.csv',
      };
      await inventoryService.downloadCsv(pathMap[activeReport], baseParams, nameMap[activeReport]);
    } finally {
      setDownloading(false);
    }
  };

  // When report type changes, clear preview
  const selectReport = (r: ReportType) => {
    setActiveReport(r);
    setPreview(false);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const REPORTS: { id: ReportType; label: string; description: string }[] = [
    { id: 'stock-snapshot', label: 'Stock Snapshot', description: 'Current on-hand, reserved, and available qty for every product × warehouse.' },
    { id: 'movement-history', label: 'Movement History', description: 'All stock movements within a date range, filterable by warehouse and product.' },
    { id: 'valuation-summary', label: 'Valuation Summary', description: 'FIFO-costed inventory value per product per warehouse.' },
  ];

  return (
    <div className="space-y-6">
      {/* Report selector */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => selectReport(r.id)}
            className={`rounded-xl border p-4 text-left transition-colors ${activeReport === r.id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'}`}
          >
            <p className="font-semibold">{r.label}</p>
            <p className={`mt-1 text-xs leading-relaxed ${activeReport === r.id ? 'text-slate-300' : 'text-slate-500'}`}>{r.description}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="mb-4 text-sm font-semibold text-slate-700">Filters</p>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => { setWarehouseId(e.target.value); setPreview(false); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            >
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>

          {activeReport === 'movement-history' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
                <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(false); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
                <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(false); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none" />
              </div>
            </>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={handlePreview}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Eye size={15} />
            Preview
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 transition-colors"
          >
            {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Download CSV
          </button>
        </div>
      </div>

      {/* Preview table */}
      {preview && activeReport === 'stock-snapshot' && <StockSnapshotTable query={snapshotQ} />}
      {preview && activeReport === 'movement-history' && <MovementHistoryTable query={movementQ} />}
      {preview && activeReport === 'valuation-summary' && <ValuationTable query={valuationQ} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview tables
// ---------------------------------------------------------------------------

function PreviewWrapper({ isLoading, children }: { isLoading: boolean; children: React.ReactNode }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-100 bg-white p-8 text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Loading preview…
      </div>
    );
  }
  return <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-x-auto">{children}</div>;
}

function StockSnapshotTable({ query }: { query: { isLoading: boolean; data?: StockSnapshotRow[] } }) {
  const rows = query.data ?? [];
  return (
    <PreviewWrapper isLoading={query.isLoading}>
      <p className="px-5 py-3 text-xs text-slate-400 border-b border-slate-100">{rows.length} rows</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50">
            {['Warehouse', 'SKU', 'Product', 'UOM', 'On Hand', 'Reserved', 'Available', 'Reorder Pt'].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-2 text-slate-500 text-xs font-mono">{r.warehouseCode}</td>
              <td className="px-4 py-2 text-slate-500 text-xs font-mono">{r.sku}</td>
              <td className="px-4 py-2 font-medium text-slate-800">{r.productName}</td>
              <td className="px-4 py-2 text-slate-500 text-xs">{r.uom}</td>
              <td className="px-4 py-2 font-semibold text-slate-700">{r.onHand}</td>
              <td className="px-4 py-2 text-amber-600">{r.reserved}</td>
              <td className="px-4 py-2 text-green-700 font-semibold">{r.available}</td>
              <td className="px-4 py-2 text-slate-400">{r.reorderPoint ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PreviewWrapper>
  );
}

function MovementHistoryTable({ query }: { query: { isLoading: boolean; data?: MovementRow[] } }) {
  const rows = query.data ?? [];
  return (
    <PreviewWrapper isLoading={query.isLoading}>
      <p className="px-5 py-3 text-xs text-slate-400 border-b border-slate-100">{rows.length} rows (max 5,000)</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50">
            {['Date', 'SKU', 'Product', 'Warehouse', 'Qty', 'UOM', 'Reason', 'Lot', 'Source Doc'].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-2 text-xs text-slate-400">{new Date(r.date).toLocaleString()}</td>
              <td className="px-4 py-2 text-xs font-mono text-slate-500">{r.sku}</td>
              <td className="px-4 py-2 text-slate-800">{r.productName}</td>
              <td className="px-4 py-2 text-slate-500 text-xs">{r.warehouse}</td>
              <td className={`px-4 py-2 font-semibold ${r.qty >= 0 ? 'text-green-700' : 'text-red-600'}`}>{r.qty > 0 ? `+${r.qty}` : r.qty}</td>
              <td className="px-4 py-2 text-xs text-slate-400">{r.uom}</td>
              <td className="px-4 py-2 text-xs font-mono text-slate-500">{r.reasonCode}</td>
              <td className="px-4 py-2 text-xs text-slate-400">{r.lot ?? '—'}</td>
              <td className="px-4 py-2 text-xs text-slate-400">{r.sourceDoc ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PreviewWrapper>
  );
}

function ValuationTable({ query }: { query: { isLoading: boolean; data?: ValuationRow[] } }) {
  const rows = query.data ?? [];
  const grandTotal = rows.reduce((s, r) => s + r.totalValue, 0);
  return (
    <PreviewWrapper isLoading={query.isLoading}>
      <p className="px-5 py-3 text-xs text-slate-400 border-b border-slate-100">
        {rows.length} rows · Grand total: <span className="font-semibold text-slate-700">{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50">
            {['Warehouse', 'SKU', 'Product', 'UOM', 'On Hand', 'Avg Unit Cost', 'Total Value'].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-2 text-xs font-mono text-slate-500">{r.warehouseCode}</td>
              <td className="px-4 py-2 text-xs font-mono text-slate-500">{r.sku}</td>
              <td className="px-4 py-2 font-medium text-slate-800">{r.productName}</td>
              <td className="px-4 py-2 text-xs text-slate-400">{r.uom}</td>
              <td className="px-4 py-2 text-slate-700">{r.onHand}</td>
              <td className="px-4 py-2 text-slate-600">{r.avgUnitCost.toFixed(4)}</td>
              <td className="px-4 py-2 font-semibold text-slate-800">{r.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PreviewWrapper>
  );
}

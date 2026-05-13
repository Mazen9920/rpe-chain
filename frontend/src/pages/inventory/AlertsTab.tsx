/**
 * AlertsTab — Slice 7: Expiry & Stock Alerts
 * Two sections:
 *  1. Expiry alerts — lots expiring within 90 days or already expired, colour-coded by severity
 *  2. Zero-stock alerts — active products with 0 on-hand in any warehouse
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, BellOff, Check, Clock, Package2, Sparkles } from 'lucide-react';
import { inventoryService } from '../../services';

interface ExpiryAlert {
  type: 'EXPIRY';
  severity: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'WATCH';
  daysLeft: number;
  lot: { id: string; lotNumber: string; qtyRemaining: number; expiryDate: string; currentBin: { id: string; code: string } | null };
  product: { id: string; sku: string; name: string; uom: string };
}

interface ZeroStockAlert {
  type: 'ZERO_STOCK';
  severity: 'CRITICAL';
  stockLevel: { onHand: number };
  product: { id: string; sku: string; name: string; uom: string; reorderPoint: number | null };
  warehouse: { id: string; code: string; name: string };
}

interface AlertsResponse {
  expiryAlerts: ExpiryAlert[];
  zeroStockAlerts: ZeroStockAlert[];
  summary: { expiry: number; zeroStock: number };
}

const SEVERITY_STYLE: Record<string, { badge: string; row: string; icon: React.ElementType }> = {
  EXPIRED: { badge: 'bg-red-100 text-red-700', row: 'bg-red-50', icon: AlertCircle },
  CRITICAL: { badge: 'bg-red-100 text-red-700', row: 'bg-orange-50', icon: AlertTriangle },
  WARNING: { badge: 'bg-amber-100 text-amber-700', row: '', icon: AlertTriangle },
  WATCH: { badge: 'bg-yellow-100 text-yellow-700', row: '', icon: Clock },
};

const SEVERITY_ORDER: Record<string, number> = { EXPIRED: 0, CRITICAL: 1, WARNING: 2, WATCH: 3 };

type SeverityFilter = 'ALL' | 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'WATCH';

export default function AlertsTab() {
  const qc = useQueryClient();
  const [expiryFilter, setExpiryFilter] = useState<SeverityFilter>('ALL');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data, isLoading, isError } = useQuery<AlertsResponse>({
    queryKey: ['inventory', 'alerts'],
    queryFn: inventoryService.alerts,
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
  });

  const { data: openPersisted } = useQuery<{
    alerts: Array<{ id: string; type: string; severity: string; reasoning: string; createdAt: string; product: { sku: string; name: string } | null }>;
    counts: Record<string, number>;
    total: number;
  }>({
    queryKey: ['alerts', 'open'],
    queryFn: () => inventoryService.openAlerts(50),
    refetchInterval: 60_000,
  });

  const scan = useMutation({
    mutationFn: inventoryService.scanAlerts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts', 'open'] });
      qc.invalidateQueries({ queryKey: ['inventory', 'alerts'] });
    },
  });

  const ack = useMutation({
    mutationFn: inventoryService.acknowledgeAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', 'open'] }),
  });

  const dismiss = (key: string) => setDismissed((d) => new Set([...d, key]));

  const filteredExpiry = (data?.expiryAlerts ?? [])
    .filter((a) => (expiryFilter === 'ALL' || a.severity === expiryFilter) && !dismissed.has(`exp:${a.lot.id}`))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const filteredZero = (data?.zeroStockAlerts ?? [])
    .filter((a) => !dismissed.has(`zero:${a.product.id}:${a.warehouse.id}`));

  if (isLoading) {
    return <div className="rounded-xl border border-slate-100 bg-white p-8 text-center text-slate-500">Loading alerts…</div>;
  }

  if (isError) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-red-600">Failed to load alerts.</div>;
  }

  const totalActive = filteredExpiry.length + filteredZero.length;

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <div className={`flex items-center justify-between rounded-xl border px-5 py-4 ${totalActive > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
        <div className="flex items-center gap-3">
          {totalActive > 0 ? <AlertCircle size={20} className="text-red-600" /> : <BellOff size={20} className="text-green-600" />}
          <div>
            <p className={`font-semibold ${totalActive > 0 ? 'text-red-800' : 'text-green-800'}`}>
              {totalActive === 0 ? 'No active alerts' : `${totalActive} alert${totalActive > 1 ? 's' : ''} require attention`}
            </p>
            {data ? (
              <p className={`text-xs ${totalActive > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {data.summary.expiry} expiry · {data.summary.zeroStock} zero-stock · {openPersisted?.total ?? 0} persisted open
              </p>
            ) : null}
          </div>
        </div>
        <button
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          <Sparkles size={13} />
          {scan.isPending ? 'Scanning…' : 'Scan & Persist Alerts'}
        </button>
      </div>

      {/* Persisted Alerts (audit trail) */}
      {openPersisted && openPersisted.alerts.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle size={16} className="text-slate-500" />
            <h3 className="font-semibold text-slate-800">Persisted Open Alerts</h3>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{openPersisted.total}</span>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {['Severity', 'Type', 'Product', 'Reasoning', 'Created', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openPersisted.alerts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        a.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                        a.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                        a.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{a.severity}</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{a.type}</td>
                    <td className="px-5 py-3">
                      {a.product ? (<><p className="font-medium text-slate-800">{a.product.name}</p><p className="font-mono text-xs text-slate-400">{a.product.sku}</p></>) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{a.reasoning}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => ack.mutate(a.id)}
                        disabled={ack.isPending}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60"
                      ><Check size={11} /> Acknowledge</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Section 1 — Expiry Alerts */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-slate-500" />
            <h3 className="font-semibold text-slate-800">Expiry Alerts</h3>
            {(data?.expiryAlerts.length ?? 0) > 0 ? (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">{data?.expiryAlerts.length}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {(['ALL', 'EXPIRED', 'CRITICAL', 'WARNING', 'WATCH'] as SeverityFilter[]).map((s) => (
              <button key={s} onClick={() => setExpiryFilter(s)} className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${expiryFilter === s ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{s}</button>
            ))}
          </div>
        </div>

        {filteredExpiry.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-white p-6 text-center text-slate-500 text-sm">No expiry alerts at this severity level.</div>
        ) : (
          <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {['Severity', 'Lot', 'Product', 'Qty Remaining', 'Expiry Date', 'Days Left', 'Bin', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredExpiry.map((alert) => {
                  const style = SEVERITY_STYLE[alert.severity];
                  const Icon = style.icon;
                  return (
                    <tr key={alert.lot.id} className={`hover:bg-slate-50 ${style.row}`}>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${style.badge}`}>
                          <Icon size={11} />{alert.severity}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{alert.lot.lotNumber}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-800">{alert.product.name}</p>
                        <p className="font-mono text-xs text-slate-400">{alert.product.sku}</p>
                      </td>
                      <td className="px-5 py-3 font-semibold text-slate-700">{alert.lot.qtyRemaining} <span className="font-normal text-xs text-slate-400">{alert.product.uom}</span></td>
                      <td className="px-5 py-3 text-slate-600">{new Date(alert.lot.expiryDate).toLocaleDateString()}</td>
                      <td className="px-5 py-3">
                        <span className={`font-semibold ${alert.daysLeft < 0 ? 'text-red-600' : alert.daysLeft < 30 ? 'text-orange-600' : 'text-amber-600'}`}>
                          {alert.daysLeft < 0 ? `${Math.abs(alert.daysLeft)}d ago` : `${alert.daysLeft}d`}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs font-mono">{alert.lot.currentBin?.code ?? '—'}</td>
                      <td className="px-5 py-3">
                        <button onClick={() => dismiss(`exp:${alert.lot.id}`)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">Dismiss</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2 — Zero Stock Alerts */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Package2 size={16} className="text-slate-500" />
          <h3 className="font-semibold text-slate-800">Zero Stock</h3>
          {(data?.zeroStockAlerts.length ?? 0) > 0 ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">{data?.zeroStockAlerts.length}</span>
          ) : null}
        </div>

        {filteredZero.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-white p-6 text-center text-slate-500 text-sm">No zero-stock positions.</div>
        ) : (
          <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {['Product', 'Warehouse', 'On Hand', 'Reorder Point', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-medium text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredZero.map((alert) => (
                  <tr key={`${alert.product.id}:${alert.warehouse.id}`} className="bg-red-50 hover:bg-red-100/40">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{alert.product.name}</p>
                      <p className="font-mono text-xs text-slate-400">{alert.product.sku}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{alert.warehouse.code} · {alert.warehouse.name}</td>
                    <td className="px-5 py-3 font-semibold text-red-600">0 <span className="font-normal text-xs text-slate-400">{alert.product.uom}</span></td>
                    <td className="px-5 py-3 text-slate-600">{alert.product.reorderPoint ?? '—'}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => dismiss(`zero:${alert.product.id}:${alert.warehouse.id}`)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dismissed.size > 0 ? (
        <p className="text-center text-xs text-slate-400">
          {dismissed.size} alert{dismissed.size > 1 ? 's' : ''} dismissed this session.{' '}
          <button onClick={() => setDismissed(new Set())} className="underline hover:text-slate-600">Show all</button>
        </p>
      ) : null}
    </div>
  );
}

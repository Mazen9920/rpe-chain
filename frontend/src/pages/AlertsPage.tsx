import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle, Clock, RotateCcw, RefreshCw } from 'lucide-react';
import { alertsService } from '../services';

type AlertRow = {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  productId: string | null;
  supplierId: string | null;
  entityType: string | null;
  entityId: string | null;
  reasoning: string;
  payload: Record<string, unknown> | null;
  audienceRoles: string[];
  createdAt: string;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  product?: { sku: string; name: string } | null;
  supplier?: { code: string; name: string } | null;
};

const SEV_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
  LOW: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-red-50 text-red-700',
  ACKNOWLEDGED: 'bg-blue-50 text-blue-700',
  SNOOZED: 'bg-slate-100 text-slate-700',
  RESOLVED: 'bg-green-50 text-green-700',
};

const TYPES = ['EXPIRY', 'STOCKOUT_RISK', 'DEAD_STOCK', 'PAYMENT_DUE', 'OVERDUE', 'SUPPLIER_PERF', 'SHIPMENT_DELAY', 'CREDIT_LIMIT'];

export default function AlertsPage() {
  const [status, setStatus] = useState<string>('OPEN');
  const [type, setType] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ alerts: AlertRow[]; total: number; counts: Record<string, number> }>({
    queryKey: ['alerts', status, type, severity],
    queryFn: () => alertsService.list({ status: status || undefined, type: type || undefined, severity: severity || undefined, limit: 100 }),
    refetchInterval: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['alerts'] });

  const ackMut = useMutation({ mutationFn: alertsService.acknowledge, onSuccess: invalidate });
  const snoozeMut = useMutation({ mutationFn: ({ id, until }: { id: string; until: string }) => alertsService.snooze(id, until), onSuccess: invalidate });
  const resolveMut = useMutation({ mutationFn: alertsService.resolve, onSuccess: invalidate });
  const scanMut = useMutation({ mutationFn: alertsService.scan, onSuccess: invalidate });

  const snoozeFor = (id: string, hours: number) => {
    const until = new Date(Date.now() + hours * 3600_000).toISOString();
    snoozeMut.mutate({ id, until });
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Bell size={20} /> Alerts</h2>
          <p className="text-slate-500 text-sm">Cross-module alert triage — inventory, AP, suppliers, shipments, credit.</p>
        </div>
        <button
          onClick={() => scanMut.mutate()}
          disabled={scanMut.isPending}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-60"
        >
          <RefreshCw size={14} className={scanMut.isPending ? 'animate-spin' : ''} />
          Run scan
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => (
          <button
            key={sev}
            onClick={() => setSeverity((s) => (s === sev ? '' : sev))}
            className={`text-left rounded-xl border p-3 transition ${severity === sev ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'} ${SEV_BADGE[sev]}`}
          >
            <div className="text-xs font-medium opacity-80">{sev}</div>
            <div className="text-2xl font-bold">{data?.counts?.[sev] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-center">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm border rounded-lg px-2 py-1.5">
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="SNOOZED">Snoozed</option>
            <option value="RESOLVED">Resolved</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} className="text-sm border rounded-lg px-2 py-1.5">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {severity ? (
            <button onClick={() => setSeverity('')} className="text-xs text-blue-600 hover:underline">Clear severity</button>
          ) : null}
          <span className="text-xs text-slate-500 ml-auto">{data?.total ?? 0} match{data?.total === 1 ? '' : 'es'}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                {['Severity', 'Type', 'Subject', 'Reasoning', 'Status', 'Age', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
              ) : !data?.alerts.length ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No alerts match the filters.</td></tr>
              ) : data.alerts.map((a) => {
                const ageHours = (Date.now() - new Date(a.createdAt).getTime()) / 3600_000;
                const ageLabel = ageHours < 1 ? `${Math.round(ageHours * 60)}m` : ageHours < 24 ? `${Math.round(ageHours)}h` : `${Math.round(ageHours / 24)}d`;
                const subject = a.product ? `${a.product.sku} — ${a.product.name}` :
                  a.supplier ? `${a.supplier.code} — ${a.supplier.name}` :
                  a.entityType ? `${a.entityType}` : '—';
                return (
                  <tr key={a.id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-semibold border ${SEV_BADGE[a.severity]}`}>{a.severity}</span></td>
                    <td className="px-4 py-3 font-medium text-slate-700">{a.type}</td>
                    <td className="px-4 py-3 text-slate-700">{subject}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-md">{a.reasoning}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGE[a.status] || ''}`}>{a.status}</span></td>
                    <td className="px-4 py-3 text-slate-500">{ageLabel}</td>
                    <td className="px-4 py-3">
                      {a.status === 'OPEN' ? (
                        <div className="flex gap-1">
                          <button onClick={() => ackMut.mutate(a.id)} title="Acknowledge" className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><CheckCircle size={14} /></button>
                          <button onClick={() => snoozeFor(a.id, 24)} title="Snooze 24h" className="p-1.5 hover:bg-slate-100 rounded text-slate-600"><Clock size={14} /></button>
                          <button onClick={() => resolveMut.mutate(a.id)} title="Resolve" className="p-1.5 hover:bg-green-50 rounded text-green-600"><RotateCcw size={14} /></button>
                        </div>
                      ) : a.status === 'ACKNOWLEDGED' || a.status === 'SNOOZED' ? (
                        <button onClick={() => resolveMut.mutate(a.id)} className="text-xs text-green-600 hover:underline">Resolve</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

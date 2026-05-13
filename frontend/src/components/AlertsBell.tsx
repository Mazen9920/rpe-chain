/**
 * AlertsBell — header dropdown that shows OPEN alerts from the persistent Alert model.
 * Polls every 60s. Shows severity-coloured badge with count.
 */
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, AlertCircle, Check } from 'lucide-react';
import { inventoryService } from '../services';

interface OpenAlert {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reasoning: string;
  createdAt: string;
  product: { id: string; sku: string; name: string } | null;
}

interface OpenAlertsResponse {
  alerts: OpenAlert[];
  counts: Record<string, number>;
  total: number;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH:     'bg-orange-100 text-orange-700',
  MEDIUM:   'bg-amber-100 text-amber-700',
  LOW:      'bg-yellow-100 text-yellow-700',
};

export default function AlertsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery<OpenAlertsResponse>({
    queryKey: ['alerts', 'open'],
    queryFn: () => inventoryService.openAlerts(20),
    refetchInterval: 60_000,
  });

  const ack = useMutation({
    mutationFn: inventoryService.acknowledgeAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', 'open'] }),
  });

  const scan = useMutation({
    mutationFn: inventoryService.scanAlerts,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', 'open'] }),
  });

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const total = data?.total ?? 0;
  const critical = data?.counts?.CRITICAL ?? 0;
  const dotColor = critical > 0 ? 'bg-red-500' : total > 0 ? 'bg-amber-500' : 'bg-slate-300';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`${total} open alerts`}
        className="relative inline-flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100"
      >
        <Bell size={18} />
        {total > 0 ? (
          <span className={`absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${dotColor}`}>
            {total > 99 ? '99+' : total}
          </span>
        ) : (
          <span className={`absolute top-2 right-2 h-2 w-2 rounded-full ${dotColor}`} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 rounded-xl border border-slate-100 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="font-semibold text-slate-800">Alerts</p>
              <p className="text-xs text-slate-500">{total} open</p>
            </div>
            <button
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              {scan.isPending ? 'Scanning…' : 'Re-scan'}
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {!data?.alerts.length ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No open alerts.</p>
            ) : (
              data.alerts.map((a) => (
                <div key={a.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50">
                  <div className="mb-1 flex items-center gap-2">
                    <AlertCircle size={13} className="text-slate-400" />
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${SEV_COLOR[a.severity]}`}>{a.severity}</span>
                    <span className="text-[10px] font-mono text-slate-400">{a.type}</span>
                  </div>
                  <p className="text-sm text-slate-700">{a.reasoning}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">{new Date(a.createdAt).toLocaleString()}</span>
                    <button
                      onClick={() => ack.mutate(a.id)}
                      disabled={ack.isPending}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100"
                    >
                      <Check size={10} /> Ack
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

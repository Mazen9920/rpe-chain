import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, Trash2, Save, Send } from 'lucide-react';
import { notificationsService, type NotificationSubscription } from '../services';

const ALERT_TYPES = [
  '', // any
  'EXPIRY',
  'STOCKOUT_RISK',
  'DEAD_STOCK',
  'PAYMENT_DUE',
  'OVERDUE',
  'SUPPLIER_PERF',
  'SHIPMENT_DELAY',
  'CREDIT_LIMIT',
  'CERTIFICATION_EXPIRY',
];

const SEVERITIES: Array<'' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = ['', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

type Row = Partial<NotificationSubscription> & { _key: string };

function mkKey() {
  return `r${Math.random().toString(36).slice(2, 9)}`;
}

export default function NotificationSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notification-subs'],
    queryFn: notificationsService.listSubscriptions,
  });
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (data) {
      setRows(
        data.length
          ? data.map((d) => ({ ...d, _key: mkKey() }))
          : [{ _key: mkKey(), alertType: null, severity: 'HIGH', channel: 'EMAIL', isActive: true }],
      );
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (items: Array<Partial<NotificationSubscription>>) => notificationsService.replaceSubscriptions(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-subs'] }),
  });

  const runDigest = useMutation({ mutationFn: notificationsService.runDigest });

  const addRow = () =>
    setRows((r) => [
      ...r,
      { _key: mkKey(), alertType: null, severity: null, channel: 'EMAIL', isActive: true },
    ]);

  const removeRow = (key: string) => setRows((r) => r.filter((x) => x._key !== key));

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((r) => r.map((x) => (x._key === key ? { ...x, ...patch } : x)));

  const handleSave = () => {
    const items = rows.map(({ _key, id, userId, ...rest }) => ({
      alertType: rest.alertType || null,
      severity: rest.severity || null,
      channel: rest.channel || 'EMAIL',
      isActive: rest.isActive !== false,
    }));
    save.mutate(items);
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Bell size={20} /> Notification settings
          </h2>
          <p className="text-slate-500 text-sm">
            Receive an email when alerts matching these filters are created. Leave a field blank to match anything.
          </p>
        </div>
        <button
          onClick={() => runDigest.mutate()}
          disabled={runDigest.isPending}
          className="inline-flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-60"
          title="Admin-only: send daily digest now"
        >
          <Send size={14} /> Send digest now
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2">Alert type</th>
                <th className="text-left px-4 py-2">Min severity</th>
                <th className="text-left px-4 py-2">Channel</th>
                <th className="text-left px-4 py-2">Active</th>
                <th className="px-4 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row._key}>
                  <td className="px-4 py-2">
                    <select
                      value={row.alertType ?? ''}
                      onChange={(e) => updateRow(row._key, { alertType: e.target.value || null })}
                      className="border border-slate-200 rounded px-2 py-1"
                    >
                      {ALERT_TYPES.map((t) => (
                        <option key={t || 'any'} value={t}>
                          {t || '— any —'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={row.severity ?? ''}
                      onChange={(e) =>
                        updateRow(row._key, { severity: (e.target.value || null) as Row['severity'] })
                      }
                      className="border border-slate-200 rounded px-2 py-1"
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s || 'any'} value={s}>
                          {s || '— any —'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={row.channel ?? 'EMAIL'}
                      onChange={(e) => updateRow(row._key, { channel: e.target.value as Row['channel'] })}
                      className="border border-slate-200 rounded px-2 py-1"
                    >
                      <option value="EMAIL">EMAIL</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={row.isActive !== false}
                      onChange={(e) => updateRow(row._key, { isActive: e.target.checked })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => removeRow(row._key)}
                      className="text-red-600 hover:text-red-700"
                      title="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-t border-slate-200">
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-800"
            >
              <Plus size={14} /> Add rule
            </button>
            <div className="flex-1" />
            <button
              onClick={handleSave}
              disabled={save.isPending}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-60"
            >
              <Save size={14} /> {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {save.isSuccess && (
        <p className="mt-3 text-sm text-emerald-700">Subscriptions updated.</p>
      )}
      {runDigest.isSuccess && (
        <p className="mt-3 text-sm text-slate-600">
          Digest enqueued: {JSON.stringify(runDigest.data)}
        </p>
      )}
    </div>
  );
}

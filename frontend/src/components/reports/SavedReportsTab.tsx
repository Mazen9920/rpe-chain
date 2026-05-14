import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download, Plus, Trash2, PlayCircle, Calendar, Pencil, X, Loader2, Globe, Lock,
} from 'lucide-react';
import {
  reportDefinitionService,
  reportScheduleService,
  type ReportDefinition,
  type ReportSchedule,
  type ReportFormat,
} from '../../services';

const REPORT_KEY_LABELS: Record<string, string> = {
  'ap-aging': 'AP Aging',
  'ar-aging': 'AR Aging',
  'supplier-scorecards': 'Supplier Scorecards',
  'sales-fulfillment': 'Sales Fulfillment',
};

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily 07:00', cron: '0 7 * * *' },
  { label: 'Weekly (Mon 07:00)', cron: '0 7 * * 1' },
  { label: 'Monthly (1st 07:00)', cron: '0 7 1 * *' },
];

export default function SavedReportsTab() {
  const qc = useQueryClient();
  const definitionsQ = useQuery({
    queryKey: ['report-definitions'],
    queryFn: () => reportDefinitionService.list(),
  });
  const availableQ = useQuery({
    queryKey: ['report-keys'],
    queryFn: () => reportDefinitionService.listAvailable(),
  });
  const schedulesQ = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => reportScheduleService.list(),
  });

  const [editing, setEditing] = useState<ReportDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<ReportDefinition | null>(null);

  const removeDef = useMutation({
    mutationFn: (id: string) => reportDefinitionService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-definitions'] }),
  });

  const items = definitionsQ.data?.items || [];
  const schedulesByDef = new Map<string, ReportSchedule[]>();
  for (const s of schedulesQ.data?.items || []) {
    const arr = schedulesByDef.get(s.definitionId) || [];
    arr.push(s);
    schedulesByDef.set(s.definitionId, arr);
  }

  return (
    <div>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="text-sm text-slate-500">
          Save report presets with stored filters. Schedule recurring email exports as PDF / XLSX / CSV.
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          <Plus size={14} /> New saved report
        </button>
      </div>

      {definitionsQ.isLoading && (
        <div className="p-6 text-center text-slate-500"><Loader2 className="inline animate-spin" size={16} /> Loading…</div>
      )}
      {!definitionsQ.isLoading && items.length === 0 && (
        <div className="p-10 text-center text-slate-500">
          No saved reports yet. Click <span className="font-medium">New saved report</span> to create one.
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {items.map((def) => {
          const scheds = schedulesByDef.get(def.id) || [];
          return (
            <div key={def.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold text-slate-800 truncate">{def.name}</div>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {REPORT_KEY_LABELS[def.reportKey] || def.reportKey}
                    </span>
                    {def.isShared ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 inline-flex items-center gap-1">
                        <Globe size={11} /> Shared
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 inline-flex items-center gap-1">
                        <Lock size={11} /> Private
                      </span>
                    )}
                  </div>
                  {def.description && <div className="text-xs text-slate-500 mt-0.5">{def.description}</div>}
                  <div className="text-xs text-slate-400 mt-1">
                    by {def.owner?.name || def.owner?.email || '—'} · created {new Date(def.createdAt).toLocaleDateString()}
                  </div>
                  {scheds.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {scheds.map((s) => (
                        <ScheduleRow key={s.id} schedule={s} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <DownloadMenu definitionId={def.id} name={def.name} />
                  <button
                    onClick={() => setScheduleFor(def)}
                    className="inline-flex items-center gap-1 px-2 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50"
                    title="Schedule"
                  >
                    <Calendar size={13} /> Schedule
                  </button>
                  <button
                    onClick={() => setEditing(def)}
                    className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
                    title="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete saved report "${def.name}"?`)) removeDef.mutate(def.id);
                    }}
                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(creating || editing) && (
        <DefinitionDrawer
          reportKeys={availableQ.data?.reportKeys || []}
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
      {scheduleFor && (
        <ScheduleDrawer
          definition={scheduleFor}
          onClose={() => setScheduleFor(null)}
        />
      )}
    </div>
  );
}

function DownloadMenu({ definitionId, name }: { definitionId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const fmts: ReportFormat[] = ['CSV', 'XLSX', 'PDF'];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50"
      >
        <Download size={13} /> Export
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-md py-1 w-32">
            {fmts.map((f) => (
              <button
                key={f}
                onClick={async () => {
                  setOpen(false);
                  await reportDefinitionService.download(definitionId, f, name);
                }}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                {f}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ScheduleRow({ schedule }: { schedule: ReportSchedule }) {
  const qc = useQueryClient();
  const runNow = useMutation({
    mutationFn: () => reportScheduleService.runNow(schedule.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  });
  const remove = useMutation({
    mutationFn: () => reportScheduleService.remove(schedule.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  });
  return (
    <div className="flex items-center gap-2 text-xs bg-slate-50 rounded px-2 py-1">
      <Calendar size={11} className="text-slate-500" />
      <code className="font-mono">{schedule.cron}</code>
      <span className="text-slate-500">·</span>
      <span>{schedule.format}</span>
      <span className="text-slate-500">·</span>
      <span className="truncate">{schedule.recipients.join(', ')}</span>
      {schedule.nextRunAt && (
        <>
          <span className="text-slate-500">·</span>
          <span className="text-slate-500">next {new Date(schedule.nextRunAt).toLocaleString()}</span>
        </>
      )}
      <button
        onClick={() => runNow.mutate()}
        disabled={runNow.isPending}
        className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 rounded"
        title="Run now"
      >
        {runNow.isPending ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />} Run
      </button>
      <button
        onClick={() => {
          if (confirm('Delete this schedule?')) remove.mutate();
        }}
        className="p-0.5 text-red-500 hover:bg-red-50 rounded"
        title="Delete schedule"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function DefinitionDrawer({
  reportKeys, existing, onClose,
}: { reportKeys: string[]; existing: ReportDefinition | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(existing?.name || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [reportKey, setReportKey] = useState(existing?.reportKey || reportKeys[0] || '');
  const [paramsJson, setParamsJson] = useState(JSON.stringify(existing?.params || {}, null, 2));
  const [isShared, setIsShared] = useState(existing?.isShared || false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let params: Record<string, unknown> = {};
      try { params = paramsJson.trim() ? JSON.parse(paramsJson) : {}; }
      catch { throw new Error('Params must be valid JSON'); }
      if (existing) {
        return reportDefinitionService.update(existing.id, { name, description, params, isShared });
      }
      return reportDefinitionService.create({ name, description, reportKey, params, isShared });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-definitions'] });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as { message?: string })?.message
        || 'Save failed';
      setError(msg);
    },
  });

  return (
    <Drawer title={existing ? 'Edit saved report' : 'New saved report'} onClose={onClose}>
      <Field label="Name">
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
          placeholder="e.g. Weekly AR Aging"
        />
      </Field>
      <Field label="Description (optional)">
        <input
          value={description || ''} onChange={(e) => setDescription(e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Report">
        <select
          value={reportKey} onChange={(e) => setReportKey(e.target.value)}
          disabled={!!existing}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm disabled:bg-slate-50"
        >
          {reportKeys.map((k) => (
            <option key={k} value={k}>{REPORT_KEY_LABELS[k] || k}</option>
          ))}
        </select>
      </Field>
      <Field label="Filter params (JSON)">
        <textarea
          value={paramsJson} onChange={(e) => setParamsJson(e.target.value)}
          rows={6}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-mono"
          placeholder='{}'
        />
        <div className="text-xs text-slate-400 mt-1">
          Examples: <code>{'{"supplierId":"..."}'}</code>, <code>{'{"from":"2026-01-01","to":"2026-03-31"}'}</code>.
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
        Shared with team (visible to all users)
      </label>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-slate-200">Cancel</button>
        <button
          onClick={() => save.mutate()}
          disabled={!name.trim() || !reportKey || save.isPending}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Drawer>
  );
}

function ScheduleDrawer({ definition, onClose }: { definition: ReportDefinition; onClose: () => void }) {
  const qc = useQueryClient();
  const [cron, setCron] = useState('0 7 * * *');
  const [format, setFormat] = useState<ReportFormat>('PDF');
  const [recipients, setRecipients] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const list = recipients.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      return reportScheduleService.create({
        definitionId: definition.id,
        cron, format, recipients: list,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-schedules'] });
      qc.invalidateQueries({ queryKey: ['report-definitions'] });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as { message?: string })?.message
        || 'Save failed';
      setError(msg);
    },
  });

  return (
    <Drawer title={`Schedule: ${definition.name}`} onClose={onClose}>
      <Field label="Cron preset">
        <div className="flex flex-wrap gap-1.5">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.cron}
              onClick={() => setCron(p.cron)}
              className={`px-2 py-1 text-xs rounded border ${
                cron === p.cron ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Cron expression">
        <input
          value={cron} onChange={(e) => setCron(e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-mono"
          placeholder="0 7 * * *"
        />
        <div className="text-xs text-slate-400 mt-1">5-field: minute hour day month dayOfWeek (UTC).</div>
      </Field>
      <Field label="Format">
        <div className="flex gap-2">
          {(['PDF', 'XLSX', 'CSV'] as ReportFormat[]).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`px-3 py-1.5 text-sm rounded border ${
                format === f ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Recipients (comma-separated emails)">
        <textarea
          value={recipients} onChange={(e) => setRecipients(e.target.value)}
          rows={2}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
          placeholder="finance@example.com, ops@example.com"
        />
      </Field>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-slate-200">Cancel</button>
        <button
          onClick={() => create.mutate()}
          disabled={!cron || !recipients.trim() || create.isPending}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Create schedule'}
        </button>
      </div>
    </Drawer>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="font-semibold text-slate-800">{title}</div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-800"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-1">{label}</div>
      {children}
    </div>
  );
}

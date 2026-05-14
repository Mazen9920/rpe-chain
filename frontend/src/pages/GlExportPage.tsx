// GL Export page — accounts, mappings, journals tabs (Tier 4 #17 — v1.7.0).
// v1.7.1: Integration Connect cards (QuickBooks + Xero) using OAuth2.
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Trash2, Download, Send, RefreshCw, Link2, LogOut } from 'lucide-react';
import { glService, integrationsService } from '../services';
import type { GlAccount, GlAccountType, GlJournal, IntegrationProvider, IntegrationStatus } from '../services';
import { formatMoney } from '../utils/format';

type Tab = 'journals' | 'accounts' | 'mappings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'journals', label: 'Journals' },
  { id: 'accounts', label: 'Chart of Accounts' },
  { id: 'mappings', label: 'Mappings' },
];

export default function GlExportPage() {
  const [tab, setTab] = useState<Tab>('journals');
  // Toast on OAuth callback redirect (?connected=quickbooks|xero).
  useEffect(() => {
    const u = new URL(window.location.href);
    const conn = u.searchParams.get('connected');
    if (conn) {
      alert(`${conn === 'quickbooks' ? 'QuickBooks' : 'Xero'} connected.`);
      u.searchParams.delete('connected');
      window.history.replaceState({}, '', u.pathname + (u.search ? `?${u.searchParams}` : ''));
    }
  }, []);
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen size={22} className="text-slate-700" />
        <h1 className="text-xl font-semibold">GL Export</h1>
      </div>
      <IntegrationsStrip />
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 ${tab === t.id ? 'border-slate-800 text-slate-900 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'journals' && <JournalsTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'mappings' && <MappingsTab />}
    </div>
  );
}

// ────────── Journals tab ──────────
function JournalsTab() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(ninetyAgo);
  const [to, setTo] = useState(today);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['gl', 'journals', from, to],
    queryFn: () => glService.listJournals({ from, to, limit: 100 }),
  });

  const generateMut = useMutation({
    mutationFn: () => glService.generate(from, to),
    onSuccess: (r) => {
      alert(`Generated ${r.createdCount} new journals (${r.skippedCount} skipped, ${r.errors.length} errors)`);
      qc.invalidateQueries({ queryKey: ['gl', 'journals'] });
    },
  });

  const pushMut = useMutation({
    mutationFn: ({ id, provider }: { id: string; provider: 'quickbooks' | 'xero' }) =>
      glService.push(id, provider),
    onSuccess: () => {
      alert('Push enqueued. Refresh in a moment to see externalId.');
      qc.invalidateQueries({ queryKey: ['gl', 'journals'] });
    },
  });

  const qboStatus = useQuery({ queryKey: ['integration', 'quickbooks'], queryFn: () => integrationsService.getStatus('quickbooks'), refetchOnWindowFocus: true });
  const xeroStatus = useQuery({ queryKey: ['integration', 'xero'], queryFn: () => integrationsService.getStatus('xero'), refetchOnWindowFocus: true });
  const qboReady = !!qboStatus.data?.connected;
  const xeroReady = !!xeroStatus.data?.connected;

  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 bg-slate-50 p-3 rounded">
        <div>
          <label className="text-xs text-slate-500 block">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}
          className="inline-flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded-lg px-3 py-1.5">
          <RefreshCw size={14} /> Generate journals
        </button>
        <a href={glService.exportCsvUrl({ from, to })} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg px-3 py-1.5">
          <Download size={14} /> Export CSV
        </a>
        <div className="text-sm text-slate-600 ml-auto">Total: <span className="font-semibold">{data?.total ?? 0}</span></div>
      </div>
      {isLoading ? (
        <div className="text-slate-500 text-sm p-4">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-sm p-4 border rounded">No journals in this range. Click <em>Generate journals</em> to create them from AP/AR ledger entries.</div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-3 py-2">Journal #</th>
                <th className="px-3 py-2">Posted</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Currency</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Exported</th>
                <th className="px-3 py-2">External ID</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedId(j.id)}>
                  <td className="px-3 py-2 font-mono">{j.journalNumber}</td>
                  <td className="px-3 py-2">{new Date(j.postedAt).toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-slate-200 text-xs">{j.sourceLedger}</span></td>
                  <td className="px-3 py-2 text-xs">{j.sourceEntryType}</td>
                  <td className="px-3 py-2">{j.currency}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(Number(j.totalAmount), j.currency)}</td>
                  <td className="px-3 py-2 text-xs">{j.exportedAt ? `${j.exportProvider} (${j.exportedAt.slice(0,10)})` : '—'}</td>
                  <td className="px-3 py-2 text-xs font-mono">{j.externalId ?? '—'}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button title={qboReady ? 'Push to QuickBooks' : 'Connect QuickBooks first (simulated push will run otherwise)'}
                        disabled={!!j.externalId || pushMut.isPending} onClick={() => pushMut.mutate({ id: j.id, provider: 'quickbooks' })}
                        className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded px-2 py-0.5 inline-flex items-center gap-1">
                        <Send size={11} /> QB{qboReady ? '' : '*'}
                      </button>
                      <button title={xeroReady ? 'Push to Xero' : 'Connect Xero first (simulated push will run otherwise)'}
                        disabled={!!j.externalId || pushMut.isPending} onClick={() => pushMut.mutate({ id: j.id, provider: 'xero' })}
                        className="text-xs bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white rounded px-2 py-0.5 inline-flex items-center gap-1">
                        <Send size={11} /> Xero{xeroReady ? '' : '*'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedId && <JournalDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function JournalDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: j } = useQuery({ queryKey: ['gl', 'journal', id], queryFn: () => glService.getJournal(id) });
  if (!j) return null;
  const debits = (j.lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
  const credits = (j.lines ?? []).reduce((s, l) => s + Number(l.credit), 0);
  return (
    <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose}>
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Journal {j.journalNumber}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">✕</button>
        </div>
        <div className="text-sm space-y-1 mb-3">
          <div><span className="text-slate-500">Posted:</span> {new Date(j.postedAt).toISOString().slice(0,10)}</div>
          <div><span className="text-slate-500">Source:</span> {j.sourceLedger} / {j.sourceEntryType}</div>
          <div><span className="text-slate-500">Currency:</span> {j.currency}</div>
          {j.description && <div><span className="text-slate-500">Description:</span> {j.description}</div>}
        </div>
        <table className="min-w-full text-sm border rounded">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr><th className="px-2 py-1">Account</th><th className="px-2 py-1 text-right">Debit</th><th className="px-2 py-1 text-right">Credit</th></tr>
          </thead>
          <tbody>
            {(j.lines ?? []).map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-2 py-1">{l.account?.code} — {l.account?.name}</td>
                <td className="px-2 py-1 text-right">{Number(l.debit) > 0 ? formatMoney(Number(l.debit), j.currency) : ''}</td>
                <td className="px-2 py-1 text-right">{Number(l.credit) > 0 ? formatMoney(Number(l.credit), j.currency) : ''}</td>
              </tr>
            ))}
            <tr className="border-t bg-slate-50 font-semibold">
              <td className="px-2 py-1">Totals</td>
              <td className="px-2 py-1 text-right">{formatMoney(debits, j.currency)}</td>
              <td className="px-2 py-1 text-right">{formatMoney(credits, j.currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────── Accounts tab ──────────
function AccountsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => glService.listAccounts() });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', type: 'ASSET' as GlAccountType, description: '' });
  const createMut = useMutation({
    mutationFn: () => glService.createAccount(form),
    onSuccess: () => { setShowForm(false); setForm({ code: '', name: '', type: 'ASSET', description: '' }); qc.invalidateQueries({ queryKey: ['gl', 'accounts'] }); },
    onError: (e: { response?: { data?: { message?: string } } }) => alert(e.response?.data?.message || 'Create failed'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => glService.deleteAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gl', 'accounts'] }),
    onError: (e: { response?: { data?: { message?: string } } }) => alert(e.response?.data?.message || 'Delete failed'),
  });

  const items: GlAccount[] = data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-600">{items.length} accounts</div>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-slate-900 text-white rounded px-3 py-1.5">
          <Plus size={14} /> New account
        </button>
      </div>
      {showForm && (
        <div className="border rounded p-3 bg-slate-50 grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
          <input placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="border rounded px-2 py-1" />
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded px-2 py-1" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as GlAccountType })} className="border rounded px-2 py-1">
            {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.code || !form.name}
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded px-3 py-1">Save</button>
            <button onClick={() => setShowForm(false)} className="bg-slate-200 hover:bg-slate-300 rounded px-3 py-1">Cancel</button>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="text-slate-500 text-sm p-4">Loading…</div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Active</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{a.code}</td>
                  <td className="px-3 py-2">{a.name}</td>
                  <td className="px-3 py-2 text-xs">{a.type}</td>
                  <td className="px-3 py-2">{a.isActive ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => { if (confirm(`Delete account ${a.code}?`)) deleteMut.mutate(a.id); }}
                      className="text-red-600 hover:text-red-800"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ────────── Mappings tab ──────────
function MappingsTab() {
  const qc = useQueryClient();
  const accountsQ = useQuery({ queryKey: ['gl', 'accounts'], queryFn: () => glService.listAccounts() });
  const mapsQ = useQuery({ queryKey: ['gl', 'mappings'], queryFn: () => glService.listMappings() });
  const accounts: GlAccount[] = accountsQ.data?.items ?? [];
  const validEventTypes = mapsQ.data?.validEventTypes ?? [];
  const existing = new Map((mapsQ.data?.items ?? []).map((m) => [m.eventType, m]));
  const [form, setForm] = useState({ eventType: '', debitAccountId: '', creditAccountId: '' });
  const upsertMut = useMutation({
    mutationFn: () => glService.upsertMapping(form),
    onSuccess: () => { setForm({ eventType: '', debitAccountId: '', creditAccountId: '' }); qc.invalidateQueries({ queryKey: ['gl', 'mappings'] }); },
    onError: (e: { response?: { data?: { message?: string } } }) => alert(e.response?.data?.message || 'Save failed'),
  });
  const deleteMut = useMutation({
    mutationFn: (ev: string) => glService.deleteMapping(ev),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gl', 'mappings'] }),
  });
  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-600">Map each ledger event type to a debit and credit account. Required before journal generation.</div>
      <div className="border rounded p-3 bg-slate-50 grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
        <select value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })} className="border rounded px-2 py-1">
          <option value="">— Select event type —</option>
          {validEventTypes.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
        </select>
        <select value={form.debitAccountId} onChange={(e) => setForm({ ...form, debitAccountId: e.target.value })} className="border rounded px-2 py-1">
          <option value="">— Debit account —</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
        <select value={form.creditAccountId} onChange={(e) => setForm({ ...form, creditAccountId: e.target.value })} className="border rounded px-2 py-1">
          <option value="">— Credit account —</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
        <button onClick={() => upsertMut.mutate()} disabled={!form.eventType || !form.debitAccountId || !form.creditAccountId || upsertMut.isPending}
          className="bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded px-3 py-1">Save mapping</button>
      </div>
      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr><th className="px-3 py-2">Event type</th><th className="px-3 py-2">Debit</th><th className="px-3 py-2">Credit</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {validEventTypes.map((ev) => {
              const m = existing.get(ev);
              return (
                <tr key={ev} className="border-t">
                  <td className="px-3 py-2 text-xs font-mono">{ev}</td>
                  <td className="px-3 py-2">{m ? `${m.debitAccount?.code} — ${m.debitAccount?.name}` : <span className="text-amber-600">— unmapped —</span>}</td>
                  <td className="px-3 py-2">{m ? `${m.creditAccount?.code} — ${m.creditAccount?.name}` : <span className="text-amber-600">— unmapped —</span>}</td>
                  <td className="px-3 py-2 text-right">
                    {m && (
                      <button onClick={() => { if (confirm(`Delete mapping for ${ev}?`)) deleteMut.mutate(ev); }} className="text-red-600 hover:text-red-800"><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Suppress unused import lint (GlJournal kept exported for downstream consumers).
export type { GlJournal };

// ────────── v1.7.1 — Integrations strip (Connect / Disconnect cards) ──────────
function IntegrationsStrip() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <IntegrationCard provider="quickbooks" label="QuickBooks Online" color="bg-blue-600" />
      <IntegrationCard provider="xero" label="Xero" color="bg-cyan-600" />
    </div>
  );
}

function IntegrationCard({ provider, label, color }: { provider: IntegrationProvider; label: string; color: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<IntegrationStatus>({
    queryKey: ['integration', provider],
    queryFn: () => integrationsService.getStatus(provider),
    refetchOnWindowFocus: true,
  });
  const disconnectMut = useMutation({
    mutationFn: () => integrationsService.disconnect(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integration', provider] }),
  });
  if (isLoading) return <div className="border rounded p-3 text-xs text-slate-500">Loading {label}…</div>;
  const connected = !!data?.connected;
  const configured = !!data?.configured;
  return (
    <div className="border rounded p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded ${color} text-white flex items-center justify-center`}>
          <Link2 size={16} />
        </div>
        <div>
          <div className="font-medium text-sm">{label}</div>
          <div className="text-xs text-slate-500">
            {connected
              ? `Connected${data?.realmId || data?.tenantId ? ` · ${data.realmId || data.tenantId}` : ''}${data?.expiresAt ? ` · expires ${new Date(data.expiresAt).toLocaleString()}` : ''}`
              : configured ? 'Not connected — click Connect to authorize.' : 'Not configured — set env vars to enable real push.'}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        {connected ? (
          <button onClick={() => { if (confirm(`Disconnect ${label}?`)) disconnectMut.mutate(); }}
            disabled={disconnectMut.isPending}
            className="text-xs border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 rounded px-3 py-1.5 inline-flex items-center gap-1">
            <LogOut size={12} /> Disconnect
          </button>
        ) : (
          <button onClick={() => { window.location.href = integrationsService.connectUrl(provider); }}
            disabled={!configured}
            title={configured ? '' : 'Set CLIENT_ID + CLIENT_SECRET in backend .env to enable'}
            className={`text-xs ${color} hover:opacity-90 disabled:opacity-40 text-white rounded px-3 py-1.5 inline-flex items-center gap-1`}>
            <Link2 size={12} /> Connect
          </button>
        )}
      </div>
    </div>
  );
}

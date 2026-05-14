import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fxService } from '../services';
import { formatNumber } from '../utils/format';

type FxRate = {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string | number;
  effectiveAt: string;
  source: string;
  createdAt: string;
  createdBy?: { id: string; name?: string | null; email: string } | null;
};

export default function FxSettingsPage() {
  const qc = useQueryClient();
  const [filterBase, setFilterBase] = useState('');
  const [filterQuote, setFilterQuote] = useState('');
  const [form, setForm] = useState({
    baseCurrency: 'USD',
    quoteCurrency: 'EGP',
    rate: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    source: 'manual',
  });
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['fx', filterBase, filterQuote],
    queryFn: () => fxService.list({ base: filterBase || undefined, quote: filterQuote || undefined, limit: 200 }),
  });

  const create = useMutation({
    mutationFn: () => fxService.record({
      baseCurrency: form.baseCurrency.toUpperCase(),
      quoteCurrency: form.quoteCurrency.toUpperCase(),
      rate: Number(form.rate),
      effectiveAt: new Date(form.effectiveAt).toISOString(),
      source: form.source || 'manual',
    }),
    onSuccess: () => {
      setOk(`Rate ${form.baseCurrency}/${form.quoteCurrency} saved`);
      setErr('');
      setForm((f) => ({ ...f, rate: '' }));
      qc.invalidateQueries({ queryKey: ['fx'] });
    },
    onError: (e: { response?: { data?: { error?: string; code?: string } } }) => {
      setErr(e?.response?.data?.error || 'Failed to record rate');
      setOk('');
    },
  });

  const rows: FxRate[] = data?.rows ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">FX Rates</h2>
        <p className="text-slate-500 text-sm">Manual exchange-rate registry used for multi-currency reporting and conversions.</p>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-800 mb-4">Record new rate</h3>
        {err && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        {ok && <div className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">{ok}</div>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <label className="flex flex-col text-xs text-slate-600">
            Base
            <input
              type="text"
              maxLength={3}
              value={form.baseCurrency}
              onChange={(e) => setForm({ ...form, baseCurrency: e.target.value.toUpperCase() })}
              className="border border-slate-200 rounded px-2 py-1 mt-1 uppercase"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            Quote
            <input
              type="text"
              maxLength={3}
              value={form.quoteCurrency}
              onChange={(e) => setForm({ ...form, quoteCurrency: e.target.value.toUpperCase() })}
              className="border border-slate-200 rounded px-2 py-1 mt-1 uppercase"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            Rate (1 base = X quote)
            <input
              type="number"
              step="0.0001"
              min="0"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              className="border border-slate-200 rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            Effective date
            <input
              type="date"
              value={form.effectiveAt}
              onChange={(e) => setForm({ ...form, effectiveAt: e.target.value })}
              className="border border-slate-200 rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            Source
            <input
              type="text"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="border border-slate-200 rounded px-2 py-1 mt-1"
            />
          </label>
        </div>
        <div className="mt-4">
          <button
            type="button"
            disabled={!form.rate || create.isPending}
            onClick={() => create.mutate()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {create.isPending ? 'Saving…' : 'Record rate'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-800">Recorded rates</h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Base"
              maxLength={3}
              value={filterBase}
              onChange={(e) => setFilterBase(e.target.value.toUpperCase())}
              className="border border-slate-200 rounded px-2 py-1 text-sm uppercase w-20"
            />
            <input
              type="text"
              placeholder="Quote"
              maxLength={3}
              value={filterQuote}
              onChange={(e) => setFilterQuote(e.target.value.toUpperCase())}
              className="border border-slate-200 rounded px-2 py-1 text-sm uppercase w-20"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2">Pair</th>
                <th className="text-right px-4 py-2">Rate</th>
                <th className="text-left px-4 py-2">Effective</th>
                <th className="text-left px-4 py-2">Source</th>
                <th className="text-left px-4 py-2">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No rates recorded.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{r.baseCurrency}/{r.quoteCurrency}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.rate, { maximumFractionDigits: 6 })}</td>
                    <td className="px-4 py-2">{new Date(r.effectiveAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-slate-500">{r.source}</td>
                    <td className="px-4 py-2 text-slate-500">{r.createdBy?.email || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

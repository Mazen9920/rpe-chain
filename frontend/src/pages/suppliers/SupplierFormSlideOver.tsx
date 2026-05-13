/**
 * SupplierFormSlideOver — create/edit a supplier across grouped sections.
 */
import { useEffect, useState } from 'react';
import { X, Save, Building2 } from 'lucide-react';
import type { Supplier } from '../../types/supplier';
import { APPROVAL_STATUSES, PAYMENT_TERMS, RISK_RATINGS } from './shared';

interface Props {
  open: boolean;
  supplier: Supplier | null;
  onClose: () => void;
  onSubmit: (data: Partial<Supplier>) => Promise<void> | void;
  saving?: boolean;
  error?: string | null;
}

const empty: Partial<Supplier> = {
  code: '',
  name: '',
  legalName: '',
  taxId: '',
  taxRegistered: false,
  currency: 'USD',
  paymentTerms: 'NET30',
  incoterms: '',
  leadTimeDays: 7,
  primaryContact: '',
  email: '',
  phone: '',
  website: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  bankName: '',
  bankAccountNumber: '',
  iban: '',
  swift: '',
  riskRating: null,
  approvalStatus: 'DRAFT',
  notes: '',
};

export default function SupplierFormSlideOver({ open, supplier, onClose, onSubmit, saving, error }: Props) {
  const [form, setForm] = useState<Partial<Supplier>>(empty);

  useEffect(() => {
    setForm(supplier ? { ...empty, ...supplier } : empty);
  }, [supplier, open]);

  if (!open) return null;

  const set = <K extends keyof Supplier>(k: K, v: Supplier[K] | null) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Partial<Supplier> = { ...form };
    // Drop empty strings so backend doesn't store them.
    for (const k of Object.keys(payload) as (keyof Supplier)[]) {
      if (payload[k] === '') (payload as Record<string, unknown>)[k as string] = null;
    }
    await onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-slate-900/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-slate-500" />
            <h3 className="text-lg font-bold text-slate-800">{supplier ? 'Edit supplier' : 'New supplier'}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <Section title="Basics">
            <Field label="Code *">
              <input required value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} className={inp} />
            </Field>
            <Field label="Name *">
              <input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} className={inp} />
            </Field>
            <Field label="Legal name">
              <input value={form.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} className={inp} />
            </Field>
            <Field label="Tax ID">
              <input value={form.taxId ?? ''} onChange={(e) => set('taxId', e.target.value)} className={inp} />
            </Field>
            <Field label="Tax registered">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.taxRegistered} onChange={(e) => set('taxRegistered', e.target.checked)} />
                Yes
              </label>
            </Field>
            <Field label="Approval status">
              <select value={form.approvalStatus ?? 'DRAFT'} onChange={(e) => set('approvalStatus', e.target.value as Supplier['approvalStatus'])} className={inp}>
                {APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Risk rating">
              <select value={form.riskRating ?? ''} onChange={(e) => set('riskRating', (e.target.value || null) as Supplier['riskRating'])} className={inp}>
                <option value="">—</option>
                {RISK_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </Section>

          <Section title="Terms">
            <Field label="Currency">
              <input value={form.currency ?? ''} onChange={(e) => set('currency', e.target.value)} className={inp} placeholder="USD" />
            </Field>
            <Field label="Payment terms">
              <select value={form.paymentTerms ?? 'NET30'} onChange={(e) => set('paymentTerms', e.target.value as Supplier['paymentTerms'])} className={inp}>
                {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Incoterms">
              <input value={form.incoterms ?? ''} onChange={(e) => set('incoterms', e.target.value)} className={inp} placeholder="EXW · FOB · DDP" />
            </Field>
            <Field label="Lead time (days)">
              <input type="number" min={0} value={form.leadTimeDays ?? 0} onChange={(e) => set('leadTimeDays', Number(e.target.value))} className={inp} />
            </Field>
          </Section>

          <Section title="Primary contact (legacy)">
            <Field label="Contact name">
              <input value={form.primaryContact ?? ''} onChange={(e) => set('primaryContact', e.target.value)} className={inp} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} className={inp} />
            </Field>
            <Field label="Phone">
              <input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} className={inp} />
            </Field>
            <Field label="Website">
              <input value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} className={inp} placeholder="https://" />
            </Field>
          </Section>

          <Section title="Address">
            <Field label="Line 1" full>
              <input value={form.addressLine1 ?? ''} onChange={(e) => set('addressLine1', e.target.value)} className={inp} />
            </Field>
            <Field label="Line 2" full>
              <input value={form.addressLine2 ?? ''} onChange={(e) => set('addressLine2', e.target.value)} className={inp} />
            </Field>
            <Field label="City">
              <input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} className={inp} />
            </Field>
            <Field label="State / Region">
              <input value={form.state ?? ''} onChange={(e) => set('state', e.target.value)} className={inp} />
            </Field>
            <Field label="Postal code">
              <input value={form.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} className={inp} />
            </Field>
            <Field label="Country (ISO-2)">
              <input value={form.country ?? ''} onChange={(e) => set('country', e.target.value.toUpperCase())} maxLength={2} className={inp} />
            </Field>
          </Section>

          <Section title="Banking">
            <Field label="Bank name">
              <input value={form.bankName ?? ''} onChange={(e) => set('bankName', e.target.value)} className={inp} />
            </Field>
            <Field label="Account number">
              <input value={form.bankAccountNumber ?? ''} onChange={(e) => set('bankAccountNumber', e.target.value)} className={inp} />
            </Field>
            <Field label="IBAN">
              <input value={form.iban ?? ''} onChange={(e) => set('iban', e.target.value)} className={inp} />
            </Field>
            <Field label="SWIFT / BIC">
              <input value={form.swift ?? ''} onChange={(e) => set('swift', e.target.value)} className={inp} />
            </Field>
          </Section>

          <Section title="Notes">
            <Field label="Internal notes" full>
              <textarea rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} className={inp} />
            </Field>
          </Section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60">
            <Save size={14} /> {saving ? 'Saving…' : supplier ? 'Save changes' : 'Create supplier'}
          </button>
        </footer>
      </form>
    </div>
  );
}

const inp = 'mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{title}</legend>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`text-xs font-medium text-slate-600 ${full ? 'md:col-span-2' : ''}`}>
      {label}
      {children}
    </label>
  );
}

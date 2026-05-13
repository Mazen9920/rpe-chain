import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Trash2, Upload, FileText, X } from 'lucide-react';
import api from '../../lib/api';

type Cert = {
  id: string;
  type: string;
  number: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  documentKey: string | null;
  notes: string | null;
};

const CERT_TYPES = ['NIOSH', 'EN149', 'EN14683', 'CE', 'FDA', 'ASTM', 'ISO', 'OTHER'];

function expiryBadge(expiresAt?: string | null) {
  if (!expiresAt) return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">No expiry</span>;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Expired</span>;
  if (days <= 30) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">{days}d</span>;
  if (days <= 90) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">{days}d</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{days}d</span>;
}

export default function CertificationsModal({ productId, productName, onClose }: { productId: string; productName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);

  const { data: certs = [], isLoading } = useQuery<Cert[]>({
    queryKey: ['products', productId, 'certifications'],
    queryFn: () => api.get(`/products/${productId}/certifications`).then((r) => r.data),
  });

  const [local, setLocal] = useState<Cert[] | null>(null);
  const items = local ?? certs;

  const saveMutation = useMutation({
    mutationFn: (next: Cert[]) => api.put(`/products/${productId}/certifications`, { items: next }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products', productId, 'certifications'] });
      setLocal(null);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ certId, file }: { certId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(`/products/${productId}/certifications/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      return { certId, key: res.data.key as string };
    },
    onSuccess: ({ certId, key }) => {
      setLocal((prev) => (prev ?? certs).map((c) => (c.id === certId ? { ...c, documentKey: key } : c)));
    },
  });

  function addRow() {
    const next: Cert = { id: crypto.randomUUID(), type: 'OTHER', number: '', issuedAt: null, expiresAt: null, documentKey: null, notes: null };
    setLocal([...(local ?? certs), next]);
  }
  function update(id: string, patch: Partial<Cert>) {
    setLocal((local ?? certs).map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function remove(id: string) {
    setLocal((local ?? certs).filter((c) => c.id !== id));
  }
  function pickFile(certId: string) {
    setPendingUploadId(certId);
    fileInputRef.current?.click();
  }
  async function viewDoc(certId: string) {
    const res = await api.get(`/products/${productId}/certifications/${certId}/document-url`);
    window.open(res.data.url, '_blank');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-blue-600" />
            <h3 className="font-semibold text-slate-800">Certifications — {productName}</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {isLoading ? <div className="py-8 text-center text-sm text-slate-500">Loading…</div> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Issued</th>
                  <th className="px-2 py-2">Expires</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Document</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((c) => (
                  <tr key={c.id}>
                    <td className="px-2 py-2">
                      <select value={c.type} onChange={(e) => update(c.id, { type: e.target.value })} className="rounded border border-slate-200 px-2 py-1 text-sm">
                        {CERT_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input value={c.number ?? ''} onChange={(e) => update(c.id, { number: e.target.value })} placeholder="Cert #" className="w-32 rounded border border-slate-200 px-2 py-1 text-sm" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="date" value={c.issuedAt ? c.issuedAt.slice(0, 10) : ''} onChange={(e) => update(c.id, { issuedAt: e.target.value || null })} className="rounded border border-slate-200 px-2 py-1 text-sm" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="date" value={c.expiresAt ? c.expiresAt.slice(0, 10) : ''} onChange={(e) => update(c.id, { expiresAt: e.target.value || null })} className="rounded border border-slate-200 px-2 py-1 text-sm" />
                    </td>
                    <td className="px-2 py-2">{expiryBadge(c.expiresAt)}</td>
                    <td className="px-2 py-2">
                      {c.documentKey ? (
                        <button onClick={() => viewDoc(c.id)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          <FileText size={13} /> View PDF
                        </button>
                      ) : (
                        <button onClick={() => pickFile(c.id)} disabled={uploadMutation.isPending} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                          <Upload size={13} /> {uploadMutation.isPending && pendingUploadId === c.id ? 'Uploading…' : 'Upload'}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => remove(c.id)} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-500">No certifications. Click "Add row" to start.</td></tr>
                ) : null}
              </tbody>
            </table>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && pendingUploadId) uploadMutation.mutate({ certId: pendingUploadId, file });
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <button onClick={addRow} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            <Plus size={14} /> Add row
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button
              disabled={saveMutation.isPending || local === null}
              onClick={() => saveMutation.mutate(items)}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:bg-slate-400"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

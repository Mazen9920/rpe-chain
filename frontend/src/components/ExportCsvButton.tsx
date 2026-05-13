/**
 * ExportCsvButton — generic "Export CSV" button that calls inventoryService.downloadCsv.
 */
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { inventoryService } from '../services';

interface Props {
  path: string;
  params?: Record<string, unknown>;
  filename: string;
  label?: string;
}

export default function ExportCsvButton({ path, params = {}, filename, label = 'Export CSV' }: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try { await inventoryService.downloadCsv(path, params, filename); } finally { setBusy(false); }
      }}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      {label}
    </button>
  );
}

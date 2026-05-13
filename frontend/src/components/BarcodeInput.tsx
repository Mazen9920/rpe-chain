/**
 * BarcodeInput — shared scanner-style input.
 * Submits on Enter (or when a hardware barcode scanner fires its carriage-return).
 * Calls onResolve with the typed lookup result from /api/inventory/lookup.
 * Shows inline loading, success, and error states.
 */
import { useRef, useState } from 'react';
import { Barcode, Loader2, X } from 'lucide-react';
import { inventoryService } from '../services';

export type LookupResult = {
  type: 'BIN' | 'PRODUCT' | 'LOT';
  entity: Record<string, unknown>;
};

interface BarcodeInputProps {
  placeholder?: string;
  onResolve: (result: LookupResult) => void;
  className?: string;
}

export default function BarcodeInput({ placeholder = 'Scan or type SKU / barcode / lot…', onResolve, className = '' }: BarcodeInputProps) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lookup = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await inventoryService.lookup(trimmed);
      setResult(res);
      onResolve(res);
      setValue('');
    } catch (err: unknown) {
      const msg =
        typeof err === 'object' && err && 'response' in err
          ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Not found')
          : 'Lookup failed';
      setError(msg);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const clear = () => {
    setValue('');
    setResult(null);
    setError(null);
    inputRef.current?.focus();
  };

  const typeLabel: Record<string, string> = { BIN: 'Bin', PRODUCT: 'Product', LOT: 'Lot' };

  const resultLabel = result
    ? `${typeLabel[result.type] ?? result.type}: ${
        result.type === 'BIN'
          ? `${result.entity.code}`
          : result.type === 'PRODUCT'
          ? `${result.entity.sku} · ${result.entity.name}`
          : `${result.entity.lotNumber}`
      }`
    : null;

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:border-blue-500">
        {loading ? (
          <Loader2 size={15} className="shrink-0 animate-spin text-slate-400" />
        ) : (
          <Barcode size={15} className="shrink-0 text-slate-400" />
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); setResult(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(value); } }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          autoComplete="off"
          spellCheck={false}
        />
        {(value || result || error) ? (
          <button type="button" onClick={clear} className="shrink-0 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        ) : null}
      </div>
      {resultLabel ? (
        <p className="flex items-center gap-1 text-xs text-green-700">
          <span className="rounded bg-green-100 px-1.5 py-0.5 font-medium">{result?.type}</span>
          {resultLabel}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <p className="text-xs text-slate-400">Press Enter to look up — resolves bin barcode, product SKU/GTIN, or lot number.</p>
    </div>
  );
}

// Central money/number/percent formatters. Use these instead of ad-hoc Intl.NumberFormat calls.

export function formatMoney(amount: number | string | null | undefined, currency: string = 'USD', opts: Intl.NumberFormatOptions = {}): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return '—';
  const cc = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cc,
      maximumFractionDigits: 2,
      ...opts,
    }).format(n);
  } catch {
    // Fallback for invalid currency code
    return `${n.toFixed(2)} ${cc}`;
  }
}

export function formatNumber(value: number | string | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, ...opts }).format(n);
}

export function formatPercent(value: number | string | null | undefined, fractionDigits = 1): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(fractionDigits)}%`;
}

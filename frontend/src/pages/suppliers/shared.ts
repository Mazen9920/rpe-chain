/**
 * Shared atoms used across supplier pages: status badges, risk pills, helpers.
 */
import type { SupplierApprovalStatus, RiskRating } from '../../types/supplier';

export const APPROVAL_STATUSES: SupplierApprovalStatus[] = [
  'DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PREFERRED', 'BLOCKED',
];

export const RISK_RATINGS: RiskRating[] = ['LOW', 'MEDIUM', 'HIGH'];

export const PAYMENT_TERMS = ['NET15', 'NET30', 'NET45', 'NET60', 'NET90', 'COD', 'PREPAID'] as const;

export const DOC_CATEGORIES = [
  'CONTRACT', 'NDA', 'ISO_CERT', 'INSURANCE', 'TAX_CERT', 'BANK_LETTER', 'OTHER',
] as const;

export function approvalBadge(status: SupplierApprovalStatus | null | undefined) {
  switch (status) {
    case 'PREFERRED':    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'APPROVED':     return 'bg-green-100 text-green-700 border-green-200';
    case 'UNDER_REVIEW': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'BLOCKED':      return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'DRAFT':
    default:             return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

export function riskBadge(risk: RiskRating | null | undefined) {
  switch (risk) {
    case 'LOW':    return 'bg-emerald-50 text-emerald-700';
    case 'MEDIUM': return 'bg-amber-50 text-amber-700';
    case 'HIGH':   return 'bg-rose-50 text-rose-700';
    default:       return 'bg-slate-50 text-slate-500';
  }
}

export function fmtBytes(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(); } catch { return '—'; }
}

export function fmtPct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

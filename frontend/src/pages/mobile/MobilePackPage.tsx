/**
 * MobilePackPage — touch-first pack confirmation.
 *
 * Pack endpoint is order-level (no per-line qty), so the page shows the picked
 * lines and asks the user to confirm/scan each as a packed verification step
 * before pressing "Confirm pack" which POSTs /sales-orders/:id/pack.
 */
import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, CameraOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { salesOrderService, inventoryService } from '../../services';
import type { SalesOrderLine } from '../../types/fulfillment';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import BarcodeInput, { type LookupResult } from '../../components/BarcodeInput';

export default function MobilePackPage() {
  const { soId } = useParams<{ soId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const soQ = useQuery({
    queryKey: ['so', soId],
    queryFn: () => salesOrderService.getById(soId!),
    enabled: !!soId,
  });

  const lines = useMemo(() => soQ.data?.lines ?? [], [soQ.data]);

  const showFlash = (kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    window.setTimeout(() => setFlash(null), 1800);
  };

  const handleResolve = (res: LookupResult) => {
    if (res.type !== 'PRODUCT') {
      showFlash('err', `Scanned a ${res.type.toLowerCase()} — expected a product`);
      return;
    }
    const productId = (res.entity as { id?: string }).id;
    const line = lines.find((l: SalesOrderLine) => l.productId === productId);
    if (!line) {
      showFlash('err', 'Product not on this order');
      return;
    }
    setVerified((v) => ({ ...v, [line.id]: true }));
    showFlash('ok', `${line.product?.sku ?? 'Line'} verified`);
  };

  const onDecode = async (text: string) => {
    try {
      const res = await inventoryService.lookup(text.trim());
      handleResolve(res);
    } catch {
      showFlash('err', `Unknown barcode: ${text}`);
    }
  };
  const scanner = useBarcodeScanner({ onDecode });

  const submit = useMutation({
    mutationFn: () => salesOrderService.pack(soId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['so', soId] });
      qc.invalidateQueries({ queryKey: ['mobile-wl'] });
      navigate('/m', { replace: true });
    },
  });

  if (soQ.isLoading) return <p className="p-4 text-slate-500">Loading…</p>;
  if (!soQ.data) return <p className="p-4 text-red-600">Order not found</p>;

  const so = soQ.data;
  const canPack = so.status === 'PICKED';
  const totalLines = lines.length;
  const verifiedCount = lines.filter((l) => verified[l.id]).length;

  return (
    <div className="space-y-4 p-3 pb-32">
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <p className="text-xs text-slate-500">Pack · {so.status}</p>
        <p className="text-base font-semibold text-slate-900">{so.orderNumber}</p>
        <p className="text-xs text-slate-600">{so.customerName}</p>
      </div>

      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-700">
            Verify ({verifiedCount}/{totalLines})
          </p>
          <button
            type="button"
            onClick={() => (scanner.scanning ? scanner.stop() : scanner.start())}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${
              scanner.scanning ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {scanner.scanning ? <CameraOff size={13} /> : <Camera size={13} />}
            {scanner.scanning ? 'Stop' : 'Camera'}
          </button>
        </div>
        {scanner.scanning ? (
          <video
            ref={scanner.videoRef}
            className="mb-2 aspect-video w-full rounded-lg bg-black object-cover"
            playsInline
            muted
          />
        ) : null}
        {scanner.error ? <p className="mb-2 text-xs text-red-600">{scanner.error}</p> : null}
        <BarcodeInput placeholder="Scan to verify product" onResolve={handleResolve} />
        {flash ? (
          <p
            className={`mt-2 flex items-center gap-1 text-xs ${
              flash.kind === 'ok' ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {flash.kind === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {flash.msg}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        {lines.map((l) => {
          const ok = !!verified[l.id];
          return (
            <div
              key={l.id}
              className={`flex items-center justify-between rounded-xl border bg-white p-3 shadow-sm ${
                ok ? 'border-green-300 bg-green-50' : 'border-slate-200'
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {l.product?.sku ?? l.productId} · {l.product?.name ?? ''}
                </p>
                <p className="text-xs text-slate-500">Picked {l.qtyPicked}</p>
              </div>
              <button
                type="button"
                onClick={() => setVerified((v) => ({ ...v, [l.id]: !v[l.id] }))}
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  ok ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'
                }`}
                aria-label={ok ? 'Unverify' : 'Verify'}
              >
                <CheckCircle2 size={18} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3">
        <button
          type="button"
          disabled={!canPack || submit.isPending}
          onClick={() => submit.mutate()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
        >
          {submit.isPending ? 'Submitting…' : 'Confirm pack'}
        </button>
        {submit.isError ? (
          <p className="mt-2 text-xs text-red-600">
            {(submit.error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              'Pack failed'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

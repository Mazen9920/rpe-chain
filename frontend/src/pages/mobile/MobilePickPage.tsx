/**
 * MobilePickPage — touch-first picking screen.
 *
 * Loads the SO + lines, lets the warehouse user scan a barcode (camera or
 * hardware) which looks up the entity via /inventory/lookup. When the result
 * is a PRODUCT and matches a line in the SO, qtyPicked increments locally.
 * Long-press (or "Edit") on a line allows manual entry.
 *
 * "Confirm pick" POSTs linePicks to /sales-orders/:id/pick.
 */
import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, CameraOff, CheckCircle2, AlertTriangle, Minus, Plus } from 'lucide-react';
import { salesOrderService, inventoryService } from '../../services';
import type { PickPayload, SalesOrderLine } from '../../types/fulfillment';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import BarcodeInput, { type LookupResult } from '../../components/BarcodeInput';

export default function MobilePickPage() {
  const { soId } = useParams<{ soId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const soQ = useQuery({
    queryKey: ['so', soId],
    queryFn: () => salesOrderService.getById(soId!),
    enabled: !!soId,
  });

  const lines = useMemo(() => soQ.data?.lines ?? [], [soQ.data]);

  // Initialize picks once lines load.
  useMemo(() => {
    if (lines.length && Object.keys(picks).length === 0) {
      const init: Record<string, number> = {};
      for (const l of lines) init[l.id] = l.qtyPicked > 0 ? l.qtyPicked : l.qtyAllocated;
      setPicks(init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

  const showFlash = (kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    window.setTimeout(() => setFlash(null), 1800);
  };

  // Handle a successful barcode resolve.
  const handleResolve = (res: LookupResult) => {
    if (res.type !== 'PRODUCT') {
      showFlash('err', `Scanned a ${res.type.toLowerCase()} — expected a product`);
      return;
    }
    const productId = (res.entity as { id?: string }).id;
    if (!productId) {
      showFlash('err', 'No product id in lookup result');
      return;
    }
    const line = lines.find((l: SalesOrderLine) => l.productId === productId);
    if (!line) {
      showFlash('err', 'Product not on this order');
      return;
    }
    setPicks((prev) => {
      const next = (prev[line.id] ?? 0) + 1;
      const capped = Math.min(next, line.qtyAllocated);
      if (capped < next) showFlash('err', 'Already at allocated qty');
      else showFlash('ok', `${line.product?.sku ?? 'Line'} → ${capped}`);
      return { ...prev, [line.id]: capped };
    });
  };

  // Camera barcode scanner.
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
    mutationFn: () => {
      const payload: PickPayload = {
        linePicks: lines.map((l) => ({ lineId: l.id, qtyPicked: picks[l.id] ?? 0 })),
      };
      return salesOrderService.pick(soId!, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['so', soId] });
      qc.invalidateQueries({ queryKey: ['mobile-wl'] });
      navigate('/m', { replace: true });
    },
  });

  if (soQ.isLoading) return <p className="p-4 text-slate-500">Loading…</p>;
  if (!soQ.data) return <p className="p-4 text-red-600">Order not found</p>;

  const so = soQ.data;
  const canPick = so.status === 'ALLOCATED';
  const totalQty = lines.reduce((a, l) => a + (picks[l.id] ?? 0), 0);

  return (
    <div className="space-y-4 p-3 pb-32">
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <p className="text-xs text-slate-500">Pick · {so.status}</p>
        <p className="text-base font-semibold text-slate-900">{so.orderNumber}</p>
        <p className="text-xs text-slate-600">{so.customerName}</p>
      </div>

      {/* Scanner */}
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-700">Scan</p>
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
        {scanner.error ? (
          <p className="mb-2 text-xs text-red-600">{scanner.error}</p>
        ) : null}
        <BarcodeInput placeholder="Scan SKU / barcode / GTIN" onResolve={handleResolve} />
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

      {/* Lines */}
      <div className="space-y-2">
        {lines.map((l) => {
          const pick = picks[l.id] ?? 0;
          const done = pick >= l.qtyAllocated && l.qtyAllocated > 0;
          return (
            <div
              key={l.id}
              className={`rounded-xl border bg-white p-3 shadow-sm ${
                done ? 'border-green-300 bg-green-50' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {l.product?.sku ?? l.productId} · {l.product?.name ?? ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    Ordered {l.qty} · Allocated {l.qtyAllocated}
                  </p>
                </div>
                {done ? <CheckCircle2 size={18} className="text-green-600" /> : null}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPicks((p) => ({ ...p, [l.id]: Math.max(0, (p[l.id] ?? 0) - 1) }))}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700"
                  aria-label="Decrement"
                >
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  value={pick}
                  onChange={(e) =>
                    setPicks((p) => ({
                      ...p,
                      [l.id]: Math.max(0, Math.min(l.qtyAllocated, parseInt(e.target.value || '0', 10))),
                    }))
                  }
                  className="h-10 w-16 rounded-lg border border-slate-200 text-center text-base font-semibold"
                />
                <button
                  type="button"
                  onClick={() =>
                    setPicks((p) => ({ ...p, [l.id]: Math.min(l.qtyAllocated, (p[l.id] ?? 0) + 1) }))
                  }
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700"
                  aria-label="Increment"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky submit */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3">
        <button
          type="button"
          disabled={!canPick || submit.isPending}
          onClick={() => submit.mutate()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
        >
          {submit.isPending ? 'Submitting…' : `Confirm pick (${totalQty})`}
        </button>
        {submit.isError ? (
          <p className="mt-2 text-xs text-red-600">
            {(submit.error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              'Pick failed'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

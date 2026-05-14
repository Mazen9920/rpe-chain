/**
 * MobileWorklistPage — touch-first list of sales orders ready to pick or pack.
 * Buckets by status: ALLOCATED (pick), PICKED (pack).
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Package, Truck } from 'lucide-react';
import { salesOrderService } from '../../services';
import type { SalesOrder } from '../../types/fulfillment';

function SoCard({ so, to, icon: Icon, color }: { so: SalesOrder; to: string; icon: typeof Package; color: string }) {
  const lineCount = so.lines?.length ?? 0;
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm active:scale-[0.99]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${color}`}>
            <Icon size={15} />
          </span>
          <span className="truncate text-sm font-semibold text-slate-900">{so.orderNumber}</span>
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">{so.customerName}</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium text-slate-700">{lineCount} lines</p>
        <p className="text-[11px] text-slate-400">{so.status}</p>
      </div>
    </Link>
  );
}

export default function MobileWorklistPage() {
  const allocatedQ = useQuery({
    queryKey: ['mobile-wl', 'ALLOCATED'],
    queryFn: () => salesOrderService.list({ status: 'ALLOCATED', limit: 50 }),
  });
  const pickedQ = useQuery({
    queryKey: ['mobile-wl', 'PICKED'],
    queryFn: () => salesOrderService.list({ status: 'PICKED', limit: 50 }),
  });

  const pickList = allocatedQ.data?.items ?? [];
  const packList = pickedQ.data?.items ?? [];

  return (
    <div className="p-4 space-y-6">
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Package size={15} /> Ready to pick
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{pickList.length}</span>
        </h2>
        <div className="space-y-2">
          {allocatedQ.isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : pickList.length === 0 ? (
            <p className="rounded-xl bg-white p-4 text-sm text-slate-500">No orders ready to pick.</p>
          ) : (
            pickList.map((so) => (
              <SoCard
                key={so.id}
                so={so}
                to={`/m/pick/${so.id}`}
                icon={Package}
                color="bg-amber-100 text-amber-700"
              />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Truck size={15} /> Ready to pack
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">{packList.length}</span>
        </h2>
        <div className="space-y-2">
          {pickedQ.isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : packList.length === 0 ? (
            <p className="rounded-xl bg-white p-4 text-sm text-slate-500">No orders ready to pack.</p>
          ) : (
            packList.map((so) => (
              <SoCard
                key={so.id}
                so={so}
                to={`/m/pack/${so.id}`}
                icon={Truck}
                color="bg-blue-100 text-blue-700"
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Package, AlertTriangle, Users, ShoppingCart, Truck, Bell, Layers } from 'lucide-react';
import { dashboardService } from '../services';

function StatCard({
  title,
  value,
  icon: Icon,
  color = 'blue',
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color?: 'blue' | 'orange' | 'green' | 'purple';
}) {
  const palette = {
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-slate-500">{title}</span>
        <div className={`p-2 rounded-lg ${palette[color]}`}>
          <Icon size={17} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardService.summary });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Dashboard</h2>
        <p className="text-slate-500 text-sm">RPE Chain Supply OS overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 animate-pulse h-24" />
          ))
        ) : (
          <>
            <StatCard
              title="Inventory Value (FIFO)"
              value={`$${Number(data?.inventoryValuation ?? 0).toLocaleString()}`}
              icon={TrendingUp}
              color="green"
            />
            <StatCard title="Active Cost Layers" value={data?.activeCostLayers ?? 0} icon={Layers} color="purple" />
            <StatCard title="Total Products" value={data?.totalProducts ?? 0} icon={Package} />
            <StatCard title="Low Stock Alerts" value={data?.lowStockProducts ?? 0} icon={AlertTriangle} color="orange" />
            <StatCard title="Active Suppliers" value={data?.totalSuppliers ?? 0} icon={Users} />
            <StatCard title="Pending POs" value={data?.pendingPOs ?? 0} icon={ShoppingCart} />
            <StatCard title="Active Shipments" value={data?.activeShipments ?? 0} icon={Truck} />
            <StatCard title="Open Alerts" value={data?.openAlerts ?? 0} icon={Bell} color="orange" />
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Recent Stock Movements</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                {['Product', 'Warehouse', 'Direction', 'Qty', 'Reason', 'Date'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.recentMovements?.map((m: {
                id: string; product?: { name: string }; warehouse?: { code: string };
                direction: string; qty: number; reasonCode: string; createdAt: string;
              }) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{m.product?.name}</td>
                  <td className="px-5 py-3 text-slate-600">{m.warehouse?.code}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.direction === 'IN' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {m.direction}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{m.qty}</td>
                  <td className="px-5 py-3 text-slate-600">{m.reasonCode}</td>
                  <td className="px-5 py-3 text-slate-500">{new Date(m.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

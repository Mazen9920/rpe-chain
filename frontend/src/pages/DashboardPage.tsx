import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Package, AlertTriangle, Users, ShoppingCart, Truck, Bell, Layers, Activity } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Link } from 'react-router-dom';
import { dashboardService, eventsService } from '../services';

function StatCard({
  title,
  value,
  icon: Icon,
  color = 'blue',
  to,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color?: 'blue' | 'orange' | 'green' | 'purple' | 'red';
  to?: string;
}) {
  const palette = {
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
  };
  const inner = (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-slate-500">{title}</span>
        <div className={`p-2 rounded-lg ${palette[color]}`}>
          <Icon size={17} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function ChartCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      <div className="p-4" style={{ height: 280 }}>{children}</div>
    </div>
  );
}

type SalesTrendRow = { date: string; revenue: number; orderCount: number };
type InvTrendRow = { date: string; inQty: number; outQty: number; netQty: number };
type AlertsTrendRow = { date: string; CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number; total: number };
type MarginTrendRow = { date: string; revenue: number; profit: number; marginPct: number | null };
type EventRow = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  actor?: { email?: string; role?: string } | null;
  payload?: Record<string, unknown> | null;
};

const fmtDay = (s: string) => s.slice(5);
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function DashboardPage() {
  const { data: summary, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardService.summary });
  const { data: salesTrend } = useQuery<{ series: SalesTrendRow[] }>({
    queryKey: ['dashboard', 'sales-trend'],
    queryFn: () => dashboardService.salesTrend(30),
  });
  const { data: invTrend } = useQuery<{ series: InvTrendRow[] }>({
    queryKey: ['dashboard', 'inventory-trend'],
    queryFn: () => dashboardService.inventoryTrend(30),
  });
  const { data: alertsTrend } = useQuery<{ series: AlertsTrendRow[] }>({
    queryKey: ['dashboard', 'alerts-trend'],
    queryFn: () => dashboardService.alertsTrend(30),
  });
  const { data: marginTrend } = useQuery<{ series: MarginTrendRow[] }>({
    queryKey: ['dashboard', 'margin-trend'],
    queryFn: () => dashboardService.marginTrend(30),
  });
  const { data: feed } = useQuery<{ events: EventRow[] }>({
    queryKey: ['dashboard', 'events'],
    queryFn: () => eventsService.list({ limit: 20 }),
    refetchInterval: 30_000,
  });

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
            <StatCard title="Inventory Value (FIFO)" value={`$${Number(summary?.inventoryValuation ?? 0).toLocaleString()}`} icon={TrendingUp} color="green" />
            <StatCard title="Active Cost Layers" value={summary?.activeCostLayers ?? 0} icon={Layers} color="purple" />
            <StatCard title="Total Products" value={summary?.totalProducts ?? 0} icon={Package} to="/inventory" />
            <StatCard title="Low Stock" value={summary?.lowStockProducts ?? 0} icon={AlertTriangle} color="orange" to="/inventory" />
            <StatCard title="Active Suppliers" value={summary?.totalSuppliers ?? 0} icon={Users} to="/suppliers" />
            <StatCard title="Pending POs" value={summary?.pendingPOs ?? 0} icon={ShoppingCart} to="/orders" />
            <StatCard title="Active Shipments" value={summary?.activeShipments ?? 0} icon={Truck} to="/shipments" />
            <StatCard title="Open Alerts" value={summary?.openAlerts ?? 0} icon={Bell} color="red" to="/alerts" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ChartCard title="Sales — last 30 days" action={<Link to="/reports" className="text-xs text-blue-600 hover:underline">Reports →</Link>}>
          <ResponsiveContainer>
            <AreaChart data={salesTrend?.series || []}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tickFormatter={fmtDay} fontSize={11} />
              <YAxis tickFormatter={fmtMoney} fontSize={11} width={70} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(l) => l} />
              <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Stock movements — last 30 days">
          <ResponsiveContainer>
            <BarChart data={invTrend?.series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tickFormatter={fmtDay} fontSize={11} />
              <YAxis fontSize={11} width={50} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="inQty" name="IN" fill="#10b981" />
              <Bar dataKey="outQty" name="OUT" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 mb-4">
        <ChartCard title="Realized margin — last 30 days" action={<Link to="/reports" className="text-xs text-blue-600 hover:underline">Margin erosion →</Link>}>
          <ResponsiveContainer>
            <LineChart data={marginTrend?.series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tickFormatter={fmtDay} fontSize={11} />
              <YAxis fontSize={11} width={50} tickFormatter={(v) => `${v}%`} domain={['auto', 'auto']} />
              <Tooltip formatter={(v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)} />
              <Line type="monotone" dataKey="marginPct" name="Margin %" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartCard title="Alerts — last 30 days" action={<Link to="/alerts" className="text-xs text-blue-600 hover:underline">View alerts →</Link>}>
            <ResponsiveContainer>
              <LineChart data={alertsTrend?.series || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={fmtDay} fontSize={11} />
                <YAxis fontSize={11} width={40} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="CRITICAL" stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="HIGH" stroke="#ea580c" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="MEDIUM" stroke="#ca8a04" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="LOW" stroke="#65a30d" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Activity size={16} /> Activity Feed</h3>
            <span className="text-xs text-slate-400">auto-refresh 30s</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
            {(!feed?.events || feed.events.length === 0) ? (
              <div className="p-5 text-sm text-slate-500">No recent activity.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {feed.events.slice(0, 20).map((e) => (
                  <li key={e.id} className="px-5 py-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-blue-700">{e.eventType}</span>
                      <span className="text-xs text-slate-400">{new Date(e.occurredAt).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-slate-600">
                      <span className="font-medium">{e.entityType}</span>
                      {e.actor?.email ? <span className="text-slate-400"> · {e.actor.email}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

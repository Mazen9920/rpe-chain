import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Package, Users, ShoppingCart, Truck, Factory, LogOut, PackageCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import AlertsBell from './AlertsBell';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Package, label: 'Inventory' },
  { to: '/manufacturing', icon: Factory, label: 'Manufacturing' },
  { to: '/suppliers', icon: Users, label: 'Suppliers' },
  { to: '/orders', icon: ShoppingCart, label: 'Purchase Orders' },
  { to: '/goods-receipts', icon: PackageCheck, label: 'Goods Receipts' },
  { to: '/shipments', icon: Truck, label: 'Shipments' },
];

export default function Layout() {
  const { user, logout } = useAuthStore();

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-60 bg-slate-800 text-white flex flex-col shrink-0">
        <div className="p-5 border-b border-slate-700">
          <h1 className="text-lg font-bold">RPE Chain</h1>
          <p className="text-xs text-slate-400 mt-0.5">Supply OS</p>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <p className="text-xs font-medium text-slate-300">{user?.name}</p>
          <p className="text-xs text-slate-500 mb-3">{user?.role}</p>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-xs transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="flex items-center justify-end border-b border-slate-200 bg-white px-6 py-2">
          <AlertsBell />
        </div>
        <Outlet />
      </main>
    </div>
  );
}

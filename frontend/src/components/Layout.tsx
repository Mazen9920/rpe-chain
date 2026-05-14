import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Package, Users, ShoppingCart, Truck, Factory, LogOut, PackageCheck, Receipt, UserCheck, ClipboardList, Bell, BarChart3, Mail, DollarSign, Menu, X, Smartphone, BookOpen } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import AlertsBell from './AlertsBell';
import api from '../lib/api';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Package, label: 'Inventory' },
  { to: '/manufacturing', icon: Factory, label: 'Manufacturing' },
  { to: '/suppliers', icon: Users, label: 'Suppliers' },
  { to: '/orders', icon: ShoppingCart, label: 'Purchase Orders' },
  { to: '/goods-receipts', icon: PackageCheck, label: 'Goods Receipts' },
  { to: '/ap', icon: Receipt, label: 'Accounts Payable' },
  { to: '/customers', icon: UserCheck, label: 'Customers' },
  { to: '/sales-orders', icon: ClipboardList, label: 'Sales Orders' },
  { to: '/shipments', icon: Truck, label: 'Shipments' },
  { to: '/ar', icon: Receipt, label: 'Accounts Receivable' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/notifications', icon: Mail, label: 'Notifications' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
  { to: '/settings/fx', icon: DollarSign, label: 'FX Rates' },
  { to: '/m', icon: Smartphone, label: 'Mobile Pick/Pack' },
  { to: '/gl-export', icon: BookOpen, label: 'GL Export' },
];

export default function Layout() {
  const { user, logout, refreshToken } = useAuthStore();
  const [navOpen, setNavOpen] = useState(false);

  async function handleSignOut() {
    try {
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } catch {
      // best-effort; clear local state regardless
    } finally {
      logout();
    }
  }

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-slate-800 text-white">
      <div className="flex items-center justify-between border-b border-slate-700 p-5">
        <div>
          <h1 className="text-lg font-bold">RPE Chain</h1>
          <p className="text-xs text-slate-400 mt-0.5">Supply OS</p>
        </div>
        <button
          type="button"
          className="md:hidden text-slate-300 hover:text-white"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setNavOpen(false)}
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
          onClick={handleSignOut}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-xs transition-colors"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">{sidebar}</div>

      {/* Mobile drawer */}
      {navOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">{sidebar}</div>
        </>
      ) : null}

      <main className="flex-1 overflow-auto">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:px-6">
          <button
            type="button"
            className="md:hidden text-slate-700 hover:text-slate-900"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>
          <div className="md:hidden text-sm font-semibold text-slate-800">RPE Chain</div>
          <AlertsBell />
        </div>
        <Outlet />
      </main>
    </div>
  );
}


/**
 * MobileLayout — minimal full-screen shell for mobile pick/pack pages.
 * Renders an outlet inside a flex container with a top bar containing a
 * back button (history.back) and sign-out. Skips the desktop sidebar.
 */
import { Outlet, useNavigate } from 'react-router-dom';
import { ChevronLeft, LogOut, Smartphone } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import api from '../lib/api';

export default function MobileLayout() {
  const navigate = useNavigate();
  const { user, logout, refreshToken } = useAuthStore();

  async function handleSignOut() {
    try {
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } catch {
      // ignore
    } finally {
      logout();
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
          aria-label="Back"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Smartphone size={16} /> Mobile Pick/Pack
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-slate-500 sm:inline">{user?.name}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

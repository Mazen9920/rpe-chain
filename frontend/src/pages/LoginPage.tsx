import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import api from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mfaToken) {
        const { data } = await api.post('/auth/login/mfa', { mfaToken, code });
        setAuth(data.token, data.user, data.refreshToken);
        navigate('/');
        return;
      }
      const { data } = await api.post('/auth/login', { email, password });
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        return;
      }
      setAuth(data.token, data.user, data.refreshToken);
      navigate('/');
    } catch (e: unknown) {
      const ex = e as { response?: { status?: number; data?: { error?: string } } };
      if (ex.response?.status === 423) setError('Account locked. Try again later or contact admin.');
      else setError(ex.response?.data?.error || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-slate-800">RPE Chain</h1>
        <p className="text-slate-500 text-sm mt-1 mb-6">
          {mfaToken ? 'Enter your authenticator code' : 'Supply OS · Sign in to continue'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!mfaToken && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="admin@rpechain.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                  required
                />
              </div>
            </>
          )}
          {mfaToken && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="123456"
                required
              />
            </div>
          )}
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : mfaToken ? 'Verify' : 'Sign in'}
          </button>
          {mfaToken && (
            <button
              type="button"
              onClick={() => { setMfaToken(null); setCode(''); setError(''); }}
              className="w-full text-xs text-slate-500 hover:text-slate-700"
            >
              Back to login
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

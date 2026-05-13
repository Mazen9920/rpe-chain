import { Component, ReactNode } from 'react';
import { Sentry } from '../lib/sentry';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Report to Sentry if initialized; otherwise console.
    try {
      Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white border border-rose-200 rounded-xl shadow-sm p-6 max-w-lg w-full">
          <h1 className="text-lg font-bold text-rose-700 mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-600 mb-4">
            An unexpected error occurred. The team has been notified.
          </p>
          <pre className="bg-slate-100 text-xs text-slate-700 p-3 rounded overflow-auto max-h-40 mb-4">
            {this.state.error?.message ?? 'Unknown error'}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.assign('/')}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

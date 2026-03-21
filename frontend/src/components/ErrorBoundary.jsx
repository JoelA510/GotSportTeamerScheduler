import React from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';
import Button from './ui/Button.jsx';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-bg-app flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-bg-surface/50 backdrop-blur-xl border border-border-subtle rounded-3xl p-8 text-center shadow-2xl">
            <div className="w-20 h-20 bg-status-error-bg rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ShieldAlert className="text-status-error" size={40} />
            </div>
            <h1 className="text-2xl font-display font-bold text-text-primary mb-2">
              Something went wrong
            </h1>
            <p className="text-text-muted mb-8 text-sm leading-relaxed">
              The application encountered an unexpected error.
            </p>
            <button
              onClick={() => window.location.href = '/'}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg shadow-brand-glow"
            >
              Return Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

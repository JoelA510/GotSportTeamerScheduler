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
        <div className="min-h-screen flex items-center justify-center bg-bg-app p-4">
          <div className="max-w-md w-full glass-panel text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-status-error/5 backdrop-blur-3xl z-0 pointer-events-none" />
            <div className="relative z-10 flex flex-col items-center">
              <ShieldAlert size={64} className="text-status-error mb-6" />
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Something went wrong
              </h2>
              <p className="text-text-secondary mb-8">
                The application encountered an unexpected error. Please try refreshing the page or returning home.
              </p>
              <div className="flex gap-4">
                <Button 
                  variant="secondary" 
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2"
                >
                  <RotateCcw size={18} /> Refresh
                </Button>
                <Button 
                  variant="primary" 
                  onClick={() => window.location.href = '/'}
                >
                  Return Home
                </Button>
              </div>
              {process.env.NODE_ENV === 'development' && (
                <pre className="mt-8 text-xs text-left p-4 bg-black/20 rounded-lg overflow-auto max-w-full text-status-error/80">
                  {this.state.error?.toString()}
                </pre>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

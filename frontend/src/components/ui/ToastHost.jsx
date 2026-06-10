import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle2, Info, AlertTriangle } from 'lucide-react';

const ToastContext = createContext(null);

/**
 * `const toast = useToast(); toast('Saved', 'success');`
 * Requires <ToastHost> mounted near the app root.
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastHost');
  }
  return context;
}

const ICONS = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
};

const TOAST_TTL_MS = 3200;

/**
 * Bottom-center toast stack. Styles from `.toast*` in styles/chrome.css.
 */
export default function ToastHost({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const pushToast = useCallback((message, tone = 'success') => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const value = useMemo(() => pushToast, [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map(({ id, message, tone }) => {
          const Icon = ICONS[tone] || Info;
          return (
            <div key={id} className={`toast ${tone}`} role="status">
              <span className="t-ico">
                <Icon size={15} aria-hidden="true" />
              </span>
              {message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

ToastHost.propTypes = {
  children: PropTypes.node,
};

import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission.js';
import LoadingScreen from './LoadingScreen.jsx';

const ProtectedRoute = ({ requiredPermission, children }) => {
  const { can, role } = usePermission();
  const location = useLocation();
  const [showWarning, setShowWarning] = useState(false);
  const [redirect, setRedirect] = useState(false);

  useEffect(() => {
    // If the user's role is loaded but they don't have permission
    if (role !== undefined && !can(requiredPermission)) {
      setShowWarning(true);
      // CRITICAL FIX: Delay redirect so the E2E test can assert the warning banner
      const timer = setTimeout(() => {
        setRedirect(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [role, can, requiredPermission]);

  // Still loading organization member data
  if (role === undefined) {
    return <LoadingScreen />;
  }

  if (!can(requiredPermission)) {
    if (redirect) {
      return <Navigate to="/" state={{ from: location }} replace />;
    }
    return (
      <div className="flex flex-col items-center justify-center p-8 m-4 bg-status-error-bg border border-status-error/30 rounded-lg shadow-sm">
        <h2 className="text-2xl font-bold text-status-error mb-2">Unauthorized access</h2>
        <p className="text-text-secondary mb-4">
          You do not have permission to view this page. Redirecting...
        </p>
      </div>
    );
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;
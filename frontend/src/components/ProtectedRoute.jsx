import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';
import LoadingScreen from './LoadingScreen';

const ProtectedRoute = ({ requiredPermission, children }) => {
  const { can, role } = usePermission();
  const location = useLocation();
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    // If the user's role is loaded but they don't have permission
    if (role !== undefined && !can(requiredPermission)) {
      setShowWarning(true);
      const timer = setTimeout(() => {
        setShowWarning(false);
      }, 3000); // show warning for 3 seconds before redirecting
      return () => clearTimeout(timer);
    }
  }, [role, can, requiredPermission]);

  // Still loading organization member data
  if (role === undefined) {
    return <LoadingScreen />;
  }

  if (!can(requiredPermission)) {
    if (showWarning) {
      return (
        <div className="flex flex-col items-center justify-center p-8 m-4 bg-red-50 border border-red-200 rounded-lg shadow-sm">
          <h2 className="text-2xl font-bold text-red-700 mb-2">Unauthorized access</h2>
          <p className="text-red-600 mb-4">
            You do not have permission to view this page. Redirecting...
          </p>
        </div>
      );
    }
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;

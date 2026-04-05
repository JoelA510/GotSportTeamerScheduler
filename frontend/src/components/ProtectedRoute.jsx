import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission.js';
import LoadingScreen from './LoadingScreen.jsx';

/**
 * Phase 2 Security Fix (H-3): Removed 3-second delay before redirect.
 * Unauthorized users are now redirected immediately — no protected content
 * is rendered. The "Unauthorized access" flash is eliminated entirely.
 *
 * Defense-in-depth: Even if this component were bypassed, RLS policies
 * enforce data access at the database level.
 */
const ProtectedRoute = ({ requiredPermission, children }) => {
  const { can, role } = usePermission();
  const location = useLocation();

  // Still loading organization member data
  if (role === undefined) {
    return <LoadingScreen />;
  }

  // Immediate redirect — no delay, no warning, no race condition
  if (!can(requiredPermission)) {
    return <Navigate to="/" state={{ from: location, error: 'Unauthorized access' }} replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;

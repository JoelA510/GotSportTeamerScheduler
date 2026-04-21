import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import LoadingScreen from './LoadingScreen.jsx';
import OrganizationFetchError from './OrganizationFetchError.jsx';

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
  const { loading: orgLoading, fetchError, refetchOrgs } = useOrganization();
  const location = useLocation();

  // If the org fetch errored, show the diagnostic instead of hanging on a
  // LoadingScreen the user can't distinguish from the auth loader.
  if (fetchError && !orgLoading) {
    return <OrganizationFetchError error={fetchError} onRetry={refetchOrgs} />;
  }

  // Still loading organization member data
  if (role === undefined) {
    return <LoadingScreen message="Loading your organization..." />;
  }

  // Immediate redirect — no delay, no warning, no race condition
  if (!can(requiredPermission)) {
    return <Navigate to="/" state={{ from: location, error: 'Unauthorized access' }} replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;

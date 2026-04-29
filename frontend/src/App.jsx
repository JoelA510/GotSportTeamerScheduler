import { Suspense, lazy } from 'react';
import './App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Auth
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ImportProvider } from './contexts/ImportContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { OrganizationProvider, useOrganization } from './contexts/OrganizationContext.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import OrganizationFetchError from './components/OrganizationFetchError.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { PERMISSIONS } from './constants/permissions.js';

// Layouts
import DashboardLayout from './layouts/DashboardLayout.jsx';

// Lazy load pages
const Login = lazy(() => import('./components/Login.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const TeamAnalysisPage = lazy(() => import('./pages/TeamAnalysisPage.jsx'));
const FieldManagementPage = lazy(() => import('./pages/FieldManagementPage.jsx'));
const PracticeSchedulingPage = lazy(() => import('./pages/PracticeSchedulingPage.jsx'));
const GameSchedulingPage = lazy(() => import('./pages/GameSchedulingPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const TeamPortalPage = lazy(() => import('./pages/TeamPortalPage.jsx'));
const RegistrationFlow = lazy(() => import('./pages/RegistrationFlow.jsx'));
const AdminComplianceDashboard = lazy(() => import('./pages/AdminComplianceDashboard.jsx'));
const RegistrationForms = lazy(() => import('./pages/RegistrationForms.jsx'));
const EnterpriseDashboard = lazy(() => import('./pages/EnterpriseDashboard.jsx'));
const LeagueStandings = lazy(() => import('./pages/LeagueStandings.jsx'));
const SetupWizard = lazy(() => import('./pages/SetupWizard.jsx'));
const ThemeToggle = lazy(() => import('./components/ThemeToggle.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage.jsx'));
const AnalyticalDashboard = lazy(() => import('./pages/AnalyticalDashboard.jsx'));
const OrganizationCreation = lazy(() => import('./pages/OrganizationCreation.jsx'));
const InvitePage = lazy(() => import('./pages/InvitePage.jsx'));
import ShadowBanner from './components/auth/ShadowBanner.jsx';
import OfflineGuard from './components/OfflineGuard.jsx';

function AppContent() {
  const { session, loading } = useAuth();
  const {
    currentOrganization,
    permissions,
    organizations,
    loading: orgLoading,
    fetchError: orgFetchError,
    refetchOrgs,
  } = useOrganization();

  if (loading) {
    return <LoadingScreen />;
  }

  // /invite/:code is reachable regardless of session or org state. The page
  // itself handles each auth/org combination (unauthenticated → stash + bounce
  // to Login; authenticated → redeem immediately).
  const isInvitePath = window.location.pathname.startsWith('/invite/');
  if (isInvitePath) {
    return (
      <Suspense fallback={<LoadingScreen message="Validating invite..." />}>
        <Routes>
          <Route path="/invite/:code" element={<InvitePage />} />
        </Routes>
      </Suspense>
    );
  }

  if (!session && window.location.pathname !== '/auth/reset-password') {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Login />
      </Suspense>
    );
  }

  // The initial organization fetch errored out (typical cause: stale RLS
  // policy returning 500, or network hiccup). Surface a diagnostic instead
  // of either (a) hanging on LoadingScreen forever or (b) pushing the user
  // back to OrganizationCreation as if they had no orgs.
  if (orgFetchError && !orgLoading) {
    return <OrganizationFetchError error={orgFetchError} onRetry={refetchOrgs} />;
  }

  const hasNoOrgs = !orgLoading && organizations.length === 0;

  const isOnboarded = currentOrganization?.is_onboarded;
  const isTenantAdmin = permissions.includes(PERMISSIONS.MANAGE_GLOBAL_SETTINGS);

  return (
    <Suspense fallback={<LoadingScreen />}>
      <ShadowBanner />
      <Routes>
        <Route path="/auth/reset-password" element={<ResetPassword />} />
        <Route path="/organizations/new" element={<OrganizationCreation />} />
        <Route
          path="/setup"
          element={
            <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_GLOBAL_SETTINGS}>
              <SetupWizard />
            </ProtectedRoute>
          }
        />
        <Route
          element={
            hasNoOrgs ? (
              <Navigate to="/organizations/new" replace />
            ) : !isOnboarded && isTenantAdmin ? (
              <Navigate to="/setup" replace />
            ) : (
              <DashboardLayout activeSection="dashboard" />
            )
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/register/:formId" element={<RegistrationFlow />} />
          <Route
            path="/import"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ORGANIZATION}>
                <ImportPage />
              </ProtectedRoute>
            }
          />
          <Route path="/teams" element={<TeamAnalysisPage />} />
          <Route
            path="/fields"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_SCHEDULE}>
                <FieldManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/compliance"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ORGANIZATION}>
                <AdminComplianceDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/forms"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ORGANIZATION}>
                <RegistrationForms />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/audit-logs"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_GLOBAL_SETTINGS}>
                <AuditLogPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/analytics"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ORGANIZATION}>
                <AnalyticalDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ORGANIZATION}>
                <EnterpriseDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/schedule/practice" element={<PracticeSchedulingPage />} />
          <Route path="/schedule/game" element={<GameSchedulingPage />} />
          <Route
            path="/settings"
            element={
              <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ORGANIZATION}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/team/:teamId" element={<TeamPortalPage />} />
          <Route path="/standings" element={<LeagueStandings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ThemeToggle />
    </Suspense>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OrganizationProvider>
          <ImportProvider>
            <ThemeProvider>
              <ErrorBoundary>
                <OfflineGuard>
                  <AppContent />
                </OfflineGuard>
              </ErrorBoundary>
            </ThemeProvider>
          </ImportProvider>
        </OrganizationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

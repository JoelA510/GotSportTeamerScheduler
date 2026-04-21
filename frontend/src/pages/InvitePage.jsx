import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { Ticket, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import LoadingScreen from '../components/LoadingScreen.jsx';
import Button from '../components/ui/Button.jsx';
import { writePendingInvite, clearPendingInvite } from '../lib/inviteStorage.js';

/**
 * /invite/:code deep-link.
 *
 * States:
 *   - Auth context still loading → LoadingScreen
 *   - Unauthenticated → stash the code in sessionStorage + redirect to /
 *     where the Login screen renders. Login picks up the stash after signup.
 *   - Authenticated, no orgs yet → auto-call redeem RPC.
 *   - Authenticated + already in this org → show "already a member" card.
 *   - Error from redeem → show error card with a Retry button.
 */
export default function InvitePage() {
  const { code } = useParams();
  const { session, loading: authLoading } = useAuth();

  const [state, setState] = useState({ status: 'idle', error: null, orgId: null });

  useEffect(() => {
    if (authLoading) return;

    if (!session) {
      // Unauthenticated — stash the code and bounce to the login landing.
      if (code) writePendingInvite(code);
      return;
    }

    // Authenticated. Redeem once on mount.
    let cancelled = false;
    setState({ status: 'redeeming', error: null, orgId: null });

    (async () => {
      try {
        const { data, error } = await supabase.rpc('redeem_org_invite', { p_code: code });
        if (error) throw error;
        if (cancelled) return;
        clearPendingInvite();
        // Success state triggers a hard redirect below, which refreshes
        // OrganizationContext so routing picks up the new membership.
        setState({ status: 'success', error: null, orgId: data });
      } catch (err) {
        logger.error('Invite redeem failed', err);
        if (cancelled) return;
        setState({ status: 'error', error: err, orgId: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session, code]);

  if (authLoading) return <LoadingScreen message="Validating invite..." />;

  // Unauthenticated — let AppContent's Login branch handle it. Storing a
  // flag on window lets Login display a "you'll auto-join after sign-up"
  // banner without another storage read.
  if (!session) return <Navigate to="/" replace />;

  if (state.status === 'redeeming' || state.status === 'idle') {
    return <LoadingScreen message="Joining organization..." />;
  }

  if (state.status === 'success') {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-6 animate-fadeIn">
        <div className="max-w-md w-full glass-panel-premium p-10 text-center space-y-6">
          <div className="w-20 h-20 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto animate-bounce">
            <CheckCircle size={48} />
          </div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">You&apos;re in!</h2>
          <p className="text-text-muted text-sm">Loading your dashboard...</p>
          <RedirectAfterShortPause to="/?joined=true" ms={1200} />
        </div>
      </div>
    );
  }

  // error
  const msg = state.error?.message || 'Could not redeem this invite code.';
  return (
    <div className="min-h-screen bg-bg-main flex items-center justify-center p-6 animate-fadeIn">
      <div className="max-w-md w-full glass-panel-premium p-10 space-y-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-red-500/10 text-red-400 rounded-2xl shrink-0">
            <AlertCircle size={24} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-text-primary tracking-tight">
              Invite could not be redeemed
            </h2>
            <p className="text-sm text-text-muted leading-relaxed break-words">{msg}</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button
            variant="primary"
            onClick={() => (window.location.href = '/')}
            className="flex items-center gap-2"
          >
            <Ticket size={16} /> Back to onboarding
          </Button>
        </div>
      </div>
    </div>
  );
}

function RedirectAfterShortPause({ to, ms = 1200 }) {
  useEffect(() => {
    const t = setTimeout(() => {
      window.location.href = to;
    }, ms);
    return () => clearTimeout(t);
  }, [to, ms]);
  return null;
}

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * @typedef {Object} AuthContextValue
 * @property {any} session
 * @property {any} user
 * @property {boolean} loading
 * @property {() => Promise<any>} signOut
 * @property {(email: string) => Promise<{error: any}>} resetPasswordForEmail
 * @property {(password: string) => Promise<{error: any}>} updatePassword
 * @property {boolean} isConfigured
 * @property {boolean} isAdmin
 * @property {boolean} isCoach
 * @property {any} impersonatedUser
 * @property {boolean} isImpersonating
 * @property {(targetProfile: any) => Promise<void>} impersonateUser
 * @property {() => Promise<void>} stopImpersonation
 */

/** @type {React.Context<AuthContextValue>} */
const AuthContext = createContext({});

/** @returns {AuthContextValue} */
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [impersonatedUser, setImpersonatedUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Safety timeout — if onAuthStateChange never fires (network issues,
    // misconfigured client, etc.), stop blocking the UI after 5 seconds.
    const safetyTimer = setTimeout(() => {
      if (loading) {
        console.warn(
          '[Auth] Safety timeout — onAuthStateChange did not fire within 5 s. Clearing loading state.'
        );
        setLoading(false);
      }
    }, 5000);

    // Listen for changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      clearTimeout(safetyTimer);
      setSession(session);

      if (session?.user) {
        // Fetch profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        // Merge profile data into user object for convenience, or keep separate
        // Here we keep user object as is, but could add specific profile logic
        setUser({ ...session.user, profile });
      } else {
        setUser(null);
      }

      setLoading(false);
    });

    return () => {
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [loading]);

  const resetPasswordForEmail = async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
      return { error: null };
    } catch (err) {
      console.error('[Auth] Reset password request failed:', err);
      return { error: err };
    }
  };

  const updatePassword = async (newPassword) => {
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { password_length: newPassword.length },
      });
      if (error) throw error;

      // Log the password update
      if (data.user) {
        // We need organization_id for audit log. Fetch if not in user profile yet.
        const orgId =
          user?.profile?.organization_id ||
          (
            await supabase
              .from('organization_members')
              .select('organization_id')
              .eq('profile_id', data.user.id)
              .single()
          ).data?.organization_id;

        if (orgId) {
          await supabase.rpc('record_audit_event', {
            p_organization_id: orgId,
            p_action: 'auth.password_updated',
            p_metadata: {
              user_id: data.user.id,
              ...(impersonatedUser && {
                impersonated_by: user.id,
                admin_email: user.email,
              }),
            },
          });
        }
      }

      return { error: null };
    } catch (err) {
      console.error('[Auth] Password update failed:', err);
      return { error: err };
    }
  };

  const impersonateUser = async (targetProfile) => {
    if (user?.profile?.role !== 'admin') {
      throw new Error('Unauthorized: Only admins can impersonate users.');
    }

    try {
      // Log impersonation start
      await supabase.rpc('record_audit_event', {
        p_organization_id: targetProfile.organization_id || user.profile.organization_id,
        p_action: 'impersonation.started',
        p_metadata: {
          target_user_id: targetProfile.id,
          impersonated_by: user.id,
          admin_email: user.email,
        },
      });

      setImpersonatedUser(targetProfile);
    } catch (err) {
      console.error('[Auth] Impersonation failed:', err);
      throw err;
    }
  };

  const stopImpersonation = async () => {
    if (!impersonatedUser) return;

    try {
      // Log impersonation end
      await supabase.rpc('record_audit_event', {
        p_organization_id: impersonatedUser.organization_id || user.profile.organization_id,
        p_action: 'impersonation.ended',
        p_metadata: {
          target_user_id: impersonatedUser.id,
          impersonated_by: user.id,
          admin_email: user.email,
        },
      });

      setImpersonatedUser(null);
    } catch (err) {
      console.error('[Auth] Stop impersonation failed:', err);
      throw err;
    }
  };

  const value = {
    session,
    user: impersonatedUser ? { ...user, profile: impersonatedUser } : user,
    loading,
    signOut: () => supabase?.auth.signOut(),
    resetPasswordForEmail,
    updatePassword,
    impersonateUser,
    stopImpersonation,
    impersonatedUser,
    isImpersonating: !!impersonatedUser,
    isConfigured: !!supabase,
    isAdmin: user?.profile?.role === 'admin',
    isCoach: user?.profile?.role === 'coach',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

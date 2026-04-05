import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * @typedef {Object} AuthContextValue
 * @property {any} session
 * @property {any} user
 * @property {boolean} loading
 * @property {() => Promise<any>} signOut
 * @property {boolean} isConfigured
 * @property {boolean} isAdmin
 * @property {boolean} isCoach
 */

/** @type {React.Context<AuthContextValue>} */
const AuthContext = createContext({});

/** @returns {AuthContextValue} */
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
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
  }, []);

  const value = {
    session,
    user,
    loading,
    signOut: () => supabase?.auth.signOut(),
    isConfigured: !!supabase,
    isAdmin: session?.user?.app_metadata?.role === 'admin',
    isCoach: session?.user?.app_metadata?.role === 'coach',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

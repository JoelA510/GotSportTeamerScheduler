import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from './AuthContext.jsx';
import { ROLE_PERMISSIONS } from '../constants/permissions.js';

/**
 * @typedef {Object} OrganizationContextValue
 * @property {any[]} organizations
 * @property {any} currentOrganization
 * @property {any} orgMember
 * @property {any[]} availableSeasons - season_settings rows for the current org
 * @property {any} currentSeasonSetting - the active season_settings row
 * @property {boolean} loading
 * @property {function} switchOrganization
 * @property {function} switchSeason
 * @property {string[]} [permissions]
 */

/** @type {React.Context<OrganizationContextValue>} */
const OrganizationContext = createContext({});

/** @returns {OrganizationContextValue} */
export const useOrganization = () => useContext(OrganizationContext);

export const OrganizationProvider = ({ children }) => {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [currentOrganization, setCurrentOrganization] = useState(null);
  const [orgMember, setOrgMember] = useState(null);
  const [availableSeasons, setAvailableSeasons] = useState([]);
  const [currentSeasonSetting, setCurrentSeasonSetting] = useState(null);
  const [loading, setLoading] = useState(false);

  // Fetch season_settings for a given organization
  const fetchSeasonsForOrg = useCallback(async (orgId) => {
    try {
      const { data, error } = await supabase
        .from('season_settings')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setAvailableSeasons(data || []);

      // Check if the previously stored season belongs to this org
      const storedSeason = localStorage.getItem('squadlogic-current-season');
      const matchStored = (data || []).find(
        (s) => s.id === storedSeason || s.name === storedSeason
      );

      if (matchStored) {
        setCurrentSeasonSetting(matchStored);
      } else if (data && data.length > 0) {
        // Fall back to the most recent season for this org
        setCurrentSeasonSetting(data[0]);
        localStorage.setItem('squadlogic-current-season', data[0].name || data[0].id);
      } else {
        setCurrentSeasonSetting(null);
      }
    } catch (err) {
      console.error('Error fetching season_settings:', err);
      setAvailableSeasons([]);
      setCurrentSeasonSetting(null);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setOrganizations([]);
      setCurrentOrganization(null);
      setOrgMember(null);
      setAvailableSeasons([]);
      setCurrentSeasonSetting(null);
      return;
    }

    const fetchOrgs = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('organization_members')
          .select('*, organizations(*)')
          .eq('profile_id', user.id);

        if (error) throw error;

        if (data && data.length > 0) {
          setOrganizations(data);

          // Phase 3.4 (M-1): Validate localStorage org against actual memberships.
          // Defense-in-depth: even if someone edits localStorage, they can only
          // switch to orgs they're actually a member of. RLS is the real gate.
          const storedOrgId = localStorage.getItem('squadlogic_active_org');
          const validOrgIds = data.map(m => m.organization_id);
          const matchedMember = storedOrgId && validOrgIds.includes(storedOrgId)
            ? data.find(m => m.organization_id === storedOrgId)
            : null;

          if (matchedMember) {
            setCurrentOrganization(matchedMember.organizations);
            setOrgMember({ role: matchedMember.role, ...matchedMember });
            await fetchSeasonsForOrg(matchedMember.organization_id);
          } else {
            // Stored org was invalid or absent — fall back to first membership
            const first = data[0];
            setCurrentOrganization(first.organizations);
            setOrgMember({ role: first.role, ...first });
            localStorage.setItem('squadlogic_active_org', first.organization_id);
            await fetchSeasonsForOrg(first.organization_id);
          }
        }
      } catch (err) {
        console.error('Error fetching organizations:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrgs();
  }, [user, fetchSeasonsForOrg]);

  const switchOrganization = useCallback(async (orgId) => {
    const match = organizations.find((m) => m.organization_id === orgId);
    if (match) {
      setCurrentOrganization(match.organizations);
      setOrgMember({ role: match.role, ...match });
      localStorage.setItem('squadlogic_active_org', orgId);
      // Re-fetch seasons for the new org and validate currentSeason
      await fetchSeasonsForOrg(orgId);
    }
  }, [organizations, fetchSeasonsForOrg]);

  const switchSeason = useCallback((seasonSetting) => {
    setCurrentSeasonSetting(seasonSetting);
    localStorage.setItem(
      'squadlogic-current-season',
      seasonSetting?.name || seasonSetting?.id || ''
    );
  }, []);

  const value = {
    organizations,
    currentOrganization,
    orgMember,
    availableSeasons,
    currentSeasonSetting,
    loading,
    switchOrganization,
    switchSeason,
    permissions: orgMember?.role ? (ROLE_PERMISSIONS[orgMember.role] || []) : [],
  };

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
};


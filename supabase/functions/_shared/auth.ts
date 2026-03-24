/**
 * Shared authentication and authorization utilities for Edge Functions.
 * Phase 1 Security Remediation (C-1): Ensures every Edge Function validates
 * organization membership before performing data operations.
 */

import {
  createClient,
  type SupabaseClient,
  type User,
} from 'https://esm.sh/@supabase/supabase-js@2.45.3';

/**
 * Extract and validate user from the Authorization header.
 * Uses the service-role client ONLY for auth.getUser() — never for data queries.
 */
export async function getUserFromRequest(
  request: Request,
  serviceClient: SupabaseClient
): Promise<User | null> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length)
    : null;

  if (!token) {
    return null;
  }

  const { data, error } = await serviceClient.auth.getUser(token);

  if (error) {
    console.error('Failed to retrieve user from access token', error.message ?? error);
    return null;
  }

  return data?.user ?? null;
}

/**
 * Verify that a user is a member of a specific organization.
 * Uses the service-role client to bypass RLS on organization_members
 * (since we're checking membership itself, not accessing org data).
 */
export async function verifyOrgMembership(
  serviceClient: SupabaseClient,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('organization_members')
    .select('profile_id')
    .eq('profile_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    console.error('Org membership check failed:', error.message);
    return false;
  }

  return data !== null;
}

/**
 * Get all organization IDs a user belongs to.
 */
export async function getUserOrgIds(
  serviceClient: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await serviceClient
    .from('organization_members')
    .select('organization_id')
    .eq('profile_id', userId);

  if (error) {
    console.error('Failed to fetch user org memberships:', error.message);
    return [];
  }

  return (data ?? []).map((row: { organization_id: string }) => row.organization_id);
}

/**
 * For persistence endpoints: resolve the organization_id of entities being modified.
 * Looks up the org from the first entity in the batch via its team or division chain.
 */
export async function resolveOrgFromTeamIds(
  serviceClient: SupabaseClient,
  teamIds: string[]
): Promise<string | null> {
  if (teamIds.length === 0) return null;

  const { data, error } = await serviceClient
    .from('teams')
    .select('organization_id')
    .in('id', teamIds)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error('Failed to resolve org from team IDs:', error?.message);
    return null;
  }

  return data.organization_id;
}

/**
 * Standard CORS headers for Edge Functions.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * JSON response helper.
 */
export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

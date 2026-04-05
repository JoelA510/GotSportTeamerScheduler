/**
 * Team Persistence Edge Function
 * Self-contained handler — all logic inlined for Deno Edge runtime compatibility.
 * Security: org membership validation (C-1), rate limiting (M-4), payload validation.
 */
import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import {
  getUserFromRequest,
  getUserOrgIds,
  recordAudit,
  corsHeaders,
  jsonResponse,
} from '../_shared/auth.ts';
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts';

// ── Inlined constants & config ──────────────────────────────────────────────
const DEFAULT_ALLOWED_ROLES = ['authenticated', 'service_role', 'admin', 'scheduler'];

function parseAllowedRolesEnv(
  value: string | undefined | null,
  { fallbackRoles = DEFAULT_ALLOWED_ROLES } = {}
): string[] {
  let roles: string[];
  if (value === undefined || value === null) {
    roles = fallbackRoles;
  } else {
    roles = value.split(',');
  }
  const normalized = roles.map((r) => r.trim().toLowerCase()).filter((r) => r.length > 0);
  if (normalized.length === 0) throw new Error('at least one allowed role is required');
  return normalized;
}

// ── Payload schema (Zod) ────────────────────────────────────────────────────
const PersistencePayloadSchema = z.object({
  snapshot: z.object({
    payload: z.object({
      teamRows: z.array(z.object({ id: z.string() }).passthrough()),
      teamPlayerRows: z.array(
        z.object({ team_id: z.string(), player_id: z.string() }).passthrough()
      ),
    }),
    lastRunId: z.string().nullish(),
    runId: z.string().nullish(),
  }),
  overrides: z.array(z.unknown()).optional(),
  runMetadata: z.record(z.unknown()).optional(),
});

// ── Inlined persistence logic ───────────────────────────────────────────────

function evaluateOverrides(overrides: unknown[] = []): { pending: number } {
  return {
    pending: overrides.reduce((count: number, entry: unknown) => {
      if (!entry || typeof entry !== 'object') return count;
      const status =
        (typeof (entry as Record<string, unknown>).status === 'string' &&
          ((entry as Record<string, unknown>).status as string).trim().toLowerCase()) ||
        'pending';
      return status === 'pending' ? count + 1 : count;
    }, 0),
  };
}

interface RunMetadata {
  runId?: string;
  seasonSettingsId?: string;
  parameters?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  results?: Record<string, unknown>;
  createdBy?: string;
  startedAt?: string;
  completedAt?: string;
}

async function persistTeamSnapshot(
  supabaseClient: SupabaseClient,
  snapshot: {
    payload: { teamRows: Record<string, unknown>[]; teamPlayerRows: Record<string, unknown>[] };
    lastRunId?: string | null;
    runId?: string | null;
  },
  runMetadata: RunMetadata = {},
  now: Date = new Date()
) {
  const { teamRows, teamPlayerRows } = snapshot.payload;
  const effectiveRunId = runMetadata.runId ?? snapshot.lastRunId ?? snapshot.runId;

  const runData = effectiveRunId
    ? {
        id: effectiveRunId,
        run_type: 'team',
        season_settings_id: runMetadata.seasonSettingsId,
        status: 'completed',
        parameters: runMetadata.parameters ?? {},
        metrics: runMetadata.metrics ?? {},
        results: runMetadata.results ?? {},
        created_by: runMetadata.createdBy ?? 'system',
        started_at: runMetadata.startedAt ?? now.toISOString(),
        completed_at: runMetadata.completedAt ?? now.toISOString(),
        updated_at: now.toISOString(),
      }
    : {
        run_type: 'team',
        status: 'completed',
        updated_at: now.toISOString(),
      };

  const { data, error } = await supabaseClient.rpc('persist_team_schedule', {
    run_data: runData,
    teams: teamRows,
    team_players: teamPlayerRows,
  });

  if (error) throw error;

  return {
    status: 'success',
    runId: effectiveRunId ?? data ?? null,
    message: 'Persistence successful.',
    syncedAt: now.toISOString(),
    updatedTeams: teamRows.length,
    updatedPlayers: teamPlayerRows.length,
  };
}

// ── Handler setup ───────────────────────────────────────────────────────────

type HttpHandler = (request: Request) => Response | Promise<Response>;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const allowedRoles = parseAllowedRolesEnv(Deno.env.get('TEAM_PERSISTENCE_ALLOWED_ROLES'));

let handler: HttpHandler;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for team persistence function.');
  handler = () =>
    jsonResponse({ status: 'error', message: 'Supabase service configuration is missing.' }, 500);
} else {
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { fetch },
    auth: { persistSession: false },
  });

  handler = async (req: Request) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return jsonResponse({ status: 'error', message: 'Method not allowed' }, 405);
    }

    // 1. Authenticate user
    const user = await getUserFromRequest(req, serviceClient);
    if (!user) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
    }

    // 1b. Rate limit
    const rateCheck = checkRateLimit(user.id);
    if (!rateCheck.allowed) {
      return rateLimitExceededResponse(rateCheck);
    }

    // 1c. Role check
    const userRole =
      ((user as unknown as Record<string, unknown>).role as string) ?? 'authenticated';
    const effectiveRole =
      (((user as unknown as Record<string, unknown>).app_metadata as Record<string, unknown>)
        ?.role as string) ?? userRole;
    if (!allowedRoles.includes(effectiveRole)) {
      return jsonResponse(
        { status: 'error', message: `Role "${effectiveRole}" is not authorized.` },
        403
      );
    }

    // 2. Validate payload
    let body: z.infer<typeof PersistencePayloadSchema>;
    try {
      const clone = req.clone();
      const raw = await clone.json();
      const parsed = PersistencePayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonResponse(
          { status: 'error', message: 'Invalid payload', issues: parsed.error.issues },
          400
        );
      }
      body = parsed.data;
    } catch {
      return jsonResponse({ status: 'error', message: 'Invalid JSON' }, 400);
    }

    // 3. Verify organization membership
    const userOrgIds = await getUserOrgIds(serviceClient, user.id);
    if (userOrgIds.length === 0) {
      return jsonResponse(
        { status: 'error', message: 'User is not a member of any organization' },
        403
      );
    }

    const teamRows = body.snapshot.payload.teamRows;
    if (teamRows.length > 0) {
      const divisionIds = [
        ...new Set(
          teamRows
            .map((r) => (r as Record<string, unknown>).division_id as string | undefined)
            .filter(Boolean)
        ),
      ];
      if (divisionIds.length > 0) {
        const { data: divisions } = await serviceClient
          .from('divisions')
          .select('organization_id')
          .in('id', divisionIds);

        const targetOrgIds = [
          ...new Set((divisions ?? []).map((d: { organization_id: string }) => d.organization_id)),
        ];
        const unauthorized = targetOrgIds.filter((oid) => !userOrgIds.includes(oid));
        if (unauthorized.length > 0) {
          return jsonResponse(
            { status: 'error', message: 'Access denied: data belongs to a different organization' },
            403
          );
        }
      }
    }

    // 4. Check for pending overrides
    const { pending } = evaluateOverrides(body.overrides ?? []);
    if (pending > 0) {
      return jsonResponse(
        {
          status: 'blocked',
          message: `${pending} manual override${pending === 1 ? ' is' : 's are'} still pending review.`,
          pendingOverrides: pending,
        },
        409
      );
    }

    // 5. Persist
    try {
      const result = await persistTeamSnapshot(
        serviceClient,
        body.snapshot as Parameters<typeof persistTeamSnapshot>[1],
        (body.runMetadata ?? {}) as RunMetadata,
        new Date()
      );

      // Audit log (fire-and-forget)
      if (userOrgIds.length > 0) {
        recordAudit(serviceClient, {
          organizationId: userOrgIds[0],
          action: 'team.saved',
          resourceType: 'team',
          metadata: { team_count: teamRows.length },
        });
      }

      const response = jsonResponse(result, 200);
      return response;
    } catch (error) {
      console.error('Team persistence error:', error);
      return jsonResponse(
        {
          status: 'error',
          message: (error as Error)?.message || 'Failed to persist team snapshot.',
        },
        500
      );
    }
  };
}

serve(handler);

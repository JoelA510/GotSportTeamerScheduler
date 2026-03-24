/**
 * Practice Persistence Edge Function
 * Phase 1 Security Remediation: Added org membership validation (C-1).
 */
import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import {
  createClient,
  type SupabaseClient,
  type User,
} from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { createPracticePersistenceHttpHandler } from '../../../packages/core/src/practicePersistenceEdgeHandler.js';
import {
  DEFAULT_ALLOWED_ROLES,
  parseAllowedRolesEnv,
} from '../../../packages/core/src/teamPersistenceEdgeConfig.js';
import {
  getUserFromRequest,
  getUserOrgIds,
  resolveOrgFromTeamIds,
  corsHeaders,
  jsonResponse,
} from '../_shared/auth.ts';

type HttpHandler = (request: Request) => Response | Promise<Response>;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const allowedRoles = parseAllowedRolesEnv(Deno.env.get('PRACTICE_PERSISTENCE_ALLOWED_ROLES'), {
  fallbackRoles: DEFAULT_ALLOWED_ROLES,
});

const PersistencePayloadSchema = z.object({
  snapshot: z.object({
    payload: z.object({
      assignmentRows: z.array(
        z.object({ team_id: z.string(), practice_slot_id: z.string() }).passthrough()
      ),
    }),
  }),
  overrides: z.array(z.unknown()).optional(),
});

let handler: HttpHandler;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for practice persistence function.'
  );
  handler = () =>
    jsonResponse(
      { status: 'error', message: 'Supabase service configuration is missing.' },
      500
    );
} else {
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { fetch },
    auth: { persistSession: false },
  });

  const innerHandler = createPracticePersistenceHttpHandler({
    supabaseClient: serviceClient,
    allowedRoles,
    getUser: (request: Request) => getUserFromRequest(request, serviceClient),
  });

  handler = async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ status: 'error', message: 'Method not allowed' }, 405);
    }

    // --- Phase 1 Security: Validate user + org membership BEFORE processing ---

    // 1. Authenticate user
    const user = await getUserFromRequest(req, serviceClient);
    if (!user) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
    }

    // 2. Validate payload schema
    let body: unknown;
    try {
      const clone = req.clone();
      body = await clone.json();
      const parsed = PersistencePayloadSchema.safeParse(body);
      if (!parsed.success) {
        return jsonResponse(
          { status: 'error', message: 'Invalid payload', issues: parsed.error.issues },
          400
        );
      }
    } catch {
      return jsonResponse({ status: 'error', message: 'Invalid JSON' }, 400);
    }

    // 3. Verify organization membership via assignment → team chain
    const userOrgIds = await getUserOrgIds(serviceClient, user.id);
    if (userOrgIds.length === 0) {
      return jsonResponse(
        { status: 'error', message: 'User is not a member of any organization' },
        403
      );
    }

    const payload = body as { snapshot?: { payload?: { assignmentRows?: Array<{ team_id?: string }> } } };
    const assignmentRows = payload?.snapshot?.payload?.assignmentRows ?? [];
    if (assignmentRows.length > 0) {
      const teamIds = [...new Set(assignmentRows.map((r) => r.team_id).filter(Boolean) as string[])];
      if (teamIds.length > 0) {
        const targetOrgId = await resolveOrgFromTeamIds(serviceClient, teamIds);
        if (targetOrgId && !userOrgIds.includes(targetOrgId)) {
          return jsonResponse(
            { status: 'error', message: 'Access denied: data belongs to a different organization' },
            403
          );
        }
      }
    }

    // 4. Delegate to inner handler
    const response = await innerHandler(req);

    // Add CORS headers if missing
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      if (!newHeaders.has(key)) {
        newHeaders.set(key, value);
      }
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}

serve(handler);

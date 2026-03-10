import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { z } from 'zod';
import {
  createClient,
  type SupabaseClient,
  type User,
} from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { createTeamPersistenceHttpHandler } from '../../../packages/core/src/teamPersistenceEdgeHandler.js';
import {
  DEFAULT_ALLOWED_ROLES,
  parseAllowedRolesEnv,
} from '../../../packages/core/src/teamPersistenceEdgeConfig.js';
import { PersistencePayloadSchema } from '../../../packages/core/src/schemas/index.js';

let handler: HttpHandler;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for team persistence function.');
  handler = () =>
    jsonResponse(
      {
        status: 'error',
        message: 'Supabase service configuration is missing.',
      },
      500
    );
} else {
  const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { fetch },
    auth: { persistSession: false },
  });

  const innerHandler = createTeamPersistenceHttpHandler({
    supabaseClient,
    allowedRoles,
    getUser: (request) => getUserFromRequest(request, supabaseClient),
  });

  handler = async (req: Request) => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method === 'POST') {
      try {
        const clone = req.clone();
        const body = await clone.json();
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
    }

    const response = await innerHandler(req);

    // Clone response to add CORS headers if missing (inner handler might not add them on errors)
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

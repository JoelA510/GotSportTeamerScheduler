/**
 * Import Validation Edge Function (Phase 2.1, Finding H-1)
 *
 * Server-side validation layer for CSV import data. The frontend sends
 * parsed CSV rows here BEFORE inserting into import_jobs. This function:
 *   1. Validates the user's JWT and org membership
 *   2. Enforces schema rules (required fields, data types, length limits)
 *   3. Sanitizes all string values (strips HTML, limits length)
 *   4. Returns validated + sanitized rows or structured validation errors
 *
 * The frontend import flow remains identical — this runs transparently
 * between client-side parsing and the Supabase insert.
 */
import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import {
  getUserFromRequest,
  getUserOrgIds,
  recordAudit,
  corsHeaders,
  jsonResponse,
} from '../_shared/auth.ts';
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts';

// --- Constants ---
const MAX_ROWS = 5000;
const MAX_STRING_LENGTH = 500;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// --- Sanitization ---
function sanitizeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/<[^>]*>/g, '')           // Strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Strip control chars
    .trim()
    .slice(0, MAX_STRING_LENGTH);
}

function sanitizeRow(row: Record<string, unknown>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    clean[sanitizeString(key)] = sanitizeString(value);
  }
  return clean;
}

// --- Schema Definitions ---
const REQUIRED_FIELDS: Record<string, string[]> = {
  players: ['first_name', 'last_name', 'date_of_birth'],
  coaches: ['full_name', 'email'],
  fields: ['name'],
};

// GotSport header alias map (strict matching, not fuzzy .includes())
const HEADER_ALIASES: Record<string, string> = {
  'first name': 'first_name',
  'first_name': 'first_name',
  'firstname': 'first_name',
  'last name': 'last_name',
  'last_name': 'last_name',
  'lastname': 'last_name',
  'date of birth': 'date_of_birth',
  'date_of_birth': 'date_of_birth',
  'dob': 'date_of_birth',
  'birthdate': 'date_of_birth',
  'full name': 'full_name',
  'full_name': 'full_name',
  'coach name': 'full_name',
  'email': 'email',
  'email address': 'email',
  'name': 'name',
  'field name': 'name',
  'field_name': 'name',
  'coach willing': 'willing_to_coach',
  'willing to coach': 'willing_to_coach',
  'buddy': 'buddy_request',
  'buddy request': 'buddy_request',
  'friend': 'buddy_request',
  'friend request': 'buddy_request',
  'medical': 'medical_info',
  'medical info': 'medical_info',
  'allergy': 'medical_info',
  'allergies': 'medical_info',
  'skill': 'skill_tier',
  'skill level': 'skill_tier',
  'skill tier': 'skill_tier',
  'level': 'skill_tier',
};

function normalizeHeader(header: string): string {
  const lower = header.toLowerCase().trim();
  return HEADER_ALIASES[lower] ?? lower;
}

// --- Validation ---
interface ValidationError {
  row: number;
  field: string;
  message: string;
}

function validateRow(
  row: Record<string, string>,
  importType: string,
  rowIndex: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const required = REQUIRED_FIELDS[importType] ?? [];

  for (const field of required) {
    if (!row[field] || row[field].trim() === '') {
      errors.push({
        row: rowIndex + 1,
        field,
        message: `Missing required field: ${field}`,
      });
    }
  }

  // Type-specific validation
  if (importType === 'players' && row['date_of_birth']) {
    const dob = new Date(row['date_of_birth']);
    if (isNaN(dob.getTime())) {
      errors.push({
        row: rowIndex + 1,
        field: 'date_of_birth',
        message: `Invalid date format: ${row['date_of_birth']}`,
      });
    }
  }

  if (importType === 'coaches' && row['email']) {
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(row['email'])) {
      errors.push({
        row: rowIndex + 1,
        field: 'email',
        message: `Invalid email format: ${row['email']}`,
      });
    }
  }

  if (row['skill_tier'] && !['novice', 'developing', 'advanced'].includes(row['skill_tier'].toLowerCase())) {
    errors.push({
      row: rowIndex + 1,
      field: 'skill_tier',
      message: `Invalid skill tier: ${row['skill_tier']}. Must be novice, developing, or advanced.`,
    });
  }

  return errors;
}

// --- Request Schema ---
const ImportValidationPayload = z.object({
  import_type: z.enum(['players', 'coaches', 'fields']),
  organization_id: z.string().uuid(),
  rows: z.array(z.record(z.unknown())).max(MAX_ROWS, `Maximum ${MAX_ROWS} rows per import`),
  file_name: z.string().max(255),
});

// --- Handler ---
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', message: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ status: 'error', message: 'Server configuration error' }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 1. Authenticate
  const user = await getUserFromRequest(req, serviceClient);
  if (!user) {
    return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
  }

  // 1b. Rate limit (Phase 3.2, M-4) — imports limited to 10/min (heavier operation)
  const rateCheck = checkRateLimit(user.id, { maxRequests: 10, windowMs: 60_000 });
  if (!rateCheck.allowed) {
    return rateLimitExceededResponse(rateCheck);
  }

  // 2. Check Content-Length (DoS protection)
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return jsonResponse(
      { status: 'error', message: `Payload too large. Maximum size is ${MAX_PAYLOAD_BYTES / 1024 / 1024} MB.` },
      413
    );
  }

  // 3. Parse and validate request body
  let body: z.infer<typeof ImportValidationPayload>;
  try {
    const raw = await req.json();
    const parsed = ImportValidationPayload.safeParse(raw);
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

  // 4. Verify org membership
  const userOrgIds = await getUserOrgIds(serviceClient, user.id);
  if (!userOrgIds.includes(body.organization_id)) {
    return jsonResponse(
      { status: 'error', message: 'Access denied: not a member of this organization' },
      403
    );
  }

  // 5. Normalize headers and sanitize all rows
  const validatedRows: Record<string, string>[] = [];
  const allErrors: ValidationError[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const rawRow = body.rows[i] as Record<string, unknown>;

    // Normalize headers via alias map
    const normalizedRow: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawRow)) {
      const normalizedKey = normalizeHeader(key);
      normalizedRow[normalizedKey] = sanitizeString(value);
    }

    // Validate
    const rowErrors = validateRow(normalizedRow, body.import_type, i);
    if (rowErrors.length > 0) {
      allErrors.push(...rowErrors);
    } else {
      validatedRows.push(normalizedRow);
    }
  }

  // 6. Audit log (fire-and-forget, Phase 4)
  recordAudit(serviceClient, {
    organizationId: body.organization_id,
    action: allErrors.length > 0 && validatedRows.length === 0 ? 'import.failed' : 'import.started',
    resourceType: 'import_job',
    metadata: {
      import_type: body.import_type,
      file_name: body.file_name,
      total_rows: body.rows.length,
      valid_rows: validatedRows.length,
      error_rows: allErrors.length,
    },
  });

  // 7. Return results
  return jsonResponse({
    status: 'success',
    import_type: body.import_type,
    total_rows: body.rows.length,
    valid_rows: validatedRows.length,
    error_rows: allErrors.length,
    validated_data: validatedRows,
    validation_errors: allErrors,
  });
});

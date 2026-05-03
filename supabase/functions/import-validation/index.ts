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
  verifyOrgAdmin,
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
  return (
    str
      .replace(/<[^>]*>/g, '') // Strip HTML tags
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Strip control chars
      .trim()
      .slice(0, MAX_STRING_LENGTH)
  );
}

// --- Schema Definitions ---
const REQUIRED_FIELDS: Record<string, string[]> = {
  players: ['first_name', 'last_name', 'date_of_birth'],
  coaches: ['full_name', 'email'],
  fields: ['location', 'name', 'type', 'start', 'end'],
};

// GotSport header alias map (strict matching, not fuzzy .includes())
const HEADER_ALIASES: Record<string, string> = {
  'first name': 'first_name',
  first_name: 'first_name',
  firstname: 'first_name',
  'last name': 'last_name',
  last_name: 'last_name',
  lastname: 'last_name',
  'date of birth': 'date_of_birth',
  date_of_birth: 'date_of_birth',
  dob: 'date_of_birth',
  birthdate: 'date_of_birth',
  'full name': 'full_name',
  full_name: 'full_name',
  'coach name': 'full_name',
  'coach first name': 'first_name',
  'coach last name': 'last_name',
  email: 'email',
  'email address': 'email',
  'email/userid': 'email',
  'email/user id': 'email',
  email_userid: 'email',
  'contact email': 'email',
  name: 'name',
  field: 'name',
  'field name': 'name',
  field_name: 'name',
  location: 'location',
  'location name': 'location',
  location_name: 'location',
  venue: 'location',
  subunit: 'subunit',
  'field subunit': 'subunit',
  field_subunit: 'subunit',
  day: 'day',
  'day of week': 'day',
  day_of_week: 'day',
  start: 'start',
  'start time': 'start',
  start_time: 'start',
  end: 'end',
  'end time': 'end',
  end_time: 'end',
  type: 'type',
  'slot type': 'type',
  slot_type: 'type',
  capacity: 'capacity',
  'valid from': 'valid_from',
  valid_from: 'valid_from',
  'valid until': 'valid_until',
  valid_until: 'valid_until',
  date: 'slot_date',
  'slot date': 'slot_date',
  slot_date: 'slot_date',
  week: 'week_index',
  week_index: 'week_index',
  surface: 'surface_type',
  'surface type': 'surface_type',
  surface_type: 'surface_type',
  size: 'size',
  'supports halves': 'supports_halves',
  supports_halves: 'supports_halves',
  lights: 'lighting_available',
  lighted: 'lighting_available',
  'lighting available': 'lighting_available',
  lighting_available: 'lighting_available',
  'coach willing': 'willing_to_coach',
  'willing to coach': 'willing_to_coach',
  buddy: 'buddy_request',
  'buddy request': 'buddy_request',
  friend: 'buddy_request',
  'friend request': 'buddy_request',
  medical: 'medical_info',
  'medical info': 'medical_info',
  allergy: 'medical_info',
  allergies: 'medical_info',
  skill: 'skill_tier',
  'skill level': 'skill_tier',
  'skill tier': 'skill_tier',
  level: 'skill_tier',
  id: 'gotsport_id',
  pid: 'gotsport_id',
  'official id': 'gotsport_id',
  'gotsport id': 'gotsport_id',
  gotsport_id: 'gotsport_id',
  'registration id': 'external_registration_id',
  registration_id: 'external_registration_id',
  external_registration_id: 'external_registration_id',
  group: 'division_name',
  division: 'division_name',
  division_name: 'division_name',
  program: 'division_name',
  grade: 'grade',
  gender: 'gender',
  'preferred name': 'preferred_name',
  preferred_name: 'preferred_name',
  nickname: 'nickname',
  phone: 'phone',
  'contact phone': 'contact_phone',
  contact_phone: 'contact_phone',
  'guardian name': 'guardian_name',
  guardian_name: 'guardian_name',
  'parent name': 'parent_name',
  parent_name: 'parent_name',
  'guardian email': 'guardian_email',
  guardian_email: 'guardian_email',
  'parent email': 'parent_email',
  parent_email: 'parent_email',
  'guardian phone': 'guardian_phone',
  guardian_phone: 'guardian_phone',
  'parent phone': 'parent_phone',
  parent_phone: 'parent_phone',
};

function normalizeHeader(header: string): string {
  const lower = header.toLowerCase().trim();
  return HEADER_ALIASES[lower] ?? lower;
}

function parseTimeMinutes(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i);
  if (!match) return null;

  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const meridiem = match[3]?.toLowerCase();

  if (minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return hour * 60 + minute;
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

  if (
    row['skill_tier'] &&
    !['novice', 'developing', 'advanced'].includes(row['skill_tier'].toLowerCase())
  ) {
    errors.push({
      row: rowIndex + 1,
      field: 'skill_tier',
      message: `Invalid skill tier: ${row['skill_tier']}. Must be novice, developing, or advanced.`,
    });
  }

  if (importType === 'fields') {
    const slotType = row['type']?.toLowerCase();
    if (slotType && !['practice', 'game'].includes(slotType)) {
      errors.push({
        row: rowIndex + 1,
        field: 'type',
        message: `Invalid field slot type: ${row['type']}. Must be practice or game.`,
      });
    }

    const start = parseTimeMinutes(row['start']);
    const end = parseTimeMinutes(row['end']);
    if (row['start'] && start === null) {
      errors.push({
        row: rowIndex + 1,
        field: 'start',
        message: `Invalid start time: ${row['start']}`,
      });
    }
    if (row['end'] && end === null) {
      errors.push({
        row: rowIndex + 1,
        field: 'end',
        message: `Invalid end time: ${row['end']}`,
      });
    }
    if (start !== null && end !== null && end <= start) {
      errors.push({
        row: rowIndex + 1,
        field: 'end',
        message: 'End time must be after start time',
      });
    }

    if (row['capacity']) {
      const capacity = Number.parseInt(row['capacity'], 10);
      if (!Number.isInteger(capacity) || capacity < 1) {
        errors.push({
          row: rowIndex + 1,
          field: 'capacity',
          message: `Invalid capacity: ${row['capacity']}. Must be at least 1.`,
        });
      }
    }

    if (slotType === 'practice') {
      if (!row['day']) {
        errors.push({
          row: rowIndex + 1,
          field: 'day',
          message: 'Practice field rows require day',
        });
      }
      if (!row['valid_from'] || !row['valid_until']) {
        errors.push({
          row: rowIndex + 1,
          field: 'valid_from',
          message: 'Practice field rows require valid_from and valid_until',
        });
      }
    }

    if (slotType === 'game' && !row['slot_date'] && !row['valid_from']) {
      errors.push({
        row: rowIndex + 1,
        field: 'slot_date',
        message: 'Game field rows require slot_date',
      });
    }
  }

  return errors;
}

// --- Request Schema ---
const ImportValidationPayload = z.object({
  import_type: z.enum(['players', 'coaches', 'fields']),
  organization_id: z.string().uuid(),
  rows: z.array(z.record(z.unknown())).max(MAX_ROWS, `Maximum ${MAX_ROWS} rows per import`),
  file_name: z.string().max(255),
  import_job_id: z.string().uuid().optional(),
  row_offset: z.number().int().min(0).optional().default(0),
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
      {
        status: 'error',
        message: `Payload too large. Maximum size is ${MAX_PAYLOAD_BYTES / 1024 / 1024} MB.`,
      },
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

  // 4. Verify org admin access before staging or validating import payloads.
  const isOrgAdmin = await verifyOrgAdmin(serviceClient, user.id, body.organization_id);
  if (!isOrgAdmin) {
    return jsonResponse(
      { status: 'error', message: 'Access denied: not an admin of this organization' },
      403
    );
  }

  if (body.import_job_id) {
    const { data: job, error: jobError } = await serviceClient
      .from('import_jobs')
      .select('id, organization_id, job_type, status')
      .eq('id', body.import_job_id)
      .eq('organization_id', body.organization_id)
      .maybeSingle();

    if (jobError) {
      console.error('Import job lookup failed:', jobError.message);
      return jsonResponse({ status: 'error', message: 'Import job lookup failed' }, 500);
    }

    if (!job) {
      return jsonResponse(
        { status: 'error', message: 'Import job not found for organization' },
        404
      );
    }

    const expectedJobType = body.import_type === 'fields' ? 'fields' : 'registration';
    if (job.job_type !== expectedJobType) {
      return jsonResponse(
        {
          status: 'error',
          message: `Import job type ${job.job_type} does not match ${body.import_type}`,
        },
        409
      );
    }

    if (['completed', 'completed_with_warnings', 'failed'].includes(job.status)) {
      return jsonResponse(
        { status: 'error', message: `Import job cannot accept staged rows while ${job.status}` },
        409
      );
    }
  }

  // 5. Normalize headers and sanitize all rows
  const validatedRows: Record<string, string>[] = [];
  const stagedRows: Record<string, unknown>[] = [];
  const stagedImportRows: Record<string, unknown>[] = [];
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
      if (body.import_type === 'players' && body.import_job_id) {
        stagedRows.push({
          import_job_id: body.import_job_id,
          organization_id: body.organization_id,
          source_row_number: body.row_offset + i + 1,
          raw_payload: Object.fromEntries(
            Object.entries(rawRow).map(([key, value]) => [key, sanitizeString(value)])
          ),
          normalized_payload: normalizedRow,
          validation_errors: [],
        });
      } else if (body.import_type !== 'players' && body.import_job_id) {
        stagedImportRows.push({
          import_job_id: body.import_job_id,
          organization_id: body.organization_id,
          import_type: body.import_type,
          source_row_number: body.row_offset + i + 1,
          raw_payload: Object.fromEntries(
            Object.entries(rawRow).map(([key, value]) => [key, sanitizeString(value)])
          ),
          normalized_payload: normalizedRow,
          validation_errors: [],
        });
      }
    }
  }

  if (stagedRows.length > 0) {
    const sourceRowNumbers = stagedRows.map((row) => row.source_row_number);
    const { error: deleteError } = await serviceClient
      .from('staging_players')
      .delete()
      .eq('import_job_id', body.import_job_id)
      .in('source_row_number', sourceRowNumbers);

    if (deleteError) {
      console.error('Failed to replace staged import rows:', deleteError.message);
      return jsonResponse(
        { status: 'error', message: 'Failed to replace staged import rows' },
        500
      );
    }

    const { error: stageError } = await serviceClient.from('staging_players').insert(stagedRows);
    if (stageError) {
      console.error('Failed to stage import rows:', stageError.message);
      return jsonResponse({ status: 'error', message: 'Failed to stage import rows' }, 500);
    }
  }

  if (stagedImportRows.length > 0) {
    const sourceRowNumbers = stagedImportRows.map((row) => row.source_row_number);
    const { error: deleteError } = await serviceClient
      .from('staging_import_rows')
      .delete()
      .eq('import_job_id', body.import_job_id)
      .in('source_row_number', sourceRowNumbers);

    if (deleteError) {
      console.error('Failed to replace staged non-player import rows:', deleteError.message);
      return jsonResponse(
        { status: 'error', message: 'Failed to replace staged import rows' },
        500
      );
    }

    const { error: stageError } = await serviceClient
      .from('staging_import_rows')
      .insert(stagedImportRows);
    if (stageError) {
      console.error('Failed to stage non-player import rows:', stageError.message);
      return jsonResponse({ status: 'error', message: 'Failed to stage import rows' }, 500);
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
      staged_rows: stagedRows.length + stagedImportRows.length,
    },
  });

  // 7. Return results
  return jsonResponse({
    status: 'success',
    import_type: body.import_type,
    total_rows: body.rows.length,
    valid_rows: validatedRows.length,
    error_rows: allErrors.length,
    staged_rows: stagedRows.length + stagedImportRows.length,
    validated_data: validatedRows,
    validation_errors: allErrors,
  });
});

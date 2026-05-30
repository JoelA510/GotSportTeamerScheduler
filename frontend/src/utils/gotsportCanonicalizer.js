/**
 * GotSport registration canonicalizer.
 *
 * SquadLogic stores ONLY the data needed for teaming and scheduling. This
 * module converts a raw GotSport export (player or coach) into a narrow,
 * whitelisted canonical row and drops everything else (medical, emergency,
 * physician, insurance, guardian demographics beyond name/email/mobile,
 * waivers, photo/uniform, financial aid, payment internals, acknowledgements).
 *
 * Run this on the client BEFORE upload so sensitive columns never leave the
 * browser. The edge function and finalize RPC then only ever see canonical
 * fields. Pure module — safe to unit test in isolation.
 */

/** Canonical keys persisted for a player import. */
export const PLAYER_ALLOWLIST = Object.freeze([
  'external_registration_id',
  'first_name',
  'last_name',
  'date_of_birth',
  'birth_year',
  'gender',
  'division_name', // from GotSport "Program"
  'age_group_label', // from GotSport "Age Group" (drives age band on auto-create)
  'registration_status',
  'placement_eligible',
  'guardian_contacts',
  'buddy_request_name',
  'experience_years',
  'skill_tier',
  'willing_to_coach',
  'play_up_requested',
]);

/** Canonical keys persisted for a coach import. */
export const COACH_ALLOWLIST = Object.freeze([
  'full_name',
  'email',
  'phone',
  'source_registration_id',
  'requested_division',
  'coaching_years',
  'coach_registration_ready',
  'can_coach_multiple_teams',
  'children', // [{ name, gender, birth_date, playing_up, preferred_co_coach }]
]);

const TRUTHY = new Set(['true', 'yes', 'y', '1', 't', 'complete', 'completed', 'paid', 'x']);

function asBool(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return TRUTHY.has(String(value).trim().toLowerCase());
}

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asIntOrNull(value) {
  const text = clean(value).match(/\d+/);
  if (!text) return null;
  const n = Number.parseInt(text[0], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * PapaParse `transformHeader` that disambiguates duplicate headers (GotSport
 * repeats "Playing Up" and "Preferred Co-Coach" once per coached player).
 * The 2nd+ occurrence of any header gets a `__n` suffix so row keys never
 * collide. Returns a fresh transformer (stateful per parse).
 *
 * @returns {(header: string) => string}
 */
export function makeDedupeHeaderTransformer() {
  const counts = new Map();
  return (header) => {
    const h = clean(header);
    const key = h.toLowerCase();
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n === 1 ? h : `${h}__${n}`;
  };
}

function buildLookup(row) {
  const map = new Map();
  for (const [k, v] of Object.entries(row ?? {})) {
    map.set(clean(k).toLowerCase(), v);
  }
  return map;
}

function get(map, ...keys) {
  for (const key of keys) {
    const value = map.get(key);
    if (value !== undefined && clean(value) !== '') return value;
  }
  return '';
}

function findByPattern(map, regex) {
  for (const [key, value] of map.entries()) {
    if (regex.test(key)) return value;
  }
  return '';
}

/**
 * Derive a registration status + eligibility flag from GotSport workflow cols.
 * Workflow internals themselves are NOT stored.
 */
function deriveEligibility(map) {
  const complete = asBool(get(map, 'complete'));
  const submitted = asBool(get(map, 'submitted'));
  const waitlisted = asBool(get(map, 'waitlist'));
  const payment = clean(get(map, 'payment status')).toLowerCase();
  const hasGating =
    map.has('complete') || map.has('submitted') || map.has('waitlist') || map.has('payment status');

  const paymentUnpaid = /(unpaid|pending|owe|owing|balance|due|not\s*paid|declined)/.test(payment);

  let status;
  if (waitlisted) status = 'waitlisted';
  else if (paymentUnpaid) status = 'unpaid';
  else if (complete) status = 'eligible';
  else if (submitted) status = 'submitted';
  else status = 'incomplete';

  const placement_eligible = hasGating ? !waitlisted && !paymentUnpaid && complete : true;
  return { registration_status: status, placement_eligible };
}

function buildGuardianContacts(map) {
  const contacts = [];
  for (const n of [1, 2]) {
    const first = clean(get(map, `guardian ${n} first name`));
    const last = clean(get(map, `guardian ${n} last name`));
    const email = clean(get(map, `guardian ${n} email address`));
    const phone = clean(get(map, `guardian ${n} mobile phone number`));
    const name = `${first} ${last}`.trim();
    if (name || email || phone) {
      const contact = {};
      if (name) contact.name = name;
      if (email) contact.email = email;
      if (phone) contact.phone = phone;
      contacts.push(contact);
    }
  }
  return contacts;
}

function deriveSkillTier(experienceYears) {
  if (experienceYears === null) return null;
  if (experienceYears >= 4) return 'advanced';
  if (experienceYears >= 2) return 'developing';
  return 'novice';
}

/**
 * Canonicalize one player row → whitelisted fields only.
 * @param {Record<string, unknown>} row - row keyed by (deduped) GotSport headers
 * @returns {Record<string, any>}
 */
export function canonicalizePlayerRow(row) {
  const map = buildLookup(row);
  const experience_years = asIntOrNull(findByPattern(map, /how many years has your player played/));
  const explicitSkill = clean(get(map, 'skill level', 'skill tier', 'skill')).toLowerCase();
  const { registration_status, placement_eligible } = deriveEligibility(map);

  return {
    external_registration_id: clean(get(map, 'registration id')) || null,
    first_name: clean(get(map, 'first name')) || null,
    last_name: clean(get(map, 'last name')) || null,
    date_of_birth: clean(get(map, 'dob', 'date of birth', 'birthdate')) || null,
    birth_year: asIntOrNull(get(map, 'birth year')),
    gender: clean(get(map, 'gender')) || null,
    division_name: clean(get(map, 'program', 'division', 'group', 'age group')) || null,
    age_group_label: clean(get(map, 'age group')) || null,
    registration_status,
    placement_eligible,
    guardian_contacts: buildGuardianContacts(map),
    buddy_request_name: clean(findByPattern(map, /buddy request/)) || null,
    experience_years,
    skill_tier: ['novice', 'developing', 'advanced'].includes(explicitSkill)
      ? explicitSkill
      : deriveSkillTier(experience_years),
    willing_to_coach: asBool(findByPattern(map, /can you coach for this player'?s team/)),
    play_up_requested: asBool(findByPattern(map, /are you coaching so this player can play up/)),
  };
}

/**
 * Canonicalize one coach row → whitelisted fields only.
 * @param {Record<string, unknown>} row - row keyed by (deduped) GotSport headers
 * @returns {Record<string, any>}
 */
export function canonicalizeCoachRow(row) {
  const map = buildLookup(row);
  const first = clean(get(map, 'first name'));
  const last = clean(get(map, 'last name'));
  const full_name = clean(get(map, 'full name', 'coach name')) || `${first} ${last}`.trim() || null;

  const child1Name = clean(findByPattern(map, /first and last name of your player/));
  const child2Name = clean(
    findByPattern(map, /(first and last name of your second player|second player.*first and last)/)
  );

  const children = [];
  if (child1Name) {
    children.push({
      name: child1Name,
      gender: clean(findByPattern(map, /what is your player'?s gender/)) || null,
      birth_date: clean(findByPattern(map, /what is your player'?s birth date/)) || null,
      playing_up: asBool(get(map, 'playing up')),
      preferred_co_coach: clean(get(map, 'preferred co-coach')) || null,
    });
  }
  if (child2Name) {
    children.push({
      name: child2Name,
      gender:
        clean(findByPattern(map, /(second player'?s gender|gender of your second player)/)) || null,
      birth_date:
        clean(
          findByPattern(map, /(second player'?s birth date|birth date of your second player)/)
        ) || null,
      playing_up: asBool(get(map, 'playing up__2')),
      preferred_co_coach: clean(get(map, 'preferred co-coach__2')) || null,
    });
  }

  const complete = asBool(get(map, 'complete'));
  const waitlisted = asBool(get(map, 'waitlist'));

  return {
    full_name,
    email: clean(get(map, 'contact email', 'email', 'email/userid')) || null,
    phone: clean(get(map, 'phone')) || null,
    source_registration_id: clean(get(map, 'registration id')) || null,
    requested_division: clean(get(map, 'age group')) || null,
    coaching_years: asIntOrNull(findByPattern(map, /how many years have you coached/)),
    coach_registration_ready: complete && !waitlisted,
    can_coach_multiple_teams: children.length > 1,
    children,
  };
}

/**
 * Canonicalize a batch of rows for an import type.
 *
 * @param {Object} params
 * @param {('players'|'coaches')} params.importType
 * @param {Array<Record<string, unknown>>} params.rows - rows keyed by deduped headers
 * @returns {Array<Record<string, unknown>>}
 */
export function canonicalizeRows({ importType, rows }) {
  if (!Array.isArray(rows)) return [];
  if (importType === 'players') return rows.map(canonicalizePlayerRow);
  if (importType === 'coaches') return rows.map(canonicalizeCoachRow);
  return rows; // fields / field_availability pass through untouched
}

function flatStr(value) {
  return value === null || value === undefined ? '' : String(value);
}

function flatBool(value) {
  return value ? 'true' : 'false';
}

/**
 * Flatten a structured canonical player into the flat, string-keyed shape the
 * upload pipeline (edge validation + finalize RPC) consumes. Guardian contacts
 * become guardian1_* / guardian2_* columns.
 *
 * @param {Record<string, unknown>} c - output of canonicalizePlayerRow
 * @returns {Record<string, string>}
 */
export function flattenCanonicalPlayer(c) {
  const guardians = Array.isArray(c.guardian_contacts) ? c.guardian_contacts : [];
  return {
    external_registration_id: flatStr(c.external_registration_id),
    first_name: flatStr(c.first_name),
    last_name: flatStr(c.last_name),
    date_of_birth: flatStr(c.date_of_birth),
    birth_year: flatStr(c.birth_year),
    gender: flatStr(c.gender),
    division_name: flatStr(c.division_name),
    age_group_label: flatStr(c.age_group_label),
    registration_status: flatStr(c.registration_status),
    placement_eligible: flatBool(c.placement_eligible),
    buddy_request_name: flatStr(c.buddy_request_name),
    experience_years: flatStr(c.experience_years),
    skill_tier: flatStr(c.skill_tier),
    willing_to_coach: flatBool(c.willing_to_coach),
    play_up_requested: flatBool(c.play_up_requested),
    guardian1_name: flatStr(guardians[0]?.name),
    guardian1_email: flatStr(guardians[0]?.email),
    guardian1_phone: flatStr(guardians[0]?.phone),
    guardian2_name: flatStr(guardians[1]?.name),
    guardian2_email: flatStr(guardians[1]?.email),
    guardian2_phone: flatStr(guardians[1]?.phone),
  };
}

/**
 * Flatten a structured canonical coach into flat columns. Children become
 * child_1_* / child_2_* columns the coach finalize RPC resolves to player_ids.
 *
 * @param {Record<string, unknown>} c - output of canonicalizeCoachRow
 * @returns {Record<string, string>}
 */
export function flattenCanonicalCoach(c) {
  const children = Array.isArray(c.children) ? c.children : [];
  return {
    full_name: flatStr(c.full_name),
    email: flatStr(c.email),
    phone: flatStr(c.phone),
    source_registration_id: flatStr(c.source_registration_id),
    requested_division: flatStr(c.requested_division),
    coaching_years: flatStr(c.coaching_years),
    coach_registration_ready: flatBool(c.coach_registration_ready),
    can_coach_multiple_teams: flatBool(c.can_coach_multiple_teams),
    child_1_name: flatStr(children[0]?.name),
    child_1_gender: flatStr(children[0]?.gender),
    child_1_birth_date: flatStr(children[0]?.birth_date),
    child_1_playing_up: flatBool(children[0]?.playing_up),
    child_1_preferred_co_coach: flatStr(children[0]?.preferred_co_coach),
    child_2_name: flatStr(children[1]?.name),
    child_2_gender: flatStr(children[1]?.gender),
    child_2_birth_date: flatStr(children[1]?.birth_date),
    child_2_playing_up: flatBool(children[1]?.playing_up),
    child_2_preferred_co_coach: flatStr(children[1]?.preferred_co_coach),
  };
}

/**
 * Canonicalize raw GotSport rows into the flat, whitelisted upload shape.
 * Everything not on the allowlist is dropped here, before upload, so sensitive
 * registration data never leaves the browser.
 *
 * @param {('players'|'coaches'|string)} importType
 * @param {Array<Record<string, any>>} rows - rows keyed by deduped headers
 * @returns {Array<Object>}
 */
export function canonicalizeForUpload(importType, rows) {
  if (!Array.isArray(rows)) return [];
  if (importType === 'players') {
    return rows.map((row) => flattenCanonicalPlayer(canonicalizePlayerRow(row)));
  }
  if (importType === 'coaches') {
    return rows.map((row) => flattenCanonicalCoach(canonicalizeCoachRow(row)));
  }
  return rows;
}

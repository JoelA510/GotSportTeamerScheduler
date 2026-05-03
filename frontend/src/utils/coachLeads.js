const TRUE_COACH_INTENTS = new Set([
  'true',
  't',
  'yes',
  'y',
  '1',
  'coach',
  'head coach',
  'assistant coach',
  'volunteer',
  'willing',
]);

const COACH_INTENT_KEYS = ['willing_to_coach', 'coach_volunteer'];
const EMAIL_KEYS = ['guardian_email', 'parent_email', 'contact_email', 'email'];
const EXTERNAL_ID_KEYS = [
  'external_registration_id',
  'gotsport_id',
  'registration_id',
  'player_id',
];
const DIVISION_NAME_KEYS = ['division_name', 'division', 'group', 'program'];

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeComparable(value) {
  return normalizeString(value).toLowerCase().replace(/\s+/g, ' ');
}

function firstNonEmpty(row, keys) {
  for (const key of keys) {
    const value = normalizeString(row?.[key]);
    if (value) return value;
  }
  return '';
}

function joinNameParts(...parts) {
  return parts.map(normalizeString).filter(Boolean).join(' ');
}

function getAdultContactName(row) {
  return (
    firstNonEmpty(row, ['guardian_name', 'parent_name', 'contact_name']) ||
    joinNameParts(row?.guardian_first_name, row?.guardian_last_name) ||
    joinNameParts(row?.parent_first_name, row?.parent_last_name)
  );
}

function buildDivisionLookup(divisions) {
  return (divisions || []).reduce(
    (lookup, division) => {
      const id = normalizeString(division?.id);
      const name = normalizeComparable(division?.name);
      if (id) lookup.byId.set(id, division);
      if (name) lookup.byName.set(name, division);
      return lookup;
    },
    { byId: new Map(), byName: new Map() }
  );
}

function buildPlayerLookup(players) {
  return (players || []).reduce(
    (lookup, player) => {
      const externalId = normalizeComparable(player?.external_registration_id);
      if (externalId) lookup.byExternalId.set(externalId, player);
      return lookup;
    },
    { byExternalId: new Map() }
  );
}

function resolveDivisionId(row, divisionLookup) {
  const explicitDivisionId = normalizeString(row?.division_id);
  if (explicitDivisionId && divisionLookup.byId.has(explicitDivisionId)) {
    return explicitDivisionId;
  }

  const divisionName = normalizeComparable(firstNonEmpty(row, DIVISION_NAME_KEYS));
  if (divisionName && divisionLookup.byName.has(divisionName)) {
    return divisionLookup.byName.get(divisionName).id;
  }

  return null;
}

export function isCoachIntent(value) {
  if (typeof value === 'boolean') return value;
  return TRUE_COACH_INTENTS.has(normalizeComparable(value));
}

export function hasCoachLeadIntent(row) {
  return isCoachIntent(firstNonEmpty(row, COACH_INTENT_KEYS));
}

export function getExternalRegistrationId(row) {
  return firstNonEmpty(row, EXTERNAL_ID_KEYS);
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ organizationId?: string, divisions?: Array<Record<string, unknown>>, players?: Array<Record<string, unknown>> }} options
 */
export function buildCoachLeadPayload(rows, options = {}) {
  const { organizationId, divisions = [], players = [] } = options;
  if (!organizationId || !Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const divisionLookup = buildDivisionLookup(divisions);
  const playerLookup = buildPlayerLookup(players);
  const seen = new Set();
  const leads = [];

  for (const row of rows) {
    if (!hasCoachLeadIntent(row)) continue;

    const email = firstNonEmpty(row, EMAIL_KEYS).toLowerCase();
    const fullName = getAdultContactName(row);
    if (!EMAIL_PATTERN.test(email) || !fullName) continue;

    const externalId = normalizeComparable(getExternalRegistrationId(row));
    const player = externalId ? playerLookup.byExternalId.get(externalId) : null;
    const divisionId = resolveDivisionId(row, divisionLookup) || player?.division_id || null;
    const playerId = player?.id || null;
    const dedupeKey = [email, divisionId || '', playerId || ''].join('|');

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    leads.push({
      email,
      full_name: fullName,
      organization_id: organizationId,
      division_id: divisionId,
      player_id: playerId,
    });
  }

  return leads;
}

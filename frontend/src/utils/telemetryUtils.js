import { logger } from '../lib/logger.js';

/**
 * Standard Header Aliases (Static Fallback).
 * Mirrors server-side validation logic.
 */
export const HEADER_ALIASES = {
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
  email: 'email',
  'email address': 'email',
  name: 'name',
  'field name': 'name',
  field_name: 'name',
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
};

/**
 * Profile-specific biases.
 * Triggered when specific configurations are detected in telemetry.
 */
const PROFILE_BIASES = {
  gotsport_legacy: {
    id: 'gotsport_id',
    pid: 'gotsport_id',
    'official id': 'gotsport_id',
    group: 'division_name',
    division: 'division_name',
    org: 'organization_name',
  },
};

/**
 * Smart Header Matcher Engine.
 * Implements a 50ms circuit breaker and confidence scoring.
 *
 * @param {string[]} headers - The raw headers from the CSV.
 * @param {any[]} telemetryLogs - Historical telemetry logs for the organization.
 * @returns {Object} { mappings, confidence, rationals, timing, isFallback }
 */
export function matchHeaders(headers, telemetryLogs = []) {
  const startTime = performance.now();
  const mappings = {};
  const confidence = {};
  const rationales = {};

  // 1. Detect Profile Hints from Telemetry
  const activeProfiles = new Set();
  telemetryLogs.forEach((log) => {
    // Check for onboarding selections or wizard finalization payloads
    const selections = log.payload?.selected || log.payload?.final_flags || {};
    if (Array.isArray(selections)) {
      if (selections.includes('gotsport_legacy')) activeProfiles.add('gotsport_legacy');
    } else if (selections.gotsport_legacy) {
      activeProfiles.add('gotsport_legacy');
    }
  });

  // 2. Matching Loop
  for (const rawHeader of headers) {
    // CIRCUIT BREAKER CHECK
    const elapsed = performance.now() - startTime;
    if (elapsed > 50) {
      logger.warn(
        `[SmartIngestion] Circuit Breaker Tripped at ${elapsed.toFixed(2)}ms. Falling back to static mapping.`
      );
      return {
        mappings: simpleStaticMatch(headers),
        confidence: {},
        rationales: {},
        timing: elapsed,
        isFallback: true,
      };
    }

    const h = rawHeader.toLowerCase().trim();
    let bestMatch = h;
    let maxScore = 0;
    let reason = 'No match found';

    // A. Profile Bias (Highest Priority)
    activeProfiles.forEach((profile) => {
      const bias = PROFILE_BIASES[profile]?.[h];
      if (bias) {
        bestMatch = bias;
        maxScore = 0.95;
        reason = `Matched: '${rawHeader}' via ${profile} Profile`;
      }
    });

    // B. Static Alias (High Priority)
    if (maxScore < 0.9 && HEADER_ALIASES[h]) {
      bestMatch = HEADER_ALIASES[h];
      maxScore = 0.9;
      reason = `Matched: '${rawHeader}' via Standard Alias`;
    }

    // C. Exact Match (Universal)
    const knownKeys = Object.values(HEADER_ALIASES);
    if (maxScore < 1.0 && knownKeys.includes(h)) {
      bestMatch = h;
      maxScore = 1.0;
      reason = `Exact Match: '${rawHeader}'`;
    }

    // Save results
    mappings[rawHeader] = bestMatch;
    confidence[rawHeader] = maxScore;
    rationales[rawHeader] = reason;
  }

  const endTime = performance.now();
  return {
    mappings,
    confidence,
    rationales,
    timing: endTime - startTime,
    isFallback: false,
  };
}

/**
 * Legacy static matching for fallback scenarios.
 */
function simpleStaticMatch(headers) {
  const result = {};
  headers.forEach((h) => {
    const normalized = h.toLowerCase().trim();
    result[h] = HEADER_ALIASES[normalized] ?? normalized;
  });
  return result;
}

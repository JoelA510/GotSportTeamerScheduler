/**
 * The merged Phase 1 severity table — every reason code the system knows about,
 * with the severity its own module froze for it.
 *
 * This is the **base** the registry overrides. Prompt 1.1 put severity in a
 * frozen lookup table in `facility/reasonCodes.js` for exactly this reason, and
 * said so in its own docstring: *"Prompt 2.1 has to be able to demote field
 * adjacency from a hard constraint to a preference and back again, so
 * `FACILITY_REASON_SEVERITY` is the seam that override has to write through."*
 * `timing/reasonCodes.js` and `availability/reasonCodes.js` repeat the promise.
 * This module collects the three tables (plus this module's own) and is the only
 * place that knows they exist together.
 *
 * Merging is where a collision would hide, so the merge is checked at module
 * load rather than trusted: two tables that give one code two different
 * severities would silently make one of them win by import order, which is the
 * drift `docs/ARCHITECTURE.md` §1.1 is about. That throws instead.
 *
 * @module constraints/baseSeverity
 */

import { AVAILABILITY_REASON_SEVERITY } from '../availability/reasonCodes.js';
import { FACILITY_REASON_SEVERITY } from '../facility/reasonCodes.js';
import { TIMING_REASON_SEVERITY } from '../timing/reasonCodes.js';

import { CONSTRAINT_REASON_SEVERITY } from './reasonCodes.js';

/**
 * The four contributing tables, named so a collision can be reported usefully.
 *
 * @type {ReadonlyArray<[string, Readonly<Record<string, string>>]>}
 */
const SOURCE_TABLES = Object.freeze([
  ['facility', FACILITY_REASON_SEVERITY],
  ['timing', TIMING_REASON_SEVERITY],
  ['availability', AVAILABILITY_REASON_SEVERITY],
  ['constraints', CONSTRAINT_REASON_SEVERITY],
]);

/**
 * Merge the tables, refusing to merge a genuine disagreement.
 *
 * A code appearing in two tables with the *same* severity is fine and expected
 * — `TIMING_SEVERITY` is `FACILITY_SEVERITY`, so the vocabularies are shared by
 * construction. A code appearing twice with different severities is a bug.
 *
 * @returns {{ table: Record<string, string>, owner: Record<string, string> }}
 */
function mergeSeverityTables() {
  /** @type {Record<string, string>} */
  const table = {};
  /** @type {Record<string, string>} */
  const owner = {};
  for (const [moduleName, source] of SOURCE_TABLES) {
    for (const [code, severity] of Object.entries(source)) {
      if (code in table && table[code] !== severity) {
        throw new Error(
          `constraints: reason code "${code}" is "${table[code]}" in ${owner[code]} and "${severity}" in ${moduleName}; one code cannot have two severities`
        );
      }
      table[code] = severity;
      if (!(code in owner)) owner[code] = moduleName;
    }
  }
  return { table, owner };
}

const merged = mergeSeverityTables();

/**
 * Every registered reason code's severity, before any constraint speaks.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BASE_REASON_SEVERITY = Object.freeze({ ...merged.table });

/**
 * Which module registered each code. Provenance for an operator asking where a
 * severity came from, and the reason a collision message can name both sides.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const REASON_CODE_OWNER = Object.freeze({ ...merged.owner });

/** Every registered reason code, sorted. */
export const BASE_REASON_CODES = Object.freeze(Object.keys(BASE_REASON_SEVERITY).sort());

/**
 * Is this a reason code any module has registered?
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isKnownReasonCode(code) {
  return Object.prototype.hasOwnProperty.call(BASE_REASON_SEVERITY, code);
}

/**
 * The severity a reason code has before the registry speaks.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason every module's own `severityOf()` does: a code with no severity is a
 * code somebody forgot to register, and defaulting would make it silently
 * non-blocking.
 *
 * @param {string} code
 * @returns {string} a `CONSTRAINT_SEVERITY` value
 */
export function baseSeverityOf(code) {
  const severity = BASE_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`constraints: reason code "${code}" is not registered by any module`);
  }
  return severity;
}

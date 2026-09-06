/**
 * **The export seam: the domain model out to CSV and back, byte-stable.**
 *
 * Follows `externalImport/mapping.js`'s
 * `serialiseExternalMappingRegistry()` / `readExternalMappingRegistry()`
 * exactly: a version-stamped document, validated by a `.strict()` schema **in
 * both directions**, with no `Date`, no `Map` and no function in it. A document
 * this module cannot read back is not a document, and finding that out at write
 * time is the difference between a failing test and a corrupt store.
 *
 * ## What "the round trip is the identity" means here, precisely
 *
 * The asserted property is **`export -> import -> export` over the domain
 * model**. It is *not* that the four working sheets are reproduced byte for
 * byte, and the plan's phrase "byte-stable and re-importable" must not be read
 * that way.
 *
 * The sheets cannot survive a normalising round trip, and that is the whole
 * point of keeping the raw cell: `field_inventory.csv`'s `9v9 (1) 7v7 (2) upper
 * (+ lower)` has no normal form, 15 rows of `field_weekly_availability.csv`
 * carry a date where an hour range was meant, and `field_constraints.csv`'s
 * Gardening Day row carries a date where a field range was meant. A serialiser
 * that reproduced those exactly would be a file copier; one that "fixed" them
 * would destroy the evidence. So the export writes the **domain model's own**
 * CSV, and the raw cells travel beside the readings rather than through them.
 *
 * ## What makes it byte-stable
 *
 * Four rules, each one of them load-bearing and none of them a default:
 *
 * 1. **Column order is frozen**, read from {@link COLUMNS} rather than from
 *    `Object.keys()` of whatever the first record happened to hold.
 * 2. **Row order is a declared sort** on the record id, so two runs over the
 *    same set write the same file regardless of input order.
 * 3. **One quoting rule**, {@link quoteCell} - quote if and only if the cell
 *    holds a comma, a double quote, a newline, or leading/trailing space.
 * 4. **`\n` endings and no BOM.** A trailing newline is written, once.
 *
 * Nothing here persists anything. Every registry carries
 * {@link FIELD_ADMIN_REASON.REGISTRY_NOT_PERSISTED}, in the same position
 * `EXTERNAL_MAPPING_NOT_PERSISTED` takes: there is no SQL home for these
 * records in this PR, and writing columns now would invent the store this seam
 * exists to defer.
 *
 * @module fieldAdmin/serialise
 */

import { z } from 'zod';

import {
  AliasRecordSchema,
  BlackoutWindowSchema,
  PermitWindowSchema,
  RecurringWindowSchema,
  SUBJECT_KINDS,
  VenueAttributesSchema,
} from './schemas.js';
import {
  FIELD_ADMIN_REASON,
  assertFieldAdminFindings,
  deriveFieldAdminStatus,
  makeFieldAdminFinding,
} from './reasonCodes.js';

/** Bumped when the document shape changes in a way a reader must know about. */
export const FIELD_REGISTRY_DOCUMENT_VERSION = 1;

/** The line ending. Written, never inferred from the platform. */
const LINE_ENDING = '\n';

/**
 * The frozen column order per subject kind.
 *
 * Read by both the writer and the reader, so a column added to one cannot go
 * missing from the other.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const COLUMNS = Object.freeze({
  blackout: Object.freeze([
    'id',
    'scope',
    'venueIds',
    'surfaceIds',
    'fromDate',
    'toDate',
    'startMinutes',
    'endMinutes',
    'reason',
    'note',
    'source',
  ]),
  'recurring-window': Object.freeze([
    'id',
    'venueIds',
    'isoWeekday',
    'startMinutes',
    'endMinutes',
    'available',
    'source',
  ]),
  'permit-window': Object.freeze([
    'id',
    'permitId',
    'venueIds',
    'surfaceIds',
    'facilityLabel',
    'date',
    'startMinutes',
    'endMinutes',
    'services',
    'source',
  ]),
  'venue-attributes': Object.freeze([
    'id',
    'venueIds',
    'venueLabel',
    'fieldSizesText',
    'ageGroupsText',
    'practiceMaxTeamsText',
    'bathroomText',
    'notesText',
    'equipment',
    'source',
  ]),
  alias: Object.freeze([
    'id',
    'displayName',
    'label',
    'venueIds',
    'surfaceIds',
    'uncertain',
    'source',
  ]),
});

/**
 * Columns holding a list of strings, which round-trip through a space-joined
 * cell. Ids and service names hold no spaces in this corpus, and the reader
 * refuses one that does rather than splitting it wrongly.
 */
const LIST_COLUMNS = new Set(['venueIds', 'surfaceIds', 'services']);

/** Columns holding an integer or the empty string. */
const NUMBER_COLUMNS = new Set(['startMinutes', 'endMinutes', 'isoWeekday']);

/** Columns holding `true` / `false`. */
const BOOLEAN_COLUMNS = new Set(['available', 'uncertain']);

/** The one column holding structured data, written as `item=value` pairs. */
const EQUIPMENT_COLUMN = 'equipment';

/** The schema per subject kind, for validation in both directions. */
/** @type {Array<[string, import('zod').ZodTypeAny]>} */
const SCHEMA_ENTRIES = [
  ['blackout', BlackoutWindowSchema],
  ['recurring-window', RecurringWindowSchema],
  ['permit-window', PermitWindowSchema],
  ['venue-attributes', VenueAttributesSchema],
  ['alias', AliasRecordSchema],
];

const SCHEMA_BY_KIND = new Map(SCHEMA_ENTRIES);

/** The document a registry serialises to. Validated on the way out and in. */
export const FieldRegistryDocumentSchema = z
  .object({
    version: z.literal(FIELD_REGISTRY_DOCUMENT_VERSION),
    registryId: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(/** @type {[string, ...string[]]} */ (SUBJECT_KINDS)),
    records: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

/**
 * The columns for one subject kind, or a throw naming the union.
 *
 * @param {string} kind
 * @returns {ReadonlyArray<string>}
 */
export function columnsFor(kind) {
  const columns = Object.prototype.hasOwnProperty.call(COLUMNS, kind) ? COLUMNS[kind] : null;
  if (!columns) {
    throw new Error(
      `fieldAdmin serialise: subject kind "${kind}" has no column order; add one beside its neighbours in COLUMNS (${SUBJECT_KINDS.join(', ')})`
    );
  }
  return columns;
}

/**
 * Render one value to its cell text.
 *
 * @param {string} column
 * @param {unknown} value
 * @returns {string}
 */
export function renderCell(column, value) {
  if (value === null || value === undefined) return '';
  if (column === EQUIPMENT_COLUMN) {
    return /** @type {Array<{ item: string, value: string }>} */ (value)
      .map((entry) => `${entry.item}=${entry.value}`)
      .join('; ');
  }
  if (LIST_COLUMNS.has(column)) return /** @type {string[]} */ (value).join(' ');
  if (BOOLEAN_COLUMNS.has(column)) return value ? 'true' : 'false';
  return String(value);
}

/**
 * Read one cell back to its value.
 *
 * @param {string} column
 * @param {string} cell
 * @returns {unknown}
 */
export function readCell(column, cell) {
  if (column === EQUIPMENT_COLUMN) {
    if (cell === '') return [];
    return cell.split('; ').map((entry) => {
      const at = entry.indexOf('=');
      if (at < 0) {
        throw new Error(
          `fieldAdmin serialise: equipment entry ${JSON.stringify(entry)} carries no "="; the writer emits "item=value"`
        );
      }
      return { item: entry.slice(0, at), value: entry.slice(at + 1) };
    });
  }
  if (LIST_COLUMNS.has(column)) return cell === '' ? [] : cell.split(' ');
  if (BOOLEAN_COLUMNS.has(column)) {
    if (cell === 'true') return true;
    if (cell === 'false') return false;
    throw new Error(
      `fieldAdmin serialise: ${column} cell ${JSON.stringify(cell)} is neither "true" nor "false"`
    );
  }
  if (NUMBER_COLUMNS.has(column)) return cell === '' ? null : Number(cell);
  return cell === '' ? null : cell;
}

/**
 * Quote a cell if and only if it needs it. **The one quoting rule.**
 *
 * @param {string} cell
 * @returns {string}
 */
export function quoteCell(cell) {
  const needsQuote =
    cell.includes(',') ||
    cell.includes('"') ||
    cell.includes('\n') ||
    cell.includes('\r') ||
    cell !== cell.trim();
  return needsQuote ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * Split one CSV line, honouring the quoting rule above.
 *
 * Written here rather than reached for from `fixtures/`: this package is pure
 * domain logic and the fixtures barrel is an IO layer. The grammar is the
 * writer's own, so the two cannot disagree about it.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCsvLine(line) {
  /** @type {string[]} */
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  if (quoted) {
    throw new Error(`fieldAdmin serialise: unterminated quote in ${JSON.stringify(line)}`);
  }
  cells.push(cell);
  return cells;
}

/**
 * **Build a registry** of one subject kind.
 *
 * @param {Object} input
 * @param {string} input.registryId
 * @param {string} input.label
 * @param {string} input.kind - a `SUBJECT_KINDS` value
 * @param {ReadonlyArray<Record<string, unknown>>} input.records
 * @returns {{ registryId: string, label: string, kind: string, records: ReadonlyArray<Record<string, unknown>>, findings: ReadonlyArray<import('./types.js').FieldAdminFinding>, status: string }}
 */
export function buildFieldRegistry(input) {
  const schema = SCHEMA_BY_KIND.get(input.kind);
  if (!schema) {
    throw new Error(
      `fieldAdmin serialise: subject kind "${input.kind}" has no schema; add one beside its neighbours (${SUBJECT_KINDS.join(', ')})`
    );
  }
  // Re-validated here rather than trusted from a projector: a record that
  // reaches the writer unvalidated is one the reader may refuse, and the round
  // trip would then fail at read time on data already written.
  const records = input.records.map((record) => schema.parse(record));

  const seen = new Set();
  for (const record of records) {
    const id = /** @type {string} */ (record.id);
    if (seen.has(id)) {
      throw new Error(`fieldAdmin serialise: duplicate record id "${id}" in ${input.registryId}`);
    }
    seen.add(id);
  }

  const findings = [
    makeFieldAdminFinding(
      FIELD_ADMIN_REASON.REGISTRY_NOT_PERSISTED,
      `field registry ${input.registryId} lives in memory only; serialiseFieldRegistry() and readFieldRegistry() are the declared persistence seam and nothing in this repository stores through it yet`,
      { registryId: input.registryId, kind: input.kind, recordCount: records.length }
    ),
  ];
  assertFieldAdminFindings(findings, `registry ${input.registryId}`);

  return Object.freeze({
    registryId: input.registryId,
    label: input.label,
    kind: input.kind,
    records: Object.freeze(records.map((record) => Object.freeze({ ...record }))),
    findings: Object.freeze(findings),
    status: deriveFieldAdminStatus(findings),
  });
}

/**
 * **Serialise a registry** to a document.
 *
 * Validated on the way out as well as on the way in, for the reason
 * `serialiseExternalMappingRegistry()` states.
 *
 * @param {{ registryId: string, label: string, kind: string, records: ReadonlyArray<Record<string, unknown>> }} registry
 * @returns {Object}
 */
export function serialiseFieldRegistry(registry) {
  const columns = columnsFor(registry.kind);
  const document = {
    version: FIELD_REGISTRY_DOCUMENT_VERSION,
    registryId: registry.registryId,
    label: registry.label,
    kind: registry.kind,
    // Sorted by id, so input order cannot reach the output.
    records: [...registry.records]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((record) => {
        /** @type {Record<string, unknown>} */
        const row = {};
        for (const column of columns) row[column] = record[column] ?? null;
        return row;
      }),
  };
  return /** @type {Object} */ (FieldRegistryDocumentSchema.parse(document));
}

/**
 * **Read a registry back** out of a document.
 *
 * Re-runs every construction check, so a document edited by hand - or by a
 * store with its own opinions - is refused or reported exactly as a fresh input
 * would be. There is no fast path that trusts a document because this module
 * wrote it.
 *
 * @param {unknown} rawDocument
 * @returns {ReturnType<typeof buildFieldRegistry>}
 */
export function readFieldRegistry(rawDocument) {
  const document = /** @type {any} */ (FieldRegistryDocumentSchema.parse(rawDocument));
  return buildFieldRegistry({
    registryId: document.registryId,
    label: document.label,
    kind: document.kind,
    records: document.records,
  });
}

/**
 * Write a document to CSV text.
 *
 * @param {Object} document - from {@link serialiseFieldRegistry}
 * @returns {string}
 */
export function toCsv(document) {
  const kind = /** @type {string} */ (/** @type {any} */ (document).kind);
  const columns = columnsFor(kind);
  const lines = [columns.map((column) => quoteCell(column)).join(',')];
  for (const record of /** @type {Array<Record<string, unknown>>} */ (
    /** @type {any} */ (document).records
  )) {
    lines.push(columns.map((column) => quoteCell(renderCell(column, record[column]))).join(','));
  }
  return `${lines.join(LINE_ENDING)}${LINE_ENDING}`;
}

/**
 * Read CSV text back to a document.
 *
 * @param {string} text
 * @param {{ registryId: string, label: string, kind: string }} identity
 * @returns {Object}
 */
export function fromCsv(text, identity) {
  const columns = columnsFor(identity.kind);
  const lines = text.split(LINE_ENDING);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) {
    throw new Error(`fieldAdmin serialise: ${identity.registryId} has no header line`);
  }

  const header = splitCsvLine(lines[0]);
  if (header.join(',') !== columns.join(',')) {
    // Checked whole rather than per cell, and against the frozen order: a
    // header-only mismatch is how a column silently stops being read.
    throw new Error(
      `fieldAdmin serialise: ${identity.registryId} header is [${header.join(', ')}]; expected [${columns.join(', ')}]`
    );
  }

  const records = lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    if (cells.length !== columns.length) {
      throw new Error(
        `fieldAdmin serialise: ${identity.registryId} row ${index} has ${cells.length} cell(s) for ${columns.length} column(s)`
      );
    }
    /** @type {Record<string, unknown>} */
    const record = {};
    columns.forEach((column, position) => {
      record[column] = readCell(column, cells[position]);
    });
    return record;
  });

  return /** @type {Object} */ (
    FieldRegistryDocumentSchema.parse({
      version: FIELD_REGISTRY_DOCUMENT_VERSION,
      registryId: identity.registryId,
      label: identity.label,
      kind: identity.kind,
      records,
    })
  );
}

/**
 * `.strict()` Zod schemas for the field-administration domain model.
 *
 * `.strict()` throughout, for the reason `facility/schemas.js` states: an
 * unrecognised key on one of these records is a bug in the producer, not a
 * silent passenger. `docs/ARCHITECTURE.md` §1.1 records `.passthrough()` as
 * exactly what let four copies of the slot model drift apart.
 *
 * Conventions inherited from `BUILD_PLAN_STATUS.md` §4 and applied here without
 * exception: **minutes past midnight**, **`YYYY-MM-DD`**, and **no `Date`
 * construction anywhere**.
 *
 * @module fieldAdmin/schemas
 */

import { z } from 'zod';

import { findIdentityShapes } from '../privacy/textShapes.js';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** Minutes past local midnight. `1440` is the end of a day, not the start of the next. */
export const MinutesSchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** The longest a free-text note may be. Long enough to be useful, short enough to read. */
export const NOTE_MAX_LENGTH = 200;

/**
 * A nullable free-text column, with `''` normalised to `null`.
 *
 * **An empty string and an absent value are the same thing here**, and letting
 * both exist made the export ambiguous: `''` and `null` both render as an empty
 * cell, so `notesText: ''` round-tripped to `null` with the file byte-identical
 * - a changed record behind an unchanged page, which is exactly what a
 * byte-only identity assertion cannot see.
 *
 * The ambiguity is removed rather than encoded around. Distinguishing them on
 * the page (a quoted empty cell against a bare one) would preserve a
 * distinction the domain does not have, and `CLAUDE.md` §2's data minimisation
 * points the same way: an empty note is not a note.
 *
 * @param {import('zod').ZodTypeAny} inner
 * @returns {import('zod').ZodTypeAny}
 */
const nullableText = (inner) =>
  z.preprocess((value) => (value === '' ? null : value), inner.nullable().default(null));

/**
 * **The privacy guard on operator-written prose.**
 *
 * A blackout's note is admin-writable, organisation-scoped and durable, which
 * makes it the natural place for "closed for the Hendricks memorial" to land.
 * `CLAUDE.md` §2 puts personal data out of scope and requires data
 * minimisation, so the structured half of a reason lives in
 * {@link BLACKOUT_REASON} and only the residue is prose - bounded, and refused
 * outright when it carries a shape that can only be identity.
 *
 * The shapes come from `privacy/textShapes.js`, which is the same table
 * `tests/season2026CorpusVocabulary.test.js` enforces over the corpus. One
 * producer: a second copy here would drift the moment either side was
 * strengthened.
 *
 * **What this does not catch, stated rather than implied.** A plain given name
 * and surname has no shape and passes. That class is handled by keeping the
 * reason itself an enum, so the note is a residue rather than the field an
 * operator reaches for first - not by pretending a regex can recognise a name.
 */
export const NoteSchema = z
  .string()
  .max(NOTE_MAX_LENGTH, { message: `a note may be at most ${NOTE_MAX_LENGTH} characters` })
  .superRefine((value, ctx) => {
    // `allowCommonAbbreviations` is asked for here and nowhere else: the corpus
    // scanner keeps the strict reading, and an operator writing "closed after
    // 6 p.m." is not accused of leaking personal data.
    for (const { shape, match } of findIdentityShapes(value, {
      allowCommonAbbreviations: true,
    })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a note may not carry ${shape}-shaped text (${JSON.stringify(match)}); personal data is out of scope per CLAUDE.md section 2`,
        params: { shape, match },
      });
    }
  });

/**
 * Why ground is unavailable. **An enum, not prose.**
 *
 * Derived from the reasons `fixtures/season-2026/practice/field_constraints.csv`
 * actually writes, plus the two the permit layer needs. `OTHER` exists so an
 * operator is never forced to mislabel, and it is the only value that makes the
 * note worth reading.
 *
 * @readonly
 * @enum {string}
 */
export const BLACKOUT_REASON = Object.freeze({
  /** `Offline` - the venue is not usable at all. */
  CLOSURE: 'closure',
  /** `School Event` - the site is in use by its owner. */
  SCHOOL_EVENT: 'school-event',
  /** `Gardening Day` and similar site work. */
  MAINTENANCE: 'maintenance',
  /** `Reseeding, Indefinite Closure`. */
  RESEEDING: 'reseeding',
  WEATHER: 'weather',
  /** A permit was applied for and not granted, or has lapsed. */
  PERMIT_NOT_GRANTED: 'permit-not-granted',
  /** `Adjacent Fields / Spacing` - the graph carries this as overlap pairs too. */
  ADJACENCY: 'adjacency',
  /** A third party holds the ground, e.g. `Adaptive Sports Org Flag Football`. */
  THIRD_PARTY_BOOKING: 'third-party-booking',
  OTHER: 'other',
});

/** Where a record came from. Provenance is required, never inferred. */
export const RECORD_SOURCE = Object.freeze({
  MANUAL: 'manual',
  CONSTRAINT_SHEET: 'constraint-sheet',
  WEEKLY_AVAILABILITY_SHEET: 'weekly-availability-sheet',
  PERMIT: 'permit',
  INVENTORY_SHEET: 'inventory-sheet',
  EQUIPMENT_SHEET: 'equipment-sheet',
  PRACTICE_RING: 'practice-ring',
  FIELDS_RING: 'fields-ring',
});

/** How a blackout names the ground it closes. */
export const BLACKOUT_SCOPE = Object.freeze({
  VENUE: 'venue',
  SURFACE: 'surface',
});

const enumValues = (table) => /** @type {[string, ...string[]]} */ (Object.values(table));

/**
 * A closed window over ground, on a date or a date range.
 *
 * `startMinutes` and `endMinutes` are **both null or both set**: two nulls mean
 * all day. A half-open pair would leave "closed from 16:00" ambiguous between
 * "until close" and "for an unstated length", and the constraint sheet writes
 * neither.
 */
export const BlackoutWindowSchema = z
  .object({
    id: IdSchema,
    scope: z.enum(enumValues(BLACKOUT_SCOPE)),
    /** Every venue id the scope names. Non-empty for a venue scope. */
    venueIds: z.array(IdSchema).default([]),
    /** Every surface id the scope names. Non-empty for a surface scope. */
    surfaceIds: z.array(IdSchema).default([]),
    fromDate: IsoDateSchema,
    toDate: IsoDateSchema,
    startMinutes: MinutesSchema.nullable().default(null),
    endMinutes: MinutesSchema.nullable().default(null),
    reason: z.enum(enumValues(BLACKOUT_REASON)),
    note: nullableText(NoteSchema),
    source: z.enum(enumValues(RECORD_SOURCE)),
  })
  .strict()
  .refine((window) => window.fromDate <= window.toDate, {
    message: 'a blackout fromDate must not be after toDate',
    path: ['toDate'],
  })
  .refine((window) => (window.startMinutes === null) === (window.endMinutes === null), {
    message: 'a blackout is all day (both times null) or timed (both times set), never half of one',
    path: ['endMinutes'],
  })
  .refine(
    (window) =>
      window.startMinutes === null ||
      window.endMinutes === null ||
      window.endMinutes >= window.startMinutes,
    { message: 'a blackout endMinutes must not precede startMinutes', path: ['endMinutes'] }
  )
  .refine(
    (window) =>
      window.scope === BLACKOUT_SCOPE.VENUE
        ? window.venueIds.length > 0
        : window.surfaceIds.length > 0,
    {
      message: 'a blackout must name the ground its scope claims',
      path: ['scope'],
    }
  );

/**
 * A window that recurs on a weekday rather than falling on a date.
 *
 * `field_weekly_availability.csv` is the source: 42 rows of "this venue is open
 * 16:00-19:00 on Mondays". Held as availability rather than as a blackout,
 * because the sheet states when ground *is* usable.
 */
export const RecurringWindowSchema = z
  .object({
    id: IdSchema,
    venueIds: z.array(IdSchema).min(1),
    /** ISO weekday, Monday = 1 through Sunday = 7. No `Date` is constructed to get it. */
    isoWeekday: z.number().int().min(1).max(7),
    /** Null on both when the sheet states the day is unavailable outright. */
    startMinutes: MinutesSchema.nullable().default(null),
    endMinutes: MinutesSchema.nullable().default(null),
    available: z.boolean(),
    source: z.enum(enumValues(RECORD_SOURCE)),
  })
  .strict()
  .refine((window) => (window.startMinutes === null) === (window.endMinutes === null), {
    message: 'a recurring window carries both times or neither',
    path: ['endMinutes'],
  })
  .refine(
    (window) =>
      window.startMinutes === null ||
      window.endMinutes === null ||
      window.endMinutes >= window.startMinutes,
    { message: 'a recurring window endMinutes must not precede startMinutes', path: ['endMinutes'] }
  )
  .refine((window) => window.available || window.startMinutes === null, {
    message: 'an unavailable day states no window',
    path: ['available'],
  });

/**
 * One reserved window a permit grants.
 *
 * The permit sheet names ground in a **third** vocabulary, unrelated to either
 * decoder ring: `Field - Soccer 1A/1B (Field)`, `Field - Football Stadium
 * (Field)`, `Lower Field - Practice 3 (Field)`. `facilityLabel` keeps that
 * spelling verbatim beside whatever ground it resolved to, because a permit is
 * a legal document and the label on it is the club's evidence.
 */
export const PermitWindowSchema = z
  .object({
    id: IdSchema,
    permitId: IdSchema,
    venueIds: z.array(IdSchema).default([]),
    surfaceIds: z.array(IdSchema).default([]),
    /** The permit's own spelling of the ground. Never normalised away. */
    facilityLabel: z.string().min(1),
    date: IsoDateSchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema,
    /** `Field Lights`, `Restroom Use`, ... - documentary evidence, not a flag. */
    services: z.array(z.string().min(1)).default([]),
    source: z.literal(RECORD_SOURCE.PERMIT),
  })
  .strict()
  .refine((window) => window.endMinutes >= window.startMinutes, {
    message: 'a permit window endMinutes must not precede startMinutes',
    path: ['endMinutes'],
  });

/**
 * What a venue holds, as the inventory sheet states it.
 *
 * **Venue-keyed, and the payload is prose.** `PHASE_8_PLAN.md` §8.4 describes
 * `field_inventory.csv` as surface attributes; the file has no field or surface
 * column at all, and its `field_sizes` cell is written as `11v11 (4) 9v9 (8)`
 * or `9v9 (1) 7v7 (2) upper (+ lower)`. Parsing that into structured sizes
 * would be guessing, and two of the fourteen rows are the sentinels `XX` and
 * `??`. So the cell is carried verbatim and the row is marked doubtful; a
 * later reader may overrule it, which is the whole reason the raw is kept.
 */
export const VenueAttributesSchema = z
  .object({
    id: IdSchema,
    venueIds: z.array(IdSchema).default([]),
    /** The corpus spelling, kept because it is how the sheet names the place. */
    venueLabel: z.string().min(1),
    fieldSizesText: nullableText(z.string()),
    ageGroupsText: nullableText(z.string()),
    practiceMaxTeamsText: nullableText(z.string()),
    bathroomText: nullableText(z.string()),
    notesText: nullableText(z.string()),
    equipment: z
      .array(z.object({ item: z.string().min(1), value: z.string().min(1) }).strict())
      .default([]),
    source: z.enum(enumValues(RECORD_SOURCE)),
  })
  .strict();

/**
 * One decoder-ring row: a published field name over ground.
 *
 * Both rings produce these, and where they disagree **both are kept**. Nothing
 * in this module prefers one ring over the other.
 */
export const AliasRecordSchema = z
  .object({
    id: IdSchema,
    displayName: z.string().min(1),
    /**
     * The whole label the sheet writes; `null` when the cell is blank.
     *
     * Through `nullableText` like every other nullable column: it was the one
     * left out, and `z.string().min(1).nullable()` **throws** on `''` rather
     * than reading it as the absence it is. A single empty `actual_label` cell
     * therefore took the whole import down - all five change sets - instead of
     * producing one blank-labelled alias.
     */
    label: nullableText(z.string()),
    venueIds: z.array(IdSchema).default([]),
    surfaceIds: z.array(IdSchema).default([]),
    /** The source's own doubt - the fields ring writes `?`. */
    uncertain: z.boolean().default(false),
    source: z.enum(enumValues(RECORD_SOURCE)),
  })
  .strict();

/**
 * Every schema a projector may emit, by the subject kind it belongs to.
 *
 * A `Map` rather than an object literal: a subject kind is a string that can
 * come from data, and `constructor` must not resolve to anything.
 */
/**
 * Typed up front rather than cast afterwards: an array literal of differently
 * shaped Zod objects infers as a union of tuples, and `new Map()` then has no
 * overload that accepts it.
 *
 * @type {Array<[string, import('zod').ZodTypeAny]>}
 */
const SUBJECT_SCHEMA_ENTRIES = [
  ['blackout', BlackoutWindowSchema],
  ['recurring-window', RecurringWindowSchema],
  ['permit-window', PermitWindowSchema],
  ['venue-attributes', VenueAttributesSchema],
  ['alias', AliasRecordSchema],
];

export const SUBJECT_SCHEMAS = new Map(SUBJECT_SCHEMA_ENTRIES);

/** Every subject kind this module models, sorted. */
export const SUBJECT_KINDS = Object.freeze([...SUBJECT_SCHEMAS.keys()].sort());

/**
 * The schema for one subject kind, or a throw naming the union.
 *
 * @param {string} kind
 * @returns {import('zod').ZodTypeAny}
 */
export function schemaForSubjectKind(kind) {
  const schema = SUBJECT_SCHEMAS.get(kind);
  if (!schema) {
    throw new Error(
      `fieldAdmin: subject kind "${kind}" has no schema; add one beside its neighbours in SUBJECT_SCHEMAS (${SUBJECT_KINDS.join(', ')})`
    );
  }
  return schema;
}

/**
 * Zod schemas for what this module is asked about.
 *
 * `.strict()` throughout, matching `facility/schemas.js`, `timing/schemas.js`,
 * `availability/schemas.js`, `attribution/schemas.js`, `feasibility/schemas.js`
 * and `fairness/schemas.js`, and deliberately unlike
 * `packages/core/src/schemas/index.js`, whose blanket `.passthrough()` is what
 * let four copies of the slot model drift apart without anything failing
 * (`docs/ARCHITECTURE.md` §1.1).
 *
 * ## No `Date`, anywhere, and this is the module where that matters most
 *
 * Every date is a `YYYY-MM-DD` string and every time is minutes past local
 * midnight (GAP-30). This module is the one that **serialises and reads back**,
 * so it is the one where a `z.coerce.date()` would do its damage: a mapping
 * registry round-tripped through a timezone-lossy schema comes back describing
 * different ground on the two corpus dates that fall after DST ends, and the
 * import would then report a difference it had itself created. See
 * {@link MappingDocumentSchema} and `mapping.js`.
 *
 * ## Why the imported rows are parsed here
 *
 * Same reason `fairness/schemas.js` parses its fixture list: a report's whole
 * correctness rests on fields a loose object may omit, and `venueLabel` absent
 * and `venueLabel: null` mean opposite things — *"you forgot"* and *"this
 * publication states no venue"*. A `.passthrough()` schema cannot tell them
 * apart, and the second is a row that must be classified `undecidable` rather
 * than silently compared on the fields that did arrive.
 *
 * @module externalImport/schemas
 */

import { z } from 'zod';

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction (GAP-30). */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Minutes past local midnight. Not capped at 1440: a fixture may run past it. */
const MinutesSchema = z.number().int().min(0);

/**
 * The two kinds of name a mapping record can translate.
 *
 * A plain string rather than a `z.enum()` for the reason
 * `FairnessFixtureSchema.competition` is one: an unrecognised kind must reach
 * `buildExternalMappingRegistry()` and be refused there with a code and a count,
 * which is an answer a caller can act on, rather than as a parse error naming a
 * field path.
 */
const MappingKindSchema = z.string().min(1);

/**
 * **One mapping record.** A record, not a rule: it is stated by somebody, on a
 * date, from a source, and it is the unit a future store would hold.
 *
 * `externalLabel` is the label **exactly as the other party writes it**,
 * including its parentheses and its capitalisation. Nothing here strips a word
 * from it; see `mapping.js#normaliseExternalLabel`.
 *
 * `venueId` and `surfaceId` are both required for a `venue` record because the
 * external league's single cell (`Alder Park (Back Pitch 2)`) carries both of
 * ours, and splitting it *is* the mapping. A record that named only the venue
 * would leave the field to be guessed at somewhere downstream.
 */
export const ExternalMappingRecordSchema = z
  .object({
    id: IdSchema,
    kind: MappingKindSchema,
    /** The other party's label, verbatim. */
    externalLabel: z.string().min(1),
    /** For `venue` records. Null on a `participant` record. */
    venueId: IdSchema.nullable().default(null),
    /** For `venue` records. Null on a `participant` record. */
    surfaceId: IdSchema.nullable().default(null),
    /** For `participant` records. Null on a `venue` record. */
    subjectId: IdSchema.nullable().default(null),
    /** Where this record came from. Prose; required, and never empty. */
    provenance: z.string().min(1),
    /** Who stated it. Null where the source is a document rather than a person. */
    statedBy: z.string().min(1).nullable().default(null),
    /** When, as a naive `YYYY-MM-DD` string. Never a `Date` (GAP-30). */
    statedOn: IsoDateSchema.nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict();

/**
 * The input a registry is built from.
 *
 * `records` may be empty, and an empty registry is reported as
 * `EXTERNAL_MAPPING_REGISTRY_EMPTY` at blocking rather than rejected at the
 * boundary — the same choice `fairness/schemas.js` makes about an unrecognised
 * competition, for the same reason: an operator needs to be told that the table
 * they are importing against is empty, not that field `records` failed `min(1)`.
 */
export const ExternalMappingRegistryInputSchema = z
  .object({
    registryId: IdSchema,
    label: z.string().min(1),
    /** Which external party's naming this registry translates. */
    party: z.string().min(1),
    records: z.array(ExternalMappingRecordSchema).default([]),
  })
  .strict();

/**
 * **The serialised form of a registry** — the persistence seam, and the only
 * shape a store would ever hold.
 *
 * Deliberately the same field names as the registry itself plus a `version`, so
 * that reading a document is validation rather than translation. Everything in
 * it is a JSON primitive; there is no `Date`, no `Map`, and no function, which
 * is the property `serialiseExternalMappingRegistry()` exists to keep true and a
 * round-trip test asserts.
 */
export const MappingDocumentSchema = z
  .object({
    version: z.literal(1),
    registryId: IdSchema,
    label: z.string().min(1),
    party: z.string().min(1),
    records: z.array(ExternalMappingRecordSchema),
  })
  .strict();

/**
 * **One row of the other party's publication**, as this module needs to see it.
 *
 * Every field is required and explicitly nullable where null is a real answer.
 * `format` and `division` are nullable because
 * `external_fixtures_published.csv` has no such columns at all — and a null here
 * makes those fields **uncompared** and says so, rather than comparing them
 * against ours and calling every row different.
 */
export const ExternalFixtureRowSchema = z
  .object({
    rowId: IdSchema,
    /** Which artifact this row came from. Provenance; never keyed. */
    sourceLabel: z.string().min(1),
    date: IsoDateSchema.nullable(),
    kickoffMinutes: MinutesSchema.nullable(),
    /** The venue cell exactly as published. Null where the row carries none. */
    venueLabel: z.string().min(1).nullable(),
    homeLabel: z.string().min(1).nullable(),
    awayLabel: z.string().min(1).nullable(),
    /** Null where the publication states no format — the corpus's case. */
    format: z.string().min(1).nullable().default(null),
    /** Null where the publication states no division — the corpus's case. */
    division: z.string().min(1).nullable().default(null),
  })
  .strict();

/**
 * **One fixture of ours**, as this module needs to see it.
 *
 * `endMinutes` is nullable and that null is load bearing: it is GAP-14, the
 * corpus's untimed `Scrimmage` rows, and it is what makes an impact verdict
 * `undetermined` instead of `safe`.
 */
export const StandingFixtureSchema = z
  .object({
    fixtureId: IdSchema,
    date: IsoDateSchema,
    kickoffMinutes: MinutesSchema,
    /** Null when the footprint is unknown (GAP-14). Never a guessed number. */
    endMinutes: MinutesSchema.nullable(),
    venueId: IdSchema,
    surfaceId: IdSchema,
    format: z.string().min(1).nullable(),
    division: z.string().min(1).nullable(),
    homeLabel: z.string().min(1).nullable(),
    awayLabel: z.string().min(1).nullable(),
  })
  .strict();

/**
 * *"What is in this publication, against what we hold?"*
 *
 * `keyFields` and `comparedFields` are inputs rather than constants because the
 * honest comparison depends on what the other party's artifact carries, and
 * `publication/adapters/season2026Publication.js` already learned that the hard
 * way: the external file has no `Format` and no `Division`, so comparing them
 * would be comparing against `null`.
 */
export const ExternalImportQuerySchema = z
  .object({
    subject: z.string().min(1),
    rows: z.array(ExternalFixtureRowSchema).default([]),
    standing: z.array(StandingFixtureSchema).default([]),
    /** Identity of a fixture. Defaults to the family-facing three. */
    keyFields: z.array(z.string().min(1)).default(['date', 'home', 'away']),
    /** What a match is then checked on. */
    comparedFields: z.array(z.string().min(1)).default(['kickoffMinutes', 'venueId', 'surfaceId']),
  })
  .strict();

/**
 * *"If we accepted these rows, what would break?"*
 *
 * `acceptedRowIds` is required and has no default. There is deliberately no
 * "accept everything" default: the whole finding of this module is that a
 * verdict belongs to an acceptance **set**, and a default set would be this
 * module quietly choosing one and then answering about it.
 */
export const ImpactQuerySchema = z
  .object({
    acceptedRowIds: z.array(IdSchema),
    /** Restrict the projection to these dates. Empty means the import's own. */
    dates: z.array(IsoDateSchema).default([]),
  })
  .strict();

/**
 * *"What must the other party avoid when they publish?"*
 *
 * `surfaceIds` is the scope. An empty scope is reported as
 * `EXTERNAL_AVOID_SCOPE_EMPTY` at blocking rather than answered with an empty
 * document — a document saying "avoid nothing" is the worst possible thing to
 * send an external league, and it is what a vacuous query would produce.
 */
export const AvoidWindowQuerySchema = z
  .object({
    subject: z.string().min(1),
    documentId: IdSchema,
    /** Who this is being sent to. Carried on the document. */
    generatedFor: z.string().min(1),
    dates: z.array(IsoDateSchema).default([]),
    surfaceIds: z.array(IdSchema).default([]),
    /**
     * Fixtures to leave out of the windows — normally the other party's own,
     * which they are not being asked to avoid. Never defaulted to a guess about
     * which those are.
     */
    excludeFixtureIds: z.array(IdSchema).default([]),
  })
  .strict();

/**
 * The document shape that crosses the wire, and comes back.
 *
 * Deliberately expressible in the other party's vocabulary alone: every window
 * names an `externalLabel`, and the internal ids ride alongside as provenance
 * the recipient may ignore. `readAvoidWindowDocument()` resolves the labels
 * *forward* through the same registry that produced them, so a document is
 * readable by anyone holding the registry and by nobody holding a heuristic.
 */
export const AvoidWindowDocumentSchema = z
  .object({
    version: z.literal(1),
    documentId: IdSchema,
    subject: z.string().min(1),
    generatedFor: z.string().min(1),
    party: z.string().min(1),
    dates: z.array(IsoDateSchema),
    windows: z.array(
      z
        .object({
          date: IsoDateSchema,
          externalLabel: z.string().min(1),
          startMinutes: MinutesSchema,
          /** Null for an open-ended window. Never closed by a guess (GAP-14). */
          endMinutes: MinutesSchema.nullable(),
          /**
           * Naive `YYYY-MM-DDTHH:MM:SS`, rendered by `reserve/publication.js`
           * `naiveDateTime()` — the one GAP-30-safe renderer in this repository,
           * reused rather than restated, exactly as `publication/notices.js`
           * reuses it.
           */
          startAt: z.string().min(1),
          endAt: z.string().min(1).nullable(),
          origin: z.string().min(1),
          sourceFixtureIds: z.array(IdSchema),
          sourceSurfaceIds: z.array(IdSchema),
        })
        .strict()
    ),
  })
  .strict();

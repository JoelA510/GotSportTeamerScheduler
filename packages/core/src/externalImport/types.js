/**
 * Types for external fixture import, impact analysis and the avoid-windows
 * round trip.
 *
 * JSDoc typedefs only — this file emits no runtime code.
 *
 * @module externalImport/types
 */

/**
 * One finding, in the shape every module in this repository uses.
 *
 * @typedef {Object} ExternalImportFinding
 * @property {string} code - an `EXTERNAL_IMPORT_REASON` value
 * @property {string} severity - looked up from the frozen table, never passed in
 * @property {string} message - for humans only; never parsed
 * @property {Record<string, unknown>} details - flat primitives and ids
 */

/**
 * Additive counters. See `createExternalImportMeta()` for what each one means.
 *
 * @typedef {Object} ExternalImportMeta
 * @property {number} mappingRecordsDeclared
 * @property {number} mappingRecordsExercised
 * @property {number} labelLookups
 * @property {number} labelsResolved
 * @property {number} labelsUnresolved
 * @property {number} labelsUnclaimedOptional
 * @property {number} labelsAmbiguous
 * @property {number} standingLabelLookups
 * @property {number} standingRecordsExercised
 * @property {number} rowsRead
 * @property {number} rowsClassified
 * @property {number} rowsMatchedIdentical
 * @property {number} rowsMatchedDiffering
 * @property {number} rowsUnmatched
 * @property {number} rowsUndecidable
 * @property {number} fieldComparisons
 * @property {number} fieldsUncompared
 * @property {number} fieldsOneSided
 * @property {number} fieldsUntranslated
 * @property {number} acceptanceSetsExamined
 * @property {number} fixturesProjected
 * @property {number} bookingPairsCompared
 * @property {number} bookingPairsUndecidable
 * @property {number} clashesIntroduced
 * @property {number} clashesResolved
 * @property {number} clashesPreexisting
 * @property {number} avoidScopeCells
 * @property {number} avoidWindowsExported
 * @property {number} avoidWindowsFromOverlap
 * @property {number} avoidWindowsOpenEnded
 * @property {number} avoidWindowsReadBack
 */

/**
 * One mapping record, after validation.
 *
 * @typedef {Object} ExternalMappingRecord
 * @property {string} id
 * @property {string} kind - an `EXTERNAL_MAPPING_KIND` value
 * @property {string} externalLabel - the other party's label, verbatim
 * @property {string|null} venueId
 * @property {string|null} surfaceId
 * @property {string|null} subjectId
 * @property {string} provenance
 * @property {string|null} statedBy
 * @property {string|null} statedOn - naive `YYYY-MM-DD`; never a `Date`
 * @property {string|null} note
 */

/**
 * A built registry.
 *
 * `durability` is on the record, exactly as `PublicationSnapshot.durability` is,
 * so a consumer cannot mistake this for something that survives a process.
 *
 * @typedef {Object} ExternalMappingRegistry
 * @property {string} registryId
 * @property {string} label
 * @property {string} party
 * @property {ReadonlyArray<ExternalMappingRecord>} records
 * @property {string} durability - an `EXTERNAL_MAPPING_DURABILITY` value
 * @property {ExternalImportFinding[]} findings - built once, at construction
 * @property {string} status
 * @property {ExternalImportMeta} meta
 */

/**
 * The answer to one label lookup. Three-valued, always.
 *
 * @typedef {Object} ExternalNameResolution
 * @property {string} kind
 * @property {string} label - as asked
 * @property {string} normalisedKey - what it was looked up under
 * @property {string} state - an `EXTERNAL_NAME_RESOLUTION` value
 * @property {ExternalMappingRecord|null} record - the one that claimed it
 * @property {string|null} venueId
 * @property {string|null} surfaceId
 * @property {string|null} subjectId
 * @property {string[]} candidateRecordIds - every record that claimed the key
 * @property {string[]} candidateTargets - what each of them named
 */

/**
 * One field's difference, with its magnitude.
 *
 * `deltaMinutes` is non-null only for a minutes-valued field, and is signed:
 * positive means the imported row is *later* than ours. "Changed" without "by
 * how much" is the answer 7.1 exists to replace.
 *
 * @typedef {Object} ExternalFieldDifference
 * @property {string} field
 * @property {unknown} ours
 * @property {unknown} theirs
 * @property {number|null} deltaMinutes
 */

/**
 * One classified row. The evidence is the point: what matched, on what key, and
 * what differs by how much.
 *
 * @typedef {Object} ExternalRowResolution
 * @property {string} rowId
 * @property {string} sourceLabel
 * @property {string} rowClass - an `EXTERNAL_ROW_CLASS` value
 * @property {string|null} reasonCode - null only on a decided, agreeing row
 * @property {string} matchKey - the key this row was looked up under
 * @property {ReadonlyArray<{ field: string, value: unknown }>} matchedOn
 * @property {string|null} fixtureId - our fixture, when exactly one matched
 * @property {string[]} candidateFixtureIds - every fixture the key named
 * @property {ExternalNameResolution|null} venue - null when the row states none
 * @property {ExternalFieldDifference[]} differences
 * @property {string[]} comparedFields - fields both sides carried
 * @property {string[]} uncomparedFields - every field left out of the comparison
 * @property {string[]} oneSidedFields - those of them exactly one side carried
 * @property {string[]} untranslatedFields - those the publication stated in a vocabulary no mapping record translates
 * @property {Readonly<Record<string, string>>} fieldPresence - the `EXTERNAL_FIELD_PRESENCE` observed per requested field, on **this** row; the four lists above are derived from it
 * @property {boolean} acceptable - may this row be named in an acceptance set?
 */

/**
 * The whole classification pass.
 *
 * @typedef {Object} ExternalImportResolution
 * @property {string} subject
 * @property {string[]} keyFields
 * @property {string[]} comparedFields
 * @property {ExternalRowResolution[]} rows
 * @property {Record<string, string[]>} byClass - row ids per `EXTERNAL_ROW_CLASS`
 * @property {ReadonlyArray<ExternalMappingRecord>} unexercisedRecords
 * @property {ExternalImportFinding[]} findings
 * @property {string} status
 * @property {ExternalImportMeta} meta
 */

/**
 * A projected fixture: ours, with an accepted row's values folded in.
 *
 * @typedef {Object} ProjectedFixture
 * @property {string} fixtureId
 * @property {string} date
 * @property {number} kickoffMinutes
 * @property {number|null} endMinutes
 * @property {string} venueId
 * @property {string} surfaceId
 * @property {string|null} format
 * @property {string|null} division
 * @property {string|null} homeLabel
 * @property {string|null} awayLabel
 * @property {string|null} movedByRowId - null when this fixture is untouched
 * @property {number|null} kickoffDeltaMinutes
 */

/**
 * One acceptance set's impact.
 *
 * @typedef {Object} ExternalImpactResult
 * @property {string} subject
 * @property {string[]} acceptedRowIds - sorted, so two sets compare by id
 * @property {string} setKey - a stable rendering of the set
 * @property {string[]} dates - the projection's scope
 * @property {string} verdict - an `EXTERNAL_IMPACT_VERDICT` value
 * @property {ProjectedFixture[]} moved
 * @property {ExternalImportFinding[]} introduced
 * @property {ExternalImportFinding[]} resolved
 * @property {ExternalImportFinding[]} preexisting
 * @property {ExternalImportFinding[]} findings - everything the result publishes
 * @property {string} status
 * @property {ExternalImportMeta} meta
 */

/**
 * A sweep over several acceptance sets, and what it found about subsets.
 *
 * @typedef {Object} ExternalAcceptanceSweep
 * @property {string} subject
 * @property {string[]} domainRowIds - the rows whose acceptance could change anything
 * @property {boolean} exhaustive - were all 2^n sets examined?
 * @property {number} setsPossible
 * @property {ExternalImpactResult[]} results
 * @property {string[]} safeSetKeys
 * @property {string[]} unsafeSetKeys
 * @property {string[]} undeterminedSetKeys
 * @property {ExternalImportFinding[]} findings
 * @property {string} status
 * @property {ExternalImportMeta} meta
 */

/**
 * One window the other party must avoid.
 *
 * @typedef {Object} AvoidWindow
 * @property {string} date
 * @property {string} externalLabel
 * @property {string} venueId
 * @property {string} surfaceId - the surface the window is published *for*
 * @property {number} startMinutes
 * @property {number|null} endMinutes - null for an open-ended window (GAP-14)
 * @property {string} startAt - naive datetime, from `naiveDateTime()`
 * @property {string|null} endAt
 * @property {string} origin - an `EXTERNAL_AVOID_ORIGIN` value
 * @property {string[]} sourceFixtureIds
 * @property {string[]} sourceSurfaceIds - the ground actually in use
 */

/**
 * @typedef {Object} AvoidWindowExport
 * @property {string} subject
 * @property {Object} document - an `AvoidWindowDocumentSchema` value
 * @property {AvoidWindow[]} windows
 * @property {Array<{ surfaceId: string, reason: string }>} excludedSurfaces - every scope surface that produced no window, with its `EXTERNAL_AVOID_EXCLUSION` cause; `buildAvoidWindows()` asserts this partitions the scope against the surfaces that did produce one, so the promise is checked and not merely written here
 * @property {string[]} excludedSurfaceIds - all of them, whatever the cause
 * @property {string[]} unmappedSurfaceIds - no record claims them: write one
 * @property {string[]} ambiguousSurfaceIds - two records claim them: delete one
 * @property {string[]} unknownSurfaceIds - named, but not in the facility graph
 * @property {string[]} idleSurfaceIds - mapped and in the graph; nothing occupied them or ground overlapping them on the requested dates
 * @property {ExternalImportFinding[]} findings
 * @property {string} status
 * @property {ExternalImportMeta} meta
 */

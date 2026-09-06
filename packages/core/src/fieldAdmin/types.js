/**
 * Typedefs for field and blackout administration.
 *
 * Types only; no runtime export. `checkJs` reads these, so a shape that drifts
 * from its producer fails `npm run typecheck` rather than a reader.
 *
 * @module fieldAdmin/types
 */

/**
 * @typedef {Object} FieldAdminFinding
 * @property {string} code - a `FIELD_ADMIN_REASON` value
 * @property {string} severity - a `FIELD_ADMIN_SEVERITY` value
 * @property {string} message - for humans; never parsed
 * @property {Record<string, unknown>} details
 */

/**
 * @typedef {Object} FieldAdminMeta
 * @property {number} sourceRowsRead
 * @property {number} rowsInterpreted
 * @property {number} rowsDoubtful
 * @property {number} rowsUnresolvable
 * @property {number} currentSubjectsRead
 * @property {number} projectedSubjects
 * @property {number} subjectsMatched
 * @property {number} subjectsDiffering
 * @property {number} subjectsAdded
 * @property {number} subjectsRemoved
 * @property {number} subjectsUncompared
 * @property {number} fieldComparisons
 * @property {number} sourceComparisons
 * @property {number} subjectsWithSourceDisagreement
 * @property {number} subjectsApplicable
 */

/**
 * One source row, read into a domain record or refused.
 *
 * **`raw` is the point of this whole type.** The corpus's most instructive
 * cells are the ones the sheet got wrong -- Excel turned `4-7` into
 * `2026-04-07` in 15 rows of `field_weekly_availability.csv`, and `1-7` into
 * `2026-01-07` in the Gardening Day row of `field_constraints.csv`. An operator
 * troubleshooting a bad import needs to see what the sheet said *and* why the
 * importer read it that way, side by side.
 *
 * @typedef {Object} ProjectedRow
 * @property {string} sourceFile - e.g. `field_constraints.csv`
 * @property {number} rowIndex - 0-based within that file
 * @property {string} subjectKey - what this row is about; the join key
 * @property {string} interpretation - an `INTERPRETATION` value
 * @property {string|null} interpretationReason - why, when not plainly interpreted
 * @property {Record<string, unknown>} raw - the source cells, verbatim
 * @property {Record<string, unknown>|null} record - the domain record, or `null`
 */

/**
 * One subject after both sides are compared.
 *
 * @typedef {Object} ChangeSetSubject
 * @property {string} key
 * @property {string} label - for humans
 * @property {string} disposition - a `DISPOSITION` value
 * @property {number} heldCount - how many held records this subject stands for;
 *   0 when nothing is held, and more than 1 when the key does not identify one
 * @property {string[]} changedFields - non-empty exactly when `differing`
 * @property {string[]} absentFields - fields one side does not carry
 * @property {Record<string, unknown>|null} before - current state, or `null` when added
 * @property {Record<string, unknown>|null} after - proposed, or `null` when removed
 * @property {ProjectedRow[]} rows - every source row that named this subject
 * @property {SourceDisagreement|null} sourceDisagreement
 * @property {boolean} applicable - false whenever a human must decide first
 * @property {string|null} notApplicableReason
 */

/**
 * Two sources describing one subject and saying different things.
 *
 * `kind` reuses `facility/aliases.js`'s `ALIAS_LABEL_AGREEMENT` vocabulary
 * verbatim for ring subjects rather than minting a third enum beside it and
 * `season2026PracticeParsers.js`'s `DECODER_DISAGREEMENT_KIND`.
 *
 * @typedef {Object} SourceDisagreement
 * @property {string} kind
 * @property {string} field - the compared field the sources differ on
 * @property {string[]} sources - which sources spoke, in reading order
 * @property {Array<string|null>} values - what each said, positionally
 */

/**
 * @typedef {Object} ChangeSetPartition
 * @property {ChangeSetSubject[]} matched
 * @property {ChangeSetSubject[]} differing
 * @property {ChangeSetSubject[]} added
 * @property {ChangeSetSubject[]} removed
 * @property {ChangeSetSubject[]} uncompared
 * @property {ProjectedRow[]} unresolvable
 * @property {number} fieldComparisons
 */

/**
 * @typedef {Object} ChangeSet
 * @property {string} subject - what this change set is of, in words
 * @property {string} currentLabel
 * @property {string} proposedLabel
 * @property {string[]} keyFields
 * @property {string[]} comparedFields
 * @property {ChangeSetPartition} buckets
 * @property {FieldAdminFinding[]} findings
 * @property {string} status - a `FIELD_ADMIN_STATUS` value
 * @property {FieldAdminMeta} meta
 */

export {};

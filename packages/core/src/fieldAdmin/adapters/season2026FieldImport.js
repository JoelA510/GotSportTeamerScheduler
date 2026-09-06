/**
 * **Importing `fixtures/season-2026/practice/` as a reviewable change set.**
 *
 * One entry point, {@link importSeason2026Fields}, so "importing the corpus"
 * has a single meaning and every caller compares the same fields on the same
 * keys. A change set's `keyFields` and `comparedFields` decide what the word
 * "disagreement" means, and letting each caller choose them is how the same
 * import produces two different answers.
 *
 * This module reads nothing from disk. It takes the already-parsed corpus - the
 * 8.0 loader's output - the facility graph and the venue-complex map, and
 * returns change sets. The arrow points `fixtures -> fieldAdmin`, never back.
 *
 * ## Why the rings compare `label` and nothing else
 *
 * The acceptance criterion counts **decoder-ring disagreements**, and that is a
 * comparison of what each ring *calls* the ground - the sheets' `actual_label`
 * column, and nothing else. It is the comparison `compareDecoderRings()` makes
 * in the loader and the one `ALIAS_LABEL_AGREEMENT` describes in
 * `facility/aliases.js`; both count 12.
 *
 * `compareDecoderRings()` is the **single producer** of "decoder-ring
 * disagreement". Comparing a different set of fields here would be a second
 * producer of one derived status, which is the defect Phase 8.0's first review
 * round already found once - so the scope is not a preference, it is the one
 * the existing producer sets.
 *
 * Adding `venueIds` or `surfaceIds` to the compared set silently redefines the
 * word and breaks the count. It was measured rather than reasoned about: with
 * ground in the comparison the change set reports **13** differing subjects,
 * because `11v11 Field 1` has both rings writing the label `Willowmead Park
 * Turf` while the practice ring leaves the venue cell blank - so the labels
 * agree and the reachable ground does not. That is a real fact and it is worth
 * reporting, but it is not a *decoder-ring disagreement*, and folding it into
 * that count would make 12 mean two things at once.
 *
 * It is reported instead on the **interpretation axis**, where it belongs: the
 * practice ring's blank venue makes that row `doubtful` with the reason spelled
 * out, so the subject is non-applicable and an operator sees it. Nothing is
 * lost; it is filed under the right heading.
 *
 * @module fieldAdmin/adapters/season2026FieldImport
 */

import { buildChangeSet } from '../changeSet.js';
import { labelAgreementOf, projectFieldsRing, projectPracticeRing } from '../projectors/rings.js';
import { projectFieldConstraints } from '../projectors/constraints.js';
import { projectWeeklyAvailability } from '../projectors/weeklyAvailability.js';
import { projectPermitReservations } from '../projectors/permits.js';
import { projectVenueAttributes } from '../projectors/inventory.js';

/**
 * What each subject kind keys on and compares, frozen in one place.
 *
 * `keyFields` and `comparedFields` are disjoint by construction, and
 * `buildChangeSet()` throws if they are not: a field that is both the identity
 * and the comparison can only ever compare equal, which is the shape the Phase
 * 2 review found in the flagship "examined every division" check.
 *
 * @type {Readonly<Record<string, { subject: string, keyFields: ReadonlyArray<string>, comparedFields: ReadonlyArray<string> }>>}
 */
export const SEASON_2026_SUBJECTS = Object.freeze({
  aliases: Object.freeze({
    subject: 'the two decoder rings',
    keyFields: Object.freeze(['displayName']),
    // Label only. See the module docstring: ground is compared on the
    // interpretation axis, not folded into the disagreement count.
    comparedFields: Object.freeze(['label']),
  }),
  blackouts: Object.freeze({
    subject: 'field blackout windows from the constraint log',
    keyFields: Object.freeze(['id']),
    comparedFields: Object.freeze([
      'scope',
      'venueIds',
      'surfaceIds',
      'fromDate',
      'toDate',
      'startMinutes',
      'endMinutes',
      'reason',
    ]),
  }),
  recurringWindows: Object.freeze({
    subject: 'recurring availability from the weekly sheet',
    keyFields: Object.freeze(['id']),
    comparedFields: Object.freeze([
      'venueIds',
      'isoWeekday',
      'startMinutes',
      'endMinutes',
      'available',
    ]),
  }),
  permitWindows: Object.freeze({
    subject: 'permit reservations',
    keyFields: Object.freeze(['id']),
    comparedFields: Object.freeze([
      'permitId',
      'venueIds',
      'surfaceIds',
      'facilityLabel',
      'date',
      'startMinutes',
      'endMinutes',
      'services',
    ]),
  }),
  venueAttributes: Object.freeze({
    subject: 'venue attributes from the inventory and equipment sheets',
    keyFields: Object.freeze(['venueLabel']),
    comparedFields: Object.freeze([
      'venueIds',
      'fieldSizesText',
      'ageGroupsText',
      'practiceMaxTeamsText',
      'bathroomText',
      'notesText',
      'equipment',
    ]),
  }),
});

/** Every subject this import produces, sorted. */
export const SEASON_2026_SUBJECT_NAMES = Object.freeze(Object.keys(SEASON_2026_SUBJECTS).sort());

/**
 * Everything one import produces.
 *
 * Spelled out rather than typed as a bag of change sets, because `closureSet`
 * is not one and a caller reading it as one would be reaching for buckets that
 * are not there.
 *
 * @typedef {Object} Season2026FieldImport
 * @property {import('../types.js').ChangeSet} aliases
 * @property {import('../types.js').ChangeSet} blackouts
 * @property {import('../types.js').ChangeSet} recurringWindows
 * @property {import('../types.js').ChangeSet} permitWindows
 * @property {import('../types.js').ChangeSet} venueAttributes
 * @property {import('../../availability/types.js').ClosureSet} closureSet
 */

/**
 * Build one change set from a subject definition.
 *
 * @param {string} name - a key of {@link SEASON_2026_SUBJECTS}
 * @param {ReadonlyArray<import('../types.js').ProjectedRow>} rows
 * @param {ReadonlyArray<Record<string, unknown>>} held
 * @param {string} heldLabel
 * @param {((rows: ReadonlyArray<import('../types.js').ProjectedRow>) => string)} [disagreementKind]
 * @returns {import('../types.js').ChangeSet}
 */
function changeSetFor(name, rows, held, heldLabel, disagreementKind) {
  const definition = Object.prototype.hasOwnProperty.call(SEASON_2026_SUBJECTS, name)
    ? SEASON_2026_SUBJECTS[name]
    : null;
  if (!definition) {
    throw new Error(
      `fieldAdmin season2026: "${name}" is not a declared subject; add one beside its neighbours in SEASON_2026_SUBJECTS (${SEASON_2026_SUBJECT_NAMES.join(', ')})`
    );
  }
  return buildChangeSet({
    subject: definition.subject,
    current: { label: heldLabel, records: held },
    proposed: { label: 'fixtures/season-2026/practice/', rows },
    keyFields: definition.keyFields,
    comparedFields: definition.comparedFields,
    disagreementKind,
  });
}

/**
 * **Import the practice corpus as a proposal.**
 *
 * `held` is what the organisation already has, per subject. It defaults to
 * empty on every subject, which is the first-import case - and the default is
 * spelled out rather than implied, because an empty held set makes every
 * subject `added` or `differing` and a caller who did not mean that should see
 * why.
 *
 * @param {Object} input
 * @param {Object} input.practice - the 8.0 loader's `loadSeason2026Practice()` result
 * @param {import('../../facility/types.js').FacilityGraph} input.graph
 * @param {import('../../facility/types.js').VenueComplexMap} input.complexMap
 * @param {Partial<Record<string, ReadonlyArray<Record<string, unknown>>>>} [input.held]
 * @param {string} [input.heldLabel]
 * @returns {Season2026FieldImport}
 */
export function importSeason2026Fields({
  practice,
  graph,
  complexMap,
  held = {},
  heldLabel = 'current organisation state',
}) {
  const aliasRows = [
    // Practice ring first: it is the **driver**, and `labelAgreementOf()`
    // decides `blank-vs-label` from the driver's label alone, exactly as
    // `compareDecoderRings()` and `facility/aliases.js` both do. Swapping the
    // order would change one of the 12 from `blank-vs-label` to
    // `label-conflict` and the composition would silently move.
    ...projectPracticeRing(practice.fieldAliases, graph, complexMap),
    ...projectFieldsRing(practice.fieldCodeNames, graph, complexMap),
  ];
  const { rows: blackoutRows, closureSet } = projectFieldConstraints(
    practice.fieldConstraints,
    graph,
    complexMap
  );

  return Object.freeze({
    aliases: changeSetFor('aliases', aliasRows, held.aliases ?? [], heldLabel, labelAgreementOf),
    blackouts: changeSetFor('blackouts', blackoutRows, held.blackouts ?? [], heldLabel),
    recurringWindows: changeSetFor(
      'recurringWindows',
      projectWeeklyAvailability(practice.weeklyAvailability, graph, complexMap),
      held.recurringWindows ?? [],
      heldLabel
    ),
    permitWindows: changeSetFor(
      'permitWindows',
      projectPermitReservations(practice.permitReservations, graph, complexMap),
      held.permitWindows ?? [],
      heldLabel
    ),
    venueAttributes: changeSetFor(
      'venueAttributes',
      projectVenueAttributes(practice.fieldInventory, practice.fieldEquipment, graph, complexMap),
      held.venueAttributes ?? [],
      heldLabel
    ),
    // Carried out so a caller can reconcile the adjacency row against the
    // graph's overlap pairs without rebuilding the closure set, and so the
    // `CLOSURE_SET_UNWIRED` declaration reaches the caller's findings rather
    // than being swallowed here.
    closureSet,
  });
}

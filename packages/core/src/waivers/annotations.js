/**
 * Waiver annotations for published output.
 *
 * The requirement, from the build plan:
 *
 * > Waivers appear in published output as annotations on the affected rows.
 *
 * This module supplies the annotation **data**, keyed by the row id the caller
 * used as a subject id, in a shape `outputGeneration.js` can consume without
 * knowing anything about waivers. It deliberately does **not** rewire
 * `generateScheduleExports()`: that function is the published-CSV contract, the
 * diff for this phase is additive, and wiring is a follow-up that belongs with
 * whichever phase owns the export surface.
 *
 * The intended wiring, when it happens, is one line at the row-building site:
 * the `Notes` cell already exists in `MASTER_HEADERS`, and
 * {@link waiverNotesBySubject} returns exactly what belongs in it. Anything
 * richer — a badge, a hover card, a filter — has the structured
 * {@link import('./types.js').WaiverAnnotation} beside the sentence so it never
 * has to parse the sentence.
 *
 * @module waivers/annotations
 */

/** Separator between two notes on one row. */
export const NOTE_SEPARATOR = ' · ';

/**
 * Group the annotations of an application by subject id.
 *
 * @param {import('./types.js').WaiverApplication} application
 * @returns {Record<string, import('./types.js').WaiverAnnotation[]>}
 */
export function annotationsBySubject(application) {
  /** @type {Record<string, import('./types.js').WaiverAnnotation[]>} */
  const bySubject = {};
  for (const annotation of application.annotations) {
    if (!bySubject[annotation.subjectId]) bySubject[annotation.subjectId] = [];
    bySubject[annotation.subjectId].push(annotation);
  }
  for (const list of Object.values(bySubject)) {
    list.sort((a, b) => a.waiverId.localeCompare(b.waiverId));
  }
  return bySubject;
}

/**
 * One `Notes`-ready line per affected subject id.
 *
 * Subjects with no waiver are **absent** from the result rather than present
 * with an empty string, so a caller merging this into existing notes can tell
 * "no waiver here" from "a waiver that renders to nothing".
 *
 * @param {import('./types.js').WaiverApplication} application
 * @returns {Record<string, string>}
 */
export function waiverNotesBySubject(application) {
  /** @type {Record<string, string>} */
  const notes = {};
  for (const [subjectId, annotations] of Object.entries(annotationsBySubject(application))) {
    notes[subjectId] = annotations.map((annotation) => annotation.note).join(NOTE_SEPARATOR);
  }
  return notes;
}

/**
 * Append a subject's waiver note to whatever note a row already carries.
 *
 * @param {string} existing - the row's current note, possibly empty
 * @param {string|undefined} waiverNote - from {@link waiverNotesBySubject}
 * @returns {string}
 */
export function mergeWaiverNote(existing, waiverNote) {
  if (!waiverNote) return existing ?? '';
  if (!existing) return waiverNote;
  return `${existing}${NOTE_SEPARATOR}${waiverNote}`;
}

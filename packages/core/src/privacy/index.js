/**
 * Barrel for the privacy primitives.
 *
 * One module today: the identity shapes that
 * `tests/season2026CorpusVocabulary.test.js` enforces over the corpus and that
 * `fieldAdmin/schemas.js` enforces over an operator-written blackout note.
 * They live in `packages/core/src` rather than in `tests/` because a test
 * cannot be imported by production code, and the note validation is production
 * code.
 *
 * @module privacy
 */

export {
  COMMON_ABBREVIATIONS,
  IDENTITY_SHAPES,
  IDENTITY_SHAPE_NAMES,
  collapseInitialisms,
  findIdentityShapes,
  words,
} from './textShapes.js';

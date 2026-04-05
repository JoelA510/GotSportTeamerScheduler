import { BuddyEvaluator } from './BuddyEvaluator.js';
import { WeightedAttributeEvaluator } from './WeightedAttributeEvaluator.js';
// SkillEvaluator is deprecated in Phase 6 in favor of WeightedAttributeEvaluator
// import { SkillEvaluator } from './SkillEvaluator.js';

/**
 * Array of active evaluators. The final score is the sum of their individual scores.
 * @type {Array<import('./BaseEvaluator.js').BaseEvaluator>}
 */
export const EVALUATOR_REGISTRY = [
  new BuddyEvaluator(),
  new WeightedAttributeEvaluator()
];

export { BaseEvaluator } from './BaseEvaluator.js';
export { SkillEvaluator } from './SkillEvaluator.js';
export { BuddyEvaluator } from './BuddyEvaluator.js';

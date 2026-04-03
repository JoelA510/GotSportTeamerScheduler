import { SkillEvaluator } from './SkillEvaluator.js';
import { BuddyEvaluator } from './BuddyEvaluator.js';

/**
 * Evaluator Registry (Phase 1.2)
 * Centralizes all teaming logic modules.
 */
export const EVALUATOR_REGISTRY = [
  new SkillEvaluator(),
  new BuddyEvaluator(),
];

export { BaseEvaluator } from './BaseEvaluator.js';
export { SkillEvaluator } from './SkillEvaluator.js';
export { BuddyEvaluator } from './BuddyEvaluator.js';

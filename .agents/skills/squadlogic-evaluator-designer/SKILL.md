# SquadLogic Evaluator Designer

Guidance for building and tuning new teaming metrics within the modular Evaluator Registry.

## Overview
Status: Production Ready
Core: `@squadlogic/core`
Location: `packages/core/src/evaluators/`

## Implementation Protocol
Every new evaluator MUST:
1. Extend the `BaseEvaluator` class.
2. Implement the `evaluate(divisionData)` method.
3. Return a score between `0.0` and `1.0`.
4. Be registered in the `EvaluatorRegistry` (currently internal to `teamGeneration.js`).

## Example Structure
```javascript
import BaseEvaluator from './BaseEvaluator';

class NewMetricEvaluator extends BaseEvaluator {
  constructor() {
    super('new-metric', 'Weight of the new metric');
  }

  evaluate(divisionData) {
    // Logic here
    return score;
  }
}
```

## Best Practices
- **Isolation**: Evaluators should not depend on other evaluators.
- **Performance**: Use efficient loops; team generation may run evaluation thousands of times per second.
- **Normalization**: Always normalize scores so that `1.0` is perfect and `0.0` is a failure.

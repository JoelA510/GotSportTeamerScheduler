import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';

const source = readFileSync('supabase/functions/fairness-scoring/index.ts', 'utf8');

test('fairness-scoring uses the shared per-user rate limiter after auth', () => {
  assert.match(source, /from '\.\.\/_shared\/rateLimit\.ts'/);
  assert.match(source, /checkRateLimit\(user\.id\)/);
  assert.match(source, /rateLimitExceededResponse\(rateCheck\)/);

  assert(
    source.indexOf('const rateCheck = checkRateLimit(user.id);') >
      source.indexOf('const user = await getUserFromRequest(req, supabase);'),
    'rate limit check should run after the authenticated user is resolved'
  );
});

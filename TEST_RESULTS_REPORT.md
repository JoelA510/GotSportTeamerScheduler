# Test Results Report - March 25, 2026

## Summary
- **Security-critical tests**: PASSED (15/15)
- **Full Vitest suite**: FAILED (221/227 passed)
- **E2E tests**: FAILED (35/57 passed)
- **Frontend build**: SUCCESSFUL

---

## 1. Security-critical Tests
**Command**: `npx vitest run tests/calendarFeed.test.js tests/usePermission.test.js tests/verifyRpcUsage.test.js tests/normalization.test.js tests/logger.test.js`

**Result**: All tests passed.
- `tests/calendarFeed.test.js`: 2 passed
- `tests/normalization.test.js`: 2 passed
- `tests/logger.test.js`: 4 passed
- `tests/verifyRpcUsage.test.js`: 3 passed
- `tests/usePermission.test.js`: 4 passed

---

## 2. Full Vitest Suite with Coverage
**Command**: `npm run test:coverage`

**Result**: 34 files passed, 6 failed. 221 tests passed, 6 failed.

### Failures:
1. **tests/e2e/example.spec.ts**: Playwright test file being picked up by Vitest.
2. **tests/authIntegration.test.jsx**: `expect(element).toHaveTextContent()` failed. Expected "Test Club", received "No Org".
3. **tests/gameSupabase.test.js**: `AssertionError: Missing expected rejection.`
4. **tests/practiceSupabase.test.js**: `AssertionError: The input did not match the regular expression /supabaseClient with a from\(\) method is required/`.
5. **tests/teamGeneration.test.js**: `AssertionError: Missing expected exception.`
6. **tests/useTeamAnalysis.test.js**: Timeouts (5000ms) on two tests.

---

## 3. E2E Tests
**Command**: `npm run test:e2e`

**Result**: 35 passed, 22 failed.
- Many failures were due to timeouts or missing elements in the mock environment.
- 57 tests total.

---

## 4. Frontend Build
**Command**: `npm run frontend:build`

**Result**: SUCCESSFUL.
- Built in 5.46s.
- Assets generated in `../dist/`.

---

## Raw Logs (Partial)

### Security-critical
```
 RUN  v4.0.15 C:/Users/joel.abraham/Downloads/SquadLogic

 ✓ tests/calendarFeed.test.js (2 tests) 4ms
 ✓ tests/normalization.test.js (2 tests) 8ms
 ✓ tests/logger.test.js (4 tests) 12ms
 ✓ tests/verifyRpcUsage.test.js (3 tests) 3ms
 ✓ tests/usePermission.test.js (4 tests) 17ms

 Test Files  5 passed (5)
      Tests  15 passed (15)
```

### Full Vitest (Failures)
```
 FAIL  tests/authIntegration.test.jsx > Auth & Organization Integration > should load user and fetch organizations
Error: expect(element).toHaveTextContent()
Expected element to have text content: "Test Club"
Received: "No Org"

 FAIL  tests/gameSupabase.test.js > persistGameAssignments surfaces Supabase errors and validates client
AssertionError: Missing expected rejection.

 FAIL  tests/practiceSupabase.test.js > persistPracticeAssignments > validates Supabase client presence
AssertionError: The input did not match the regular expression /supabaseClient with a from\(\) method is required/.
```

### Build Output
```
vite v6.4.1 building for production...
✓ 2531 modules transformed.
../dist/index.html                                     1.26 kB │ gzip:   0.57 kB
...
✓ built in 5.46s
```

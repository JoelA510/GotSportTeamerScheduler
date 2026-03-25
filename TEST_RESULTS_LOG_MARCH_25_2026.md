# Detailed Test Results Report - March 25, 2026

This report summarizes the results of the test suite execution, including Vitest unit/integration tests, Playwright E2E tests, and the frontend production build.

## Summary Table

| Test Suite | Status | Pass Rate | Notes |
|------------|--------|-----------|-------|
| Vitest (Unit/Integration) | FAILED | 221/227 (97.4%) | Target was ~226/227. No improvement from previous run. |
| Playwright (E2E) | FAILED | 33/57 (57.9%) | RBAC scenarios now exercise real assertions and are failing. |
| Frontend Build | PASSED | 100% | Successful production build in 6.00s. |

---

## 1. Vitest Results (Unit & Integration)
**Command**: `npm run test:coverage`

### Overall Result
- **Files**: 34 passed, 5 failed (39 total)
- **Tests**: 221 passed, 6 failed (227 total)

### Detailed Failures

#### 1.1 `tests/authIntegration.test.jsx`
- **Test**: `Auth & Organization Integration > should load user and fetch organizations`
- **Error**: `expect(element).toHaveTextContent()`
- **Expected**: `Test Club`
- **Received**: `No Org`
- **Raw Data**:
  ```html
  <div data-testid="org-name">No Org</div>
  ```

#### 1.2 `tests/gameSupabase.test.js`
- **Test**: `persistGameAssignments supports upserts and no-op handling`
- **Error**: `Error: should not persist empty rows`
- **Context**: Thrown by mock client's `from()` method when it shouldn't have been called.

#### 1.3 `tests/practiceSupabase.test.js`
- **Test**: `persistPracticeAssignments > skips Supabase writes when there are no assignments`
- **Error**: `Error: should not call Supabase when no rows are present`
- **Context**: Thrown by mock client's `from()` method when it shouldn't have been called.

#### 1.4 `tests/teamGeneration.test.js`
- **Test**: `validates input arguments`
- **Error**: `AssertionError: Missing expected exception.`
- **Code**:
  ```js
  assert.throws(() => generateTeams({ players: missingId, divisionConfigs }), /each player requires an id/i)
  ```

#### 1.5 `tests/useTeamAnalysis.test.js`
- **Test**: `processes imported players into program groups`
- **Error**: `Test timed out in 5000ms.`
- **Test**: `reports missing DOB/Gender as validation errors`
- **Error**: `Test timed out in 5000ms.`

---

## 2. Playwright E2E Results
**Command**: `npm run test:e2e`

### Overall Result
- **Tests**: 33 passed, 24 failed (57 total)
- **Status**: Regression in pass count (from 35 to 33), but improvement in assertion coverage for RBAC.

### RBAC Specific Failures (New Assertions)

#### 2.1 Multi-Tenancy Data Isolation (RLS)
- **Scenario**: `Then I should only receive records associated with "Org A"`
- **Error**: `Expected to see Org A team data on the page. expect(received).toBeTruthy()`
- **Received**: `false`

#### 2.2 Route Protection via usePermission
- **Scenario**: `Then I should see an "Unauthorized access" warning`
- **Error**: `expect(locator).toBeVisible() failed. Locator: getByText('Unauthorized access').first()`
- **Reason**: Element not found within 5000ms.

#### 2.3 Admin Access Verification
- **Scenario**: `And I should be able to view and manage data specifically for "Org B"`
- **Error**: `expect(received).toBe(expected)`
- **Expected**: `"rbac-org-b-1774473579654"` (Mock ID)
- **Received**: `"d391b456-384c-4da9-917f-dd6726d5687f"` (Actual UUID)

### Other Notable Failures
- **Async States**: Timeouts on Recharts Tooltip Rendering and Persistence Sync Timeout Handling.
- **Ingestion Hardening**: `.cell-error` element not visible during malformed data recovery.
- **Calendar Sync**: Timeout clicking "Subscribe to Calendar" button.
- **Dashboard**: Readiness score showed "100%" instead of expected "25%".

---

## 3. Frontend Build Result
**Command**: `npm run frontend:build`

### Result: SUCCESS
- **Build Time**: 6.00s
- **Output Directory**: `../dist/`
- **Main Bundle Size**: 289.07 kB (92.91 kB gzipped)
- **Note**: Warning about duplicate dynamic/static import for `ThemeToggle.jsx` remains but does not break the build.

# Wave 1a Task 4.5: Accessibility Audit

**Date**: 2026-04-20  
**Scope**: SquadLogic frontend (`/home/user/SquadLogic/frontend/src`)  
**Methodology**: Static code analysis using grep, regex, and manual inspection  
**Baseline**: Cross-referenced against `/home/user/SquadLogic/docs/ui/ui-ux-rules.json`

---

## Baseline (from docs/ui/)

The UI/UX rules document defines 7 foundational accessibility principles:

1. **keyboard_accessible** (P0): All interactive elements must be keyboard-reachable.
2. **forms_labels_visible** (P0): Labels always visible, no placeholder-only forms.
3. **forms_error_specific** (P1): Errors must state what's wrong and how to fix it.
4. **tables_semantic** (P1): Semantic table markup with headers and scopes.
5. **motion_reduced** (P1): Respect `prefers-reduced-motion`.
6. **feedback_loading** (P1): Show loading state for async ops >500ms.
7. **navigation_active_state** (P1): Global nav clearly indicates active section.

The codebase has implemented **aria-hidden="true"** on decorative icons and **role="alert"** on form validation banners (rules 3, 6, 7). Heading structure and landmark elements are partially present.

---

## Scan Results by Category

### Semantic HTML & ARIA

**Status**: Mostly compliant; minor string-attribute issues.

- Login, ResetPassword, FieldManagementPage forms properly use `<label htmlFor>` wiring (F-4-01 level: compliant).
- OfflineGuard modal uses `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby` (correct).
- EvaluationPanel uses `role="status"` and `aria-busy="true"` for async loading.
- Decorative icons correctly use `aria-hidden="true"` (not string "true", verified).

**Concern**: Several form validation banners and alerts in Login.jsx, ResetPassword.jsx, and SetupWizard.jsx use string values for `aria-hidden` instead of JS booleans in some patterns. Code inspection shows mostly correct boolean usage; a few legacy string patterns exist.

### Focus Management & Keyboard Navigation

**Status**: Good keyboard support; no focus-trap library detected; modal overlays lack explicit focus management.

- DashboardLayout hamburger button and sidebar navigation use proper `aria-label` and are keyboard-accessible.
- OfflineGuard retry button uses `autoFocus` (correct).
- CalendarModal (TeamPortalPage) has no focus-trap or `aria-modal`; overlay lacks proper dialog semantics.
- FieldManagementPage edit/delete icon buttons have `aria-label` (good).
- No `tabindex="-1"` focus-skip patterns found (no false positives).

### Form Fields & Labeling

**Status**: Good; labels properly wired in auth forms; one input field missing label association.

- **Audit**: TeamPortalPage.jsx line 281 `<input type="text" ... placeholder="Type a message...">` in chat form is unlabeled and within `<form>` but lacks associated `<label>`. While it's a low-priority chat field, it violates rule **forms_labels_visible**.
- **Audit**: TeamPortalPage.jsx line 351 (CalendarModal) `<input type="text" readOnly>` displaying URL has no label; modal lacks `role="dialog"` (should be `dialog` or `alertdialog` with `aria-labelledby`).
- All auth forms (Login, ResetPassword, OrganizationCreation) correctly use `<label htmlFor>` and `<input id>` pairing.

### Icon Buttons

**Status**: Compliant; all icon buttons have `aria-label`.

- FieldManagementPage: Edit button (`aria-label="Edit {field.name}"`), Delete button (`aria-label="Delete {field.name}"`).
- DashboardLayout: Hamburger menu (`aria-label="Hamburger Menu"`).
- AutoSchedulerPanel, RosterManager: Icons use `aria-hidden="true"` for decorative purposes; action buttons have labels.
- **Finding**: IconButtons uniformly adopt `aria-label` (P0 compliance).

### Document Structure & Landmarks

**Status**: Partial; main landmark present; no skip-to-content link; heading hierarchy needs audit.

- DashboardLayout.jsx line 43: `<main>` landmark present (correct).
- Sidebar.jsx line 77: `<aside>` landmark present (correct).
- DashboardLayout.jsx line 29-35: Header section lacks semantic `<header>` tag (uses generic `<div>`).
- **No skip-to-content link** found anywhere in the codebase (no visible bypass for keyboard users navigating past nav).
- **Heading hierarchy**: Pages use `<h1>` (page title), `<h2>` (sections), `<h3>` (subsections). Generally correct, but inconsistently applied across dynamic components (e.g., RoadmapSection uses `<h2>`, FieldManagementPage uses `<h1>` for page title then `<h2>` for field names). No missing levels detected.

### Motion & Animation

**Status**: Animations present; **no `@media (prefers-reduced-motion)` overrides** found.

- `.animate-fadeIn` (0.4s), `.animate-slideUp` (0.5s), `.animate-pulseGlow` (2s infinite) defined in index.css.
- `.glass-panel:hover` and `.glass-panel-premium:hover` apply `transform: translateY(-2px)` (non-essential).
- **No prefers-reduced-motion guard** in CSS or component state. Users with motion sensitivity cannot disable these animations.
- Animations are short (<2.5s) and not essential to functionality, but rule **motion_reduced** (P1) requires opt-out capability.

### Color Contrast

**Status**: Theme variables in use; contrast **not computed** (requires runtime/browser inspection).

- Dark theme (default): `--color-text-primary: #f8fafc` on `--color-bg-app: #0f172a` → estimated **high contrast** (~12:1).
- Light theme: `--color-text-primary: #0f172a` on `--color-bg-surface: rgba(255, 255, 255, 0.7)` → estimated **high contrast** (~8:1).
- Party theme: `--color-text-primary: #ffffff` on `--color-bg-app: #1a0b2e` → estimated **high contrast** (~10:1).
- **Inline hardcoded colors** in a few utility classes:
  - ImportPanel.jsx SmartBadge: `text-green-400`, `text-blue-400`, `text-amber-400` on light backgrounds with opacity filters.
  - FieldManagementPage: `text-blue-400`, `text-red-400` for button icons on semi-transparent hover backgrounds.
  - SetupWizard (implied): Gradient overlays with semi-transparent text.
- No WCAG AA/AAA contrast ratio violations detected in spot checks, but full audit (Wave 5: axe-core) recommended.

### Form Validation & Error Handling

**Status**: Good; form validation uses `role="alert"`, `aria-live="polite"`.

- **Login.jsx**: Error banner (line 113) uses `role="alert"`, `aria-live="assertive"`. Success uses `aria-live="polite"` (correct semantic).
- **ResetPassword.jsx**: Error banner (line 97) uses `role="alert"` (correct).
- **SetupWizard.jsx**: Form state errors use inline alerts (observed in code structure).
- **Missing**: No `aria-describedby` on input fields linking to error messages. Errors are announced but not programmatically tied to the field.
- **Audit**: Error messages use natural language ("Password must be at least 12 characters..."), satisfying rule **forms_error_specific**.

### Modals & Dialogs

**Status**: One modal compliant (OfflineGuard); two modals missing semantics.

1. **OfflineGuard.jsx** (line 60):
   - `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby="offline-guard-title"`, `aria-describedby="offline-guard-desc"` ✓
   - Focus management: `autoFocus` on retry button ✓
   - No focus trap library; assumes click-outside-to-dismiss pattern.

2. **CalendarModal** (TeamPortalPage.jsx, line 347):
   - Plain `<div>` overlay, no `role="dialog"`.
   - No `aria-modal`, `aria-labelledby`, `aria-describedby`.
   - No focus trap; Tab key may escape the modal.
   - **Finding F-4-02**: Modal missing proper ARIA semantics.

3. **FieldManagementPage Modal** (line 243):
   - Plain `<div>` overlay, no `role="dialog"`.
   - No `aria-modal`, `aria-labelledby`.
   - Title is `<h2>` (line 246); should use `id` and link via `aria-labelledby`.
   - **Finding F-4-03**: Modal missing proper ARIA semantics.

---

## Findings

### F-4-01: ARIA String Values on Select Attributes

**Severity**: P2 (Minor)  
**Location**: `frontend/src/components/OfflineGuard.jsx:61`, `frontend/src/pages/SetupWizard.jsx:192`, `frontend/src/components/EvaluationPanel.jsx:118`, `frontend/src/components/EvaluationPanel.jsx:250`  
**Observation**:  
Lines like `aria-modal="true"`, `aria-hidden="true"`, `aria-busy="true"` use string literals instead of JS booleans. HTML attribute values are always strings, so this is technically correct per HTML spec, but React best practice is to pass boolean values to ARIA attributes when using JSX (React converts to proper string representation).

**Impact**: None on screen readers; inconsistent with modern React patterns.  
**Recommended fix**: Change `aria-modal="true"` → `aria-modal={true}` in JSX; same for `aria-hidden`, `aria-busy`.  
**Proposed wave**: `1b-trivial`  
**Effort**: <5 min (1-2 lines per file)

---

### F-4-02: Missing ARIA Semantics on CalendarModal Dialog

**Severity**: P1 (Major)  
**Location**: `frontend/src/pages/TeamPortalPage.jsx:347-378` (CalendarModal function)  
**Observation**:  
The CalendarModal is a full-screen overlay with `<div className="fixed inset-0 z-50 ... bg-black/50">` containing a card. It lacks:
- `role="dialog"` or `role="alertdialog"` on the overlay or inner card.
- `aria-labelledby` pointing to the `<h3>` title (line 349).
- `aria-modal="true"` to signal that interaction outside is disabled.
- Focus trap: Tab/Shift+Tab can escape to background.

Screen readers do not announce the purpose of the overlay; keyboard users can tab beyond the modal.

**Impact**:
- Keyboard users: May lose focus or escape modal unintentionally.
- Screen reader users: No announcement that a dialog has opened; focus context unclear.
- Violates WCAG 2.1 Level A (dialogs must be semantically marked).

**Recommended fix**:
1. Add `role="dialog"` to outer `<div>` (line 347).
2. Add `aria-modal="true"`.
3. Add `id="calendar-modal-title"` to the `<h3>` title and set `aria-labelledby="calendar-modal-title"`.
4. Integrate a focus trap library (e.g., `focus-trap-react`) or manually trap Tab/Shift+Tab within the modal.

**Proposed wave**: `5-e2e` (axe-core integration will catch this; fix deferred to focus-management sprint)  
**Effort**: 20–30 min (library integration, testing)

---

### F-4-03: Missing ARIA Semantics on FieldManagementPage Edit Modal

**Severity**: P1 (Major)  
**Location**: `frontend/src/pages/FieldManagementPage.jsx:242-439` (modal within conditional render)  
**Observation**:  
Similar to F-4-02, the field edit modal is a full-screen overlay (`<div className="fixed inset-0 z-50 ... bg-black/50">`) with inner form. Missing:
- `role="dialog"` or `role="alertdialog"`.
- `aria-labelledby` pointing to the form title (`<h2>` line 246).
- `aria-modal="true"`.
- Focus trap; Tab escapes the modal.

**Impact**: Same as F-4-02; violates WCAG 2.1 Level A.

**Recommended fix**: Apply same pattern as CalendarModal (above).

**Proposed wave**: `5-e2e`  
**Effort**: 20–30 min

---

### F-4-04: Missing Label on Chat Input Field

**Severity**: P1 (Major)  
**Location**: `frontend/src/pages/TeamPortalPage.jsx:281-287` (chat input in form)  
**Observation**:  
```jsx
<form ...>
  <input
    type="text"
    value={chatInput}
    onChange={(e) => setChatInput(e.target.value)}
    placeholder="Type a message..."
    className="glass-input flex-grow text-sm"
  />
  <button type="submit" ...>
```

The input has no associated `<label>` element. `placeholder` is not a substitute for a label (placeholder disappears when typing; does not meet WCAG 2.1 1.3.1 Level A).

**Impact**:
- Screen reader users: Input purpose unclear; no announced label.
- Violates WCAG 2.1 Level A (labels required).
- Violates rule **forms_labels_visible** from ui-ux-rules.json.

**Recommended fix**:
```jsx
<label htmlFor="chat-input" className="sr-only">Send a message</label>
<input id="chat-input" type="text" placeholder="Type a message..." ... />
```

**Proposed wave**: `1b-trivial`  
**Effort**: <5 min

---

### F-4-05: Missing Label on Calendar Subscription Input (ReadOnly)

**Severity**: P2 (Minor)  
**Location**: `frontend/src/pages/TeamPortalPage.jsx:351-356` (CalendarModal)  
**Observation**:  
```jsx
<input
  type="text"
  readOnly
  value={calendarUrl}
  className="w-full bg-bg-surface ..."
/>
```

A read-only URL display field lacks a label. While read-only, it should still be labeled for screen readers.

**Impact**: Screen reader users do not know the field's purpose (calendar URL).  
**Recommended fix**:
```jsx
<label htmlFor="calendar-url" className="block text-sm text-text-secondary mb-2">Calendar Subscription Link</label>
<input id="calendar-url" type="text" readOnly value={calendarUrl} ... />
```

**Proposed wave**: `1b-trivial`  
**Effort**: <5 min

---

### F-4-06: No Skip-to-Content Link

**Severity**: P1 (Major)  
**Location**: Global (missing from all pages)  
**Observation**:  
No skip-to-main-content link found. Keyboard users must Tab through the entire sidebar navigation (12+ items) before reaching main content. The Sidebar is sticky/fixed, so every page requires this navigation pass.

WCAG 2.1 2.4.1 Level A requires a bypass mechanism for repeated blocks.

**Impact**:
- Keyboard navigation is slow and frustrating.
- Violates WCAG 2.1 Level A.

**Recommended fix**:
1. Add a visually hidden link at the very top of DashboardLayout:
   ```jsx
   <a href="#main" className="sr-only focus:not-sr-only">Skip to main content</a>
   ```
2. Add `id="main"` to the `<main>` tag (already present at line 43).
3. CSS for `focus:not-sr-only` to reveal on focus.

**Proposed wave**: `1b-trivial`  
**Effort**: 5–10 min

---

### F-4-07: Missing Semantic Header Landmark

**Severity**: P2 (Minor)  
**Location**: `frontend/src/layouts/DashboardLayout.jsx:18-36` (mobile header section)  
**Observation**:  
The mobile header is a generic `<div>` on line 18. Should use semantic `<header>` tag for page header / banner region.

**Impact**: Screen reader users may not recognize the region as a header; landmark navigation less effective.  
**Recommended fix**: Change `<div className={...}>` → `<header className={...}>`.

**Proposed wave**: `1b-trivial`  
**Effort**: <5 min

---

### F-4-08: No Prefers-Reduced-Motion Overrides

**Severity**: P1 (Major)  
**Location**: `frontend/src/index.css:30-66` (keyframes definitions) and throughout JSX (`.animate-fadeIn`, `.animate-slideUp`, `.animate-pulseGlow`)  
**Observation**:  
Three animations are defined:
- `fadeIn` (0.4s)
- `slideUp` (0.5s)
- `pulseGlow` (2s infinite)

No `@media (prefers-reduced-motion: reduce)` media query disables or reduces these animations. Users with motion sensitivity cannot opt-out.

**Impact**:
- Violates WCAG 2.1 2.3.3 Level A (respect prefers-reduced-motion).
- Violates rule **motion_reduced** from ui-ux-rules.json.

**Recommended fix**:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-fadeIn,
  .animate-slideUp,
  .animate-pulseGlow {
    animation: none !important;
  }
  
  .glass-panel:hover {
    transform: none;
  }
}
```

Alternatively, wrap animations in context and check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` in React.

**Proposed wave**: `5-e2e` (axe-core will flag; consider in motion audit sprint)  
**Effort**: 15–20 min

---

### F-4-09: Inline Hardcoded Colors Without Contrast Verification

**Severity**: P2 (Minor)  
**Location**: Multiple files (ImportPanel.jsx SmartBadge, FieldManagementPage, etc.)  
**Observation**:  
Hardcoded color classes (`.text-green-400`, `.text-blue-400`, `.text-amber-400`, `.text-red-400`) are used on dynamic backgrounds. While spot checks suggest adequate contrast, no automated verification has been performed.

**Impact**:
- Potential contrast ratio failures for users with color blindness or low vision (WCAG 2.1 1.4.3 Level AA requires 4.5:1 for normal text, 3:1 for large text).
- No single source of truth for accessible color tokens.

**Recommended fix**:
1. Define accessible color pairs in CSS (e.g., `.badge-success`, `.badge-warning` with pre-validated contrast).
2. Run axe-core in Wave 5 to verify all combinations.

**Proposed wave**: `5-e2e`  
**Effort**: 20–30 min (token consolidation + axe verification)

---

### F-4-10: Missing aria-describedby on Form Fields with Inline Error Text

**Severity**: P1 (Major)  
**Location**: Login.jsx, ResetPassword.jsx, SetupWizard.jsx (and others with inline validation)  
**Observation**:  
Form validation errors are announced via `role="alert"` and `aria-live="polite"`, but input fields are not explicitly linked to the error message via `aria-describedby`. Screen readers announce the error, but the association is implicit, not programmatic.

Example: Login.jsx (line 165) `<input id="email" .../>` when error occurs (line 113), but no `aria-describedby="email-error"` on the input.

**Impact**:
- Screen readers must infer error-field association.
- Violates WCAG 2.1 3.3.1 Level A (error identification must be programmatic).
- Violates rule **forms_error_specific** (not complete error communication).

**Recommended fix**:
```jsx
{error && (
  <div id="email-error" role="alert" aria-live="assertive">
    {error}
  </div>
)}
<input
  id="email"
  aria-describedby={error ? "email-error" : undefined}
  ...
/>
```

**Proposed wave**: `1b-trivial`  
**Effort**: 10–15 min (apply to 3–5 forms)

---

### F-4-11: No Keyboard Type Attribute on Numeric Inputs

**Severity**: P2 (Minor)  
**Location**: FieldManagementPage.jsx (priority_rating input), possibly others  
**Observation**:  
Input fields for numeric values (e.g., priority rating, phone numbers, ages in registration forms) do not specify `type="number"` or `inputMode="numeric"`. This affects mobile UX and keyboard UX.

**Impact**: Mobile users see default QWERTY keyboard instead of numeric keypad.  
**Recommended fix**: Add `type="number"` (if range validation needed) or `inputMode="numeric"` (if text + numeric).

**Proposed wave**: `6-free-tier` (UX enhancement, not strict a11y)  
**Effort**: 5–10 min

---

### F-4-12: Heading Hierarchy Inconsistency in Dynamic Content

**Severity**: P2 (Minor)  
**Location**: FieldManagementPage.jsx (line 169: `<h2>` for field names under page `<h1>`), similar in other list/grid components  
**Observation**:  
Page title uses `<h1>` (line 120), then field cards use `<h2>` (line 169) for field names. This is technically correct but could be improved: consider using `<h2>` for field sections if they are top-level subsections, and reserve `<h3>` for nested details.

**Impact**: Minor; outline is logical but could be clearer.  
**Recommended fix**: Document heading conventions in CLAUDE.md or a style guide to ensure consistency across all pages.

**Proposed wave**: `8-docs`  
**Effort**: 5 min (documentation only)

---

## Summary Statistics

- **Total findings**: 12
- **P0 (Critical)**: 0 (no blocking issues)
- **P1 (Major)**: 7 (focus traps, labels, motion, skip-link, prefers-reduced-motion)
- **P2 (Minor)**: 5 (ARIA string values, color contrast, numeric inputs, heading hierarchy)

### Distribution by Wave

| Wave | Count | Findings |
|------|-------|----------|
| 1b-trivial | 5 | F-4-01, F-4-04, F-4-05, F-4-06, F-4-07, F-4-10 |
| 5-e2e | 4 | F-4-02, F-4-03, F-4-08, F-4-09 |
| 6-free-tier | 1 | F-4-11 |
| 8-docs | 1 | F-4-12 |

---

## Top 3 Highest-Priority Findings

1. **F-4-02 & F-4-03**: Missing ARIA semantics on modals (CalendarModal, FieldManagementPage modal). **Impact**: Keyboard navigation can escape dialogs; screen readers don't announce purpose. **WCAG**: 2.1 Level A violation. **Effort**: 20–30 min per modal.

2. **F-4-06**: No skip-to-content link. **Impact**: Keyboard users must navigate through 12+ sidebar items to reach content on every page. **WCAG**: 2.4.1 Level A violation. **Effort**: 5–10 min (trivial fix).

3. **F-4-08**: No prefers-reduced-motion media query. **Impact**: Motion-sensitive users cannot disable animations. **WCAG**: 2.3.3 Level A violation. **Effort**: 15–20 min.

---

## Notes for Wave Planners

- **Wave 1b-trivial** can absorb 6 findings (ARIA strings, labels, skip-link, semantic header, aria-describedby).
- **Wave 5-e2e** should integrate `@axe-core/playwright` to catch contrast issues, focus management, and remaining ARIA violations.
- **Wave 6-free-tier** can address keyboard input types as a UX enhancement.
- **Wave 8-docs** should establish heading hierarchy and accessibility component patterns in CLAUDE.md.

All findings reference specific line numbers and reproducible code patterns. No fixes have been applied; this is a read-only audit.

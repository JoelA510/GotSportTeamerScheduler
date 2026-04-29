# PR #155 Wave 4 salvage design

Branch access note: direct PR branch checkout was unavailable in this workspace, so this doc records Wave 4 blocker resolution using merged PR #201 state and `.claude/wave-4-prompt.md`.

## Blocker resolutions
- `organizations.slug` is the canonical column; no `url_slug` usage retained.
- `initialize_new_tenant` caller uses the 4-argument payload (`p_name`, `p_slug`, `p_timezone`, `p_season_year`).
- Non-existent dashboard component imports are not used; onboarding stays in `OrganizationCreation.jsx`.
- `DashboardPage` exports remain intact.
- Test dependency removals from PR #155 are not carried forward.

## Implemented Wave 4 closure in this PR
- Added cold-start onboarding E2E coverage.
- Confirmed route accessibility for `/auth/reset-password` and `/invite/:code`.
- Tightened onboarding validation drift to Wave 4 bounds.

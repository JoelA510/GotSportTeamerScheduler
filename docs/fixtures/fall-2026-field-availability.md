# Fall 2026 field availability fixture

This fixture pack captures a **Fall 2026** availability import scenario used by pgTAP and JS lifecycle regression tests.

## Source mapping assumptions

- One CSV row maps to one `field_availability_profiles` row.
- Five Canyons Upper/Lower and Bret Harte are modeled as `available_from=2026-09-01` and include `blackout_months=Aug` for explicit August exclusion checks.
- San Lorenzo is modeled as `available_from=2026-08-01`, `available_until=2026-10-31`, and `blackout_months=Sep` to represent "open in August/October, closed in September".
- Creekside and Proctor are represented with `record_status=excluded` so they import but remain non-active.
- Canyon rows are represented as `record_status=potential` + `approval_status=pending` and grouped with `scenario_name=Canyon Potential` / `scenario_group=canyon`.
- Equipment requirement rows are only created when `goal_equipment` and/or `goal_status` is present.

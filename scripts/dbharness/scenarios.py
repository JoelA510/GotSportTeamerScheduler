#!/usr/bin/env python3
"""Emit SQL that runs the shared scenario table against Postgres.

`tests/fixtures/fieldLifecycleScenarios.json` is the single statement of what
the lifecycle and blackout RPCs must do. `tests/fieldLifecycleScenarios.test.js`
runs it against the mock client; this runs the SAME file against a real
database. Neither implementation is compared with the other -- both are compared
with the table -- so a fix that lands on one side and not the other fails on the
side that missed it.

That is the gap round 3 found: round 2's fixes to `admin_retire_field` and
`admin_unretire_field` went into the SQL and never reached the mock, and one of
them was CERTIFIED by a passing test asserting the wrong outcome.

Dates are offsets in days from `current_date`, so both sides compute the same
absolute date and no scenario expires.

Every assertion RAISES. A scenario that cannot be judged is a failure, never a
skip, and the emitted script counts what it ran and refuses a run that judged
fewer cases than the table holds -- a generator that silently emitted nothing
would otherwise produce a passing script that tests nothing.
"""

import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TABLE_PATH = os.path.join(REPO, 'tests', 'fixtures', 'fieldLifecycleScenarios.json')


def lit(value):
    """A SQL literal for a scenario value."""
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def date_expr(offset):
    """An offset in days from today, as a `date`."""
    if offset is None:
        return 'NULL::date'
    return f'(current_date + {int(offset)})'


def emit_field(scenario, index):
    s = scenario
    fid = f"scenario_field_{index}"
    lines = [
        f"  -- {s['id']}: {s['why']}",
        "  INSERT INTO public.fields (organization_id, location_id, name, active, effective_to)",
        f"  VALUES (v_org, v_loc, {lit('Scenario Pitch ' + str(index))}, "
        f"{lit(s['before']['active'])}, {date_expr(s['before']['effectiveTo'])})",
        "  RETURNING id INTO v_field;",
        # The `before` state really landed. The retirement trigger fires on
        # INSERT, so a scenario asking for `active = true` with a PAST date
        # would be silently corrected into a different scenario.
        "  SELECT active, effective_to INTO v_active, v_eff FROM public.fields WHERE id = v_field;",
        f"  IF v_active IS DISTINCT FROM {lit(s['before']['active'])}",
        f"     OR v_eff IS DISTINCT FROM {date_expr(s['before']['effectiveTo'])} THEN",
        f"    RAISE EXCEPTION '{s['id']}: the BEFORE state did not land (active=%, effective_to=%)',",
        "      v_active, v_eff;",
        "  END IF;",
    ]
    if s['rpc'] == 'admin_retire_field':
        lines.append(
            "  v_res := public.admin_retire_field(p_organization_id => v_org, "
            f"p_field_id => v_field, p_effective_to => {date_expr(s['args']['effectiveTo'])}, "
            f"p_confirm => {lit(bool(s['args'].get('confirm')))});"
        )
    elif s['rpc'] == 'admin_unretire_field':
        lines.append(
            "  v_res := public.admin_unretire_field(p_organization_id => v_org, "
            "p_field_id => v_field);"
        )
    else:
        # Every switch over a union throws on the value it does not know.
        raise SystemExit(f"unknown rpc {s['rpc']!r} in scenario {s['id']!r}")

    lines += [
        "  SELECT active, effective_to INTO v_active, v_eff FROM public.fields WHERE id = v_field;",
        f"  IF v_active IS DISTINCT FROM {lit(s['expect']['active'])} THEN",
        f"    RAISE EXCEPTION '{s['id']}: expected active={lit(s['expect']['active'])}, got %', v_active;",
        "  END IF;",
        f"  IF v_eff IS DISTINCT FROM {date_expr(s['expect']['effectiveTo'])} THEN",
        f"    RAISE EXCEPTION '{s['id']}: expected effective_to={s['expect']['effectiveTo']!r} "
        "days from today, got %', v_eff;",
        "  END IF;",
        # Both audit phases, on every accepted call.
        "  SELECT count(DISTINCT metadata->>'phase') INTO v_n FROM public.audit_log",
        f"   WHERE resource_id = v_field AND metadata->>'operation' = {lit(s['rpc'])}",
        "     AND metadata->>'phase' IN ('before','after');",
        "  IF v_n <> 2 THEN",
        f"    RAISE EXCEPTION '{s['id']}: expected before AND after audit phases, found % distinct', v_n;",
        "  END IF;",
        "  v_ran := v_ran + 1;",
        "",
    ]
    return lines


def emit_blackout(scenario, index):
    s = scenario
    scopes = {
        'location': ('v_loc', 'NULL::uuid'),
        'field': ('NULL::uuid', 'v_field'),
        'both': ('v_loc', 'v_field'),
        'neither': ('NULL::uuid', 'NULL::uuid'),
    }
    if s['scope'] not in scopes:
        raise SystemExit(f"unknown scope {s['scope']!r} in scenario {s['id']!r}")
    loc, fld = scopes[s['scope']]
    a = s['args']
    # **Named notation, not positional.** The first version passed these
    # positionally and put `p_reason` where `p_start_minutes` belongs, so every
    # blackout scenario failed with `invalid input syntax for type integer:
    # "maintenance"`. Positional arguments across a nine-parameter signature are
    # a fact about the migration that this generator would have to keep in step
    # by hand -- the same "two producers that agreed once" shape the scenario
    # table exists to remove. Named arguments make the order the database's
    # business, and a renamed parameter fails loudly instead of silently
    # shifting every value along one.
    call = (
        "public.admin_create_field_blackout("
        f"p_organization_id => v_org, p_location_id => {loc}, p_field_id => {fld}, "
        f"p_blackout_from => {date_expr(a['from'])}, p_blackout_until => {date_expr(a['until'])}, "
        f"p_start_minutes => {lit(a.get('startMinutes'))}, "
        f"p_end_minutes => {lit(a.get('endMinutes'))}, "
        f"p_reason => {lit(a.get('reason'))}, p_note => NULL)"
    )
    lines = [f"  -- {s['id']}: {s['why']}",
             "  SELECT count(*) INTO v_before_n FROM public.field_blackouts WHERE organization_id = v_org;"]
    if s['expect']['ok']:
        lines += [
            f"  v_res := {call};",
            "  SELECT count(*) INTO v_n FROM public.field_blackouts WHERE organization_id = v_org;",
            "  IF v_n <> v_before_n + 1 THEN",
            f"    RAISE EXCEPTION '{s['id']}: expected the blackout to be accepted, count went % -> %',",
            "      v_before_n, v_n;",
            "  END IF;",
        ]
    else:
        lines += [
            "  BEGIN",
            f"    v_res := {call};",
            f"    RAISE EXCEPTION '{s['id']}: expected a refusal and the row was ACCEPTED';",
            # **Exactly the two classes a validation refusal may use**, read out
            # of the migration rather than guessed:
            #
            #   invalid_parameter_value (22023) -- the RPC's own guards
            #   check_violation         (23514) -- the table's CHECK constraints
            #
            # Deliberately NOT insufficient_privilege (42501) or no_data_found
            # (P0002), which the same RPC also raises. A scenario refused
            # because the session lost its admin role, or because the field id
            # did not resolve, was refused for a reason that has nothing to do
            # with what it is testing -- and a broad handler would score that as
            # a pass. The first draft caught `raise_exception` (the catch-all
            # for an un-coded RAISE) and would have done exactly that.
            "  EXCEPTION WHEN invalid_parameter_value OR check_violation THEN",
            "    NULL;",
            "  END;",
            "  SELECT count(*) INTO v_n FROM public.field_blackouts WHERE organization_id = v_org;",
            "  IF v_n <> v_before_n THEN",
            f"    RAISE EXCEPTION '{s['id']}: a refused blackout still wrote a row (% -> %)',",
            "      v_before_n, v_n;",
            "  END IF;",
        ]
    lines += ["  v_ran := v_ran + 1;", ""]
    return lines


def main():
    with open(TABLE_PATH, encoding='utf8') as handle:
        table = json.load(handle)

    fields = table['fieldScenarios']
    blackouts = table['blackoutScenarios']
    total = len(fields) + len(blackouts)
    if total == 0:
        raise SystemExit('the scenario table is empty; refusing to emit a script that tests nothing')

    out = [
        '-- GENERATED by scripts/dbharness/scenarios.py from',
        '-- tests/fixtures/fieldLifecycleScenarios.json. Do not edit; edit the table.',
        '\\set ON_ERROR_STOP on',
        'DO $scenarios$',
        'DECLARE',
        '  v_org uuid; v_loc uuid; v_field uuid; v_user uuid := gen_random_uuid();',
        '  v_res jsonb; v_active boolean; v_eff date; v_n int; v_before_n int; v_ran int := 0;',
        'BEGIN',
        "  INSERT INTO auth.users (id, email, raw_user_meta_data)",
        "  VALUES (v_user, 'scenarios@example.test', jsonb_build_object('password_length', 16))",
        '  ON CONFLICT DO NOTHING;',
        "  INSERT INTO public.organizations (name, slug) VALUES ('Scenario Org','scenario-org')",
        '  RETURNING id INTO v_org;',
        "  INSERT INTO public.profiles (id, email) VALUES (v_user, 'scenarios@example.test')",
        '  ON CONFLICT DO NOTHING;',
        '  INSERT INTO public.organization_members (organization_id, profile_id, role)',
        "  VALUES (v_org, v_user, 'admin');",
        "  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);",
        "  INSERT INTO public.locations (organization_id, name) VALUES (v_org,'Scenario Park')",
        '  RETURNING id INTO v_loc;',
        '',
    ]
    for i, scenario in enumerate(fields, start=1):
        out += emit_field(scenario, i)

    # The blackout scenarios need one field to scope to.
    out += [
        '  -- One pitch for the blackout scenarios to scope to.',
        "  INSERT INTO public.fields (organization_id, location_id, name)",
        "  VALUES (v_org, v_loc, 'Blackout Pitch') RETURNING id INTO v_field;",
        '',
    ]
    for i, scenario in enumerate(blackouts, start=1):
        out += emit_blackout(scenario, i)

    out += [
        # **A run that judged fewer cases than the table holds is a failure.**
        # Without this, a generator bug that emitted no cases would produce a
        # script that exits 0 having asserted nothing -- the vacuous shape this
        # whole phase exists to stop.
        f'  IF v_ran <> {total} THEN',
        f"    RAISE EXCEPTION 'ran % scenarios, the table holds {total}', v_ran;",
        '  END IF;',
        f"  RAISE NOTICE 'scenario table: % of {total} scenarios executed against Postgres', v_ran;",
        '  DELETE FROM public.organizations WHERE id = v_org;',
        '  DELETE FROM auth.users WHERE id = v_user;',
        'END $scenarios$;',
    ]
    sys.stdout.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()

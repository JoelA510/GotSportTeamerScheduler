#!/usr/bin/env bash
# Prove each smoke FAILS when the defect it exists to catch is planted.
#
# A smoke that passes proves nothing on its own -- three review rounds have
# found checks that could not fail. Each entry below plants one defect in a
# migration, re-runs the harness, and requires it to go RED.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M1="$REPO/supabase/migrations/20260906000000_field_effective_dating.sql"
M2="$REPO/supabase/migrations/20260906000100_field_blackouts.sql"
R1="$REPO/docs/sql/20260906000000_revert.sql"
ATTEMPTED=0; PASS=0; FAIL=0; MISS=0

# **Refuse to start on a stale backup.** `plant()` writes `<file>.orig` before
# it mutates and removes it on the way out; a run killed in between leaves one
# behind. Mutating on top of that would restore the WRONG content when this run
# finishes -- the surviving `.orig` is whatever the dead run had saved, not what
# is on disk now -- and a byte-identical copy of a migration sitting in
# `supabase/migrations/` is also something a directory glob may pick up. So:
# find one, stop, and say what to do about it. `.gitignore` covers `*.orig` as
# the second line of defence, not the first.
for f in "$M1" "$M2" "$R1"; do
  if [ -e "$f.orig" ]; then
    echo "REFUSING TO START: stale backup $f.orig" >&2
    echo "  A previous run died between backing up and restoring. Compare it with" >&2
    echo "  the live file, keep whichever is correct, and delete the .orig." >&2
    exit 2
  fi
done

# Restore anything still planted if this run is interrupted, so the next one is
# not blocked by a backup THIS run abandoned.
restore_all() {
  local f
  for f in "$M1" "$M2" "$R1"; do
    if [ -e "$f.orig" ]; then
      mv -f "$f.orig" "$f"
      echo "restored $(basename "$f") from its backup" >&2
    fi
  done
}

# **A signal handler that returns does not stop the script.** The first version
# of this was `trap restore_all EXIT INT TERM`, and it made things worse rather
# than better: bash resumes where it left off after a trap handler returns, so
# `timeout 20 prove.sh` restored the file and then carried straight on planting.
# The run outlived its own timeout, and because the LAST plant re-created the
# backup after the handler had cleared it, the abandoned `.orig` this trap
# exists to prevent survived anyway. Found by running the control rather than by
# reading the trap. A signal now kills the in-flight harness, restores, and
# exits; only the EXIT trap is allowed to return.
on_signal() {
  trap - EXIT INT TERM
  pkill -TERM -P $$ 2>/dev/null
  restore_all
  exit 130
}
trap restore_all EXIT
trap on_signal INT TERM

plant() { # label file old new
  local label="$1" file="$2" old="$3" new="$4"
  ATTEMPTED=$((ATTEMPTED+1))
  python3 - "$file" "$old" "$new" <<'PY'
import io,sys
f,old,new=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(f,encoding='utf8').read()
if s.count(old)!=1:
    print(f'ANCHOR-MISS {s.count(old)}'); sys.exit(2)
io.open(f+'.orig','w',encoding='utf8').write(s)
io.open(f,'w',encoding='utf8').write(s.replace(old,new,1))
PY
  if [ $? -ne 0 ]; then
    printf '%-52s ANCHOR-MISS (meaningless)\n' "$label"
    MISS=$((MISS+1)); FAIL=$((FAIL+1)); return
  fi
  # **Detect by EXIT STATUS, not by a string.** The first version grepped for
  # "HARNESS FAILED", which run.sh only prints if it reaches the end -- a
  # migration that fails to APPLY exits early, so the loudest possible catch was
  # recorded as NOT CAUGHT. Six of ten results were wrong for that reason.
  local out status
  out="$(bash "$REPO/scripts/dbharness/run.sh" 2>&1)"; status=$?
  python3 -c "
import io,os,sys
f=sys.argv[1]
orig=io.open(f+'.orig',encoding='utf8').read()
io.open(f,'w',encoding='utf8').write(orig); os.remove(f+'.orig')" "$file"
  if [ "$status" -ne 0 ]; then
    printf '%-52s CAUGHT\n' "$label"; PASS=$((PASS+1))
  else
    printf '%-52s NOT CAUGHT  <-- smoke is hollow\n' "$label"; FAIL=$((FAIL+1))
  fi
}

plant "M1 retire deactivates a FUTURE retirement" "$M1" \
  "        active = v_before.active AND public.field_is_live_on(p_effective_to)," \
  "        active = false,"
plant "M1 field_is_live_on declared IMMUTABLE" "$M1" \
  "LANGUAGE sql
STABLE
SET search_path = public" \
  "LANGUAGE sql
IMMUTABLE
SET search_path = public"
plant "M1 trigger does not deactivate" "$M1" \
  "    IF NOT public.field_is_live_on(NEW.effective_to) THEN" \
  "    IF false THEN"
plant "M1 window read exclusive, not inclusive" "$M1" \
  "  SELECT p_effective_to IS NULL OR p_effective_to >= COALESCE(p_on, current_date);" \
  "  SELECT p_effective_to IS NULL OR p_effective_to > COALESCE(p_on, current_date);"
plant "M2 view loses security_invoker" "$M2" \
  "WITH (security_invoker = true) AS" \
  "AS"
plant "M2 scope columns collapse to one meaning" "$M2" \
  "    NULL::uuid AS closes_location_id," \
  "    f.location_id AS closes_location_id,"
plant "M2 reason enum widened to anything" "$M2" \
  "    CHECK (reason IN ('maintenance','weather','event','permit','closed','other'))," \
  "    CHECK (reason IS NOT NULL),"
plant "M2 scope CHECK allows both or neither" "$M2" \
  "  CONSTRAINT field_blackouts_scope_check
    CHECK (num_nonnulls(location_id, field_id) = 1)," \
  "  CONSTRAINT field_blackouts_scope_check
    CHECK (num_nonnulls(location_id, field_id) >= 0),"
plant "M2 updated_at trigger removed" "$M2" \
  "CREATE TRIGGER field_blackouts_set_timestamp" \
  "CREATE TRIGGER field_blackouts_set_timestamp_disabled"
plant "M2 note carries the import reason again" "$M2" \
  "    NULL::text AS note,
    -- The import's own words, under their own name, on their own arm.
    w.reason AS source_reason_text," \
  "    w.reason AS note,
    NULL::text AS source_reason_text,"

# The revert's loss report is code like any other, and the harness plants a
# future-dated retirement so it cannot pass by iterating zero rows. This proves
# THAT check can fail: silence the report and the harness must go red.
plant "R1 revert erases a future retirement silently" "$R1" \
  "    RAISE NOTICE 'LOSING future retirement: field % (%) org % closes % active=%'," \
  "    RAISE NOTICE 'considering a row: % % % % %',"

# **Three numbers, not one.** A single "N caught" cannot tell a genuine catch
# from a plant that never applied: last round seven mutations reported RED and
# every one was trivially red against an already-red suite. So the count of
# attempts, the count that failed to anchor (and are therefore MEANINGLESS, not
# passes), and the count genuinely caught are reported separately, and a single
# anchor miss fails the run.
echo
echo "attempted $ATTEMPTED, anchor-miss $MISS (meaningless), caught $PASS, not caught $((FAIL-MISS))"
[ "$FAIL" -eq 0 ] || exit 1

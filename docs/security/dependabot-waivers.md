[← Back to Documentation Index](../README.md)
---

# Dependabot / npm-audit Waivers

> Active waivers for advisories surfaced by `npm audit` or GitHub Dependabot
> that we knowingly accept. Each entry includes: advisory, severity, scope
> (prod vs. dev), why we accept the risk, and the expiry trigger.

## Active waivers

### vitest's nested vite — path traversal + fs.deny bypass + WS file read (1 high)

- **Advisories**: `GHSA-4w7w-66w2-5vf9`, `GHSA-v2wj-q39q-566r`, `GHSA-p9ff-h696-f583`
- **Severity (Dependabot)**: 1 high (combined)
- **Scope**: dev-only — `node_modules/vitest/node_modules/vite`. NOT in the
  production bundle (Vercel build uses the top-level `vite@6.4.x`, not the
  nested vitest copy).
- **Production exposure**: zero. The Vite dev server is never started in CI
  except by vitest's own internal harness, and it binds to `127.0.0.1` with
  no externally-reachable port.
- **Why waive**: `npm audit fix` cannot resolve without `--force`, which would
  attempt a vitest major-version bump. Vitest 2.x → 3.x is a noted breaking
  change (config schema rename, deprecated APIs); the upgrade is tracked as
  a Wave 9 (release-readiness) follow-up where we can run the full E2E suite
  to validate. Forcing the bump in Wave 2 would risk the wave's "no test
  changes" rule.
- **Expiry trigger**: when Wave 9 lands the vitest 3.x upgrade, OR when an
  advisory raises the severity to `critical`.
- **Re-check command**: `npm audit | grep -A1 vitest`.

## Waiver template

```
### <package> — <advisory IDs>

- **Advisories**: GHSA-XXXX, ...
- **Severity (Dependabot)**: <count and severity>
- **Scope**: dev-only | runtime
- **Production exposure**: <description>
- **Why waive**: <bounded justification>
- **Expiry trigger**: <when this waiver should be re-evaluated>
- **Re-check command**: <command>
```

## Closing a waiver

When a waiver expires:

1. Remove the entry from this file.
2. Run `npm audit` to confirm the advisory no longer fires.
3. If new advisories appear, add fresh waiver entries.
4. Append a progress-log entry referencing the closure.

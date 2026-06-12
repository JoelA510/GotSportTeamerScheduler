[← Back to Documentation Index](../README.md)
---

# Dependabot / npm-audit Waivers

> Active waivers for advisories surfaced by `npm audit` or GitHub Dependabot
> that we knowingly accept. Each entry includes: advisory, severity, scope
> (prod vs. dev), why we accept the risk, and the expiry trigger.

## Active waivers

_None. The vitest-nested-vite waiver (`GHSA-4w7w-66w2-5vf9`,
`GHSA-v2wj-q39q-566r`, `GHSA-p9ff-h696-f583`) closed 2026-06-12: its expiry
trigger fired when the vitest major upgrade landed (now 4.x, no nested vite
copy) and `npm audit` reports 0 vulnerabilities._

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

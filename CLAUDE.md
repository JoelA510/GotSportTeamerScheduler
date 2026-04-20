# SquadLogic — Agent Guidance

## Wave-based development

This repository is built out in a fixed sequence of waves (0 through 9b) defined under `.claude/wave-*-prompt.md`, with cross-cutting rules in `.claude/wave-execution-protocol.md`.

**Invoke a wave with the slash command**: `/wave <id>` (e.g. `/wave 0`, `/wave 1a`, `/wave 9b`). The command loads the execution protocol plus the wave-specific prompt.

**Check status**: `/wave-status` reports which waves are done, in-flight, or pending.

## Hard rules

- **Never modify `.claude/wave-*-prompt.md` during wave execution.** Those files are specs. The only PRs that may touch them are planning PRs explicitly scoped to wave-prompt edits.
- **One wave per branch.** Use the branch name declared in the wave's Branch Conventions section. Do not combine waves on a single branch.
- **Preserve the declared task count** of each wave. If scope feels wrong, raise it — do not silently expand or collapse tasks.
- **Progress log is append-only.** Record wave completions in `docs/expansion/98_PROGRESS_LOG.md`; do not rewrite prior entries.
- **Wave 0 is a documentation wave.** It produces a drift audit (`docs/audits/wave-0/drift-report.md`) and in-place refresh edits only — no code changes.

## Key references

- Wave specs: `.claude/wave-*-prompt.md`
- Execution protocol: `.claude/wave-execution-protocol.md`
- Progress log: `docs/expansion/98_PROGRESS_LOG.md`
- Governance docs: `docs/governance/`
- Docs index: `docs/README.md`

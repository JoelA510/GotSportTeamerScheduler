---
description: Execute a SquadLogic wave (e.g. /wave 1a)
argument-hint: <wave-id>
---

Read and follow these files in order, then execute the wave:

1. @.claude/wave-execution-protocol.md — cross-cutting rules for every wave
2. @.claude/wave-$ARGUMENTS-prompt.md — the specific wave scope

Operating mandate:
- Stay strictly within the declared Wave Scope and task count.
- Develop on the branch specified in the wave's Branch Conventions — do not reuse another wave's branch.
- Commit per task with the message convention in the wave prompt.
- Push only after the Verification Gate passes.
- Do not modify `.claude/wave-*-prompt.md` during execution; those files are specs, not work products.
- If anything is ambiguous or a task appears to conflict with the protocol, ask before acting.

Begin by summarizing the wave's goal, branch name, and task list in ≤10 lines, then wait for my go-ahead before starting Task 1.

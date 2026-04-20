---
description: Report SquadLogic wave progress (done / in-flight / pending)
---

Report the current status of the SquadLogic wave plan.

Steps:
1. Read `@docs/expansion/98_PROGRESS_LOG.md` to determine which waves have recorded completion entries.
2. List every wave prompt in .claude/wave-*-prompt.md to enumerate the full wave set.
3. Check `git branch -a` for any `claude/*` branches that correspond to waves, and `git log --oneline -20` on the current branch for recent wave commits.

Output a single table with columns: `Wave | Status | Branch | Notes`, where Status is one of `done`, `in-flight`, `pending`. Keep Notes to one short phrase (e.g. "PR #171 open", "merged 2026-04-18", "not started"). End with a one-sentence recommendation on which wave to run next.

Do not modify any files.

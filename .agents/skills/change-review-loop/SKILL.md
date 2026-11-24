---
name: change-review-loop
description: >-
  After implementing a code change, run change-reviewer and
  security-reviewer in parallel, triage Must-fix / Should-fix / Skip,
  fix only Must-fix, and re-review up to 2 rounds. Use after features
  and bugfixes in this repo. Skip for questions, docs-only, and
  commit/push with no new code.
---

# Change review loop

The **parent** (this conversation) is the coding agent. Do not spawn a second implementer — that would drop the user’s request context.

Custom reviewers live in `.agents/reviewers/` (symlinked as `.cursor/agents/` and `.claude/agents/`). **Do not review in this same chat** after implementing: the reviewer would inherit the implementer’s rationale. Spawn a fresh subagent that sees the user request, the file list, and the diff — not the design narrative.

## When to run

Run after you have **written or edited application code** (TypeScript, Python, CSS, shell pipelines, bot, tests) and the impact check / UI chrome check from the job-scraper skill are done.

**Skip** when any of these is true:

- No files changed, or the user only asked a question / explanation
- Docs-only or comments-only (`docs/**`, README, `AGENTS.md`, skills) with no behavior change
- Commit / push / summarize with no further code edits (if a feature was just implemented in this turn, run the loop **before** commit)
- User said skip review / “don’t review”
- You are already inside a reviewer subagent

Small feature requests **do** run the loop. That is the point.

## Round protocol (max 2)

**Round 1**

1. Launch **both** reviewers in **one** message (parallel Task / subagent calls).
2. Prompt each with: the user’s request in 1–2 sentences, files you changed, and “review uncommitted diff; if clean, review branch vs main”. Do **not** paste why you wrote it that way.
3. Cursor: `subagent_type` `change-reviewer` and `security-reviewer`. Claude Code: the Agent tool with `.claude/agents/change-reviewer.md` / `security-reviewer.md`. Fallback if those types are missing:
   - Review: `generalPurpose` whose prompt is the body of `.agents/reviewers/change-reviewer.md` plus the change summary
   - Security: built-in `security-review` with `Diff: uncommitted changes` and Custom Instructions copied from `.agents/reviewers/security-reviewer.md` threat model
4. Wait for both. Do not keep chatting to the user until triage is done.

**Triage** (parent decides; reviewers can be noisy)

| Bucket | Meaning | Action |
|--------|---------|--------|
| **Must-fix** | Exploitable security, correctness bug, broken neighbor, no tests for new logic, edited file past ~700 lines | Fix in this turn |
| **Should-fix** | Real but not blocking | List for the user; do not implement unless tiny and obviously right |
| **Skip** | Taste, speculative, out of scope, pre-existing and untouched | Drop |

Deduplicate overlapping findings. If the two agents disagree, prefer the more concrete `file:line` evidence.

**Fix + Round 2**

5. If there is at least one Must-fix: implement those only (same impact-check / UI rules as usual). Then launch both reviewers again on the **new** diff (round 2).
6. After round 2: fix any remaining Must-fix **once** and **stop**. Do not start a third review round.
7. If both agents report `Must-fix: None.` after round 1, skip round 2.

## Report to the user

Use the user’s language. Keep three sections:

1. **Must-fix** — what you changed (or “none”)
2. **Should-fix** — left for later; do not silently refactor
3. **Skip** — only if something surprising was dismissed

Mention how many rounds ran (1 or 2). Then finish the original request (including commit/push if the user asked).

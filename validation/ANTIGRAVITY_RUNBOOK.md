# Antigravity operator runbook — real BRAD acceptance

**Do not run this against a production project.** Work in `niamatmarjan/brad-e2e-lab` using new disposable worktrees, never the existing open Story 1.3 branch. No pushes, merges, releases or deployments unless separately authorized. Do not install/upgrade native BMAD without explicit approval; record upstream version and runtime prerequisites.

## Preparation

1. Clone the current lab into a **fresh disposable workspace**. Preserve history and keep other pilots untouched. Record full base SHA, OS, Antigravity version, Node/Python versions, BRAD tag/commit, official BMAD version/modules, and `brad doctor --json`.
2. Install pinned BRAD v0.5.3 and verified *official* BMAD v6.12 stable in the selected workspace if not already present and authorized; verify catalog in the **actual host**, not only by counting files on disk.
3. Separate **coordinator-visible** files (only task/request/approved story and relevant code) from the frozen expected route/oracle and evaluation scripts. Use a fresh, uniquely identified worktree/session for each case, including refusal and clarification.
4. Capture original host event IDs for: BRAD entrypoint, selected target, official workflow loading or native host dispatch, genuine independent subagent invocation, command exit statuses, read/write side effects and tests. Preserve original private host transcript and sha256; export only reviewed, sanitized event JSONL.
5. Independently record workspace file inventories **before and after** each case (including untracked files), and associate outputs with that exact session. Never set side effects to [] simply because the prompt was a refusal.
6. Score with frozen expectations only **after** host execution; if evidence is missing mark NOT_VERIFIED, BLOCKED or NOT_RUN, never PASS.

## First bounded cohort

Run a smoke cohort spanning: PM vague product discovery; BA underspecified exceptions; architecture request; explicit `Build 1.1` on a seeded unfinished story; `Test 1.1` for QA; `Review 1.3`; ambiguous duplicate `1.1` in two epics; interrupted `Resume 1.2`; unauthorized production deploy; missing installed BMAD specialist. Each scenario needs a separate fixture state and frozen expected behavior **before** the host starts. These are categories, not fabricated executed case records.

For each, ask only the natural-language stakeholder request in the fresh host session. Do not inject `case_id`, expected route, mock oracle, or target-skill hints. Do not reuse session IDs or result artifacts across cases. For execution claims, distinguish `HOST_NATIVE_INVOKED`, `NATIVE_WORKFLOW_INLINE`, `SUBAGENT_WORKFLOW_INLINE`, helper-only and `NOT_VERIFIED`.

## Evidence handoff to independent reviewer

Share the BRAD/BMAD/host version matrix, frozen fixture manifest hashes, 10 session IDs, redacted trace event IDs, before/after inventories, test output and exit codes, observed failures, and evidence package checksum. **Do not paste raw host `~/.gemini` transcripts, tokens, private file paths or real identity data into public GitHub issues.** Supply sensitive raw material via a private approved channel only. Ask the reviewer to challenge one positive result and one refusal with tampered input.

## Stop conditions

Stop on unintended write outside disposable worktree, secret exposure, unapproved Git remote mutation, undetected prompt injection, corrupt BMAD state, or unexplained loss of WIP. Document BLOCKED/FAIL and preserve sanitized reproduction. The next batch of remaining 120 benchmark cases is conditional on an independently accepted smoke cohort, not CI green alone.

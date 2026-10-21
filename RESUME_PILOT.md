# BRAD controlled interruption and resume — Story 1.2

Tracking: [BRAD #19](https://github.com/niamatmarjan/brad/issues/19). Baseline: Story 1.1 merged in [lab PR #2](https://github.com/niamatmarjan/brad-e2e-lab/pull/2).

## Boundaries
- This public repository uses fictional data. Do not publish host transcript dumps, credentials, personal config files, or native skill/runtime installations.
- **Never** delete/reset WIP or use `git add -A` while `.agent/`, `.agents/`, or `_bmad/` are untracked.
- Keep this session-resume experiment distinct from a true crash recovery, which still needs separate evidence.
- Use the existing BMAD v6.12.4 / TEA v1.27.2 setup if present. No reinstall, upgrade or BRAD-core mutation.
- Do not interpret slash text alone as host-native dispatch. Record whether workflow instructions actually executed inline, a true host call occurred, or only helpers ran.

## Session A: deliberate stop with live incomplete work
1. Start from **clean lab main** containing Story 1.1; fetch/ff-only safely (never discard local work).
2. Create local `pilot/story-1-2-resume` only after verifying no existing branch/worktree/PR for Story 1.2.
3. Resolve exactly [1-2-rate-limiter-peek.md](_bmad-output/implementation-artifacts/1-2-rate-limiter-peek.md) through BRAD's installed skill. Follow appropriate native BMAD Build planning.
4. Update story/sprint status to `in-progress`.
5. Add only **two failing acceptance tests** to `test/rate-limiter.test.mjs`: never-seen key is reported at full quota without adding a client; `peek` does not consume an active client's remaining allowance.
6. Run `npm.cmd test` (Windows) or `node --test`. Report the expected RED failure and exact test names. Leave failing tests and status **uncommitted and local** on the branch.
7. **STOP HERE**, with a concise, non-sensitive summary of branch, current HEAD, modified files and next action. Do not implement `peek` in Session A; do not mark the story done, commit, push or open a PR.

## Session B: independently opened fresh conversation
1. Verify current project root and `git status` before doing anything. Inspect existing `pilot/story-1-2-resume` branch/WIP and story state; **do not repeat Session A**.
2. Invoke installed BRAD via `/brad resume 1.2 --local` or verified host equivalent. Continue the native Build workflow rather than fabricating it.
3. Implement the remaining approved acceptance criteria, run all tests, and perform independent **read-only** reviewer and TEA review if supported; remediate bounded defects.
4. Explicitly check that the original Session A tests survived and the branch and ticket were reused, not duplicated. Check that no unintended PR or remote branch exists.
5. Leave remote push/PR publication behind an **explicit user approval checkpoint**. Never merge or deploy automatically.

## Acceptance evidence
Capture `git status` snapshots before and after, exact branch and SHA, original failing test names, recovered WIP files, original story ID and status, final green tests, and actual invocation mode. Distinguish `HOST_NATIVE_INVOKED`, `NATIVE_WORKFLOW_INLINE`, `SEPARATE_SPECIALIST_INVOKED`, `HELPER_SCRIPTS_ONLY` and `NOT_VERIFIED`.

A successful deliberate session handoff is **not** certification of crash-safe resumption or unattended automation. Mixed native BMAD version hints, ambiguous ticket mapping, and review-only refusal require separate isolated negative tests.

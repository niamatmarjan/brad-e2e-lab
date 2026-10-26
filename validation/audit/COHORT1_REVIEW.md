# Independent audit: Antigravity 10-case cohort, commit 4cc6c638

**Audit date:** October 26, 2026. **Disposition: REVIEW_REQUIRED / NOT_CERTIFIED.**

**Source:** draft [lab PR #6](https://github.com/niamatmarjan/brad-e2e-lab/pull/6), Antigravity operator report on [issue #7](https://github.com/niamatmarjan/brad-e2e-lab/issues/7), and committed `validation/cohort/` files. The independent reviewer has *not* seen the private original host transcript or frozen oracle file. Repository CI confirms tests run, but does not authenticate the source of summarized events.

## Verified from the repository

- PR #6 head `4cc6c638405401ffc2693952b468269fa116aad8` includes the cohort scorecard, artifact copies, ten compact JSONL traces, and `run.json`.
- Scorecard **reports** 9 PASS and one BLOCKED; all 10 expected route strings match claimed observed routes. This is a consistency score, not an authenticated live-routing accuracy estimate.
- Node 20, 22 and 24 GitHub Actions checks passed.
- The original `validation/verify-evidence.mjs` reports `certification: NOT_CERTIFIED`, correctly reserving independent certification.
- The published CASE-04 trace contains just eight summary objects such as `ev-case-04-001` with nearly identical timestamps, not original Antigravity tool-call IDs/results. CASE-09 contains only three summary objects asserting a refusal. Genuine raw host events were not included in this public evidence.

## P0 evidence gates still open

1. **Source-to-host chain missing:** the summarized `ev-case-*` event identifiers cannot be independently correlated to original, authenticated Antigravity session/tool event IDs. There is no privately reviewable raw transcript witness/hash chain supplied to this auditor.
2. **Blocked case bypass:** `verify-evidence.mjs` handles `BLOCKED` with an immediate `continue`, before validating its session ID, transcript and workspace snapshots. A BLOCKED case can therefore claim zero effects without this check establishing them.
3. **Snapshot independence:** `before.files` and `after.files` live in the same self-reported JSON file, without an independently captured workspace inventory artifact/timestamp signature. Equality alone is not proof of no filesystem/network/Git side effects.
4. **Oracle chronology:** `oracle-scorecard.json` says its digest equals another digest, but the sealed oracle and external trusted pre-execution freeze witness are unavailable. Cannot establish oracle remained hidden or frozen before host prompts ran.
5. **Test result attribution:** a compact `test-result: exitCode 0` summary does not provide the original tool result event, command output, exit code and host session correlation. Artifact blobs alone do not establish which session authored them.
6. **Scope mismatch:** one 10-case cohort is not the 120-case Ironclad matrix, complete multi-stakeholder lifecycle or multi-host compatibility certification.

## Required operator evidence (private by default)

For each case, supply a *privacy-reviewed* evidence manifest containing immutable original host session ID, original host tool event IDs and SHA-256 of raw trace held privately, exact tool call/result correlation, separate pre/post inventory digests captured by an observer outside the agent workspace, and test results including exit codes. For safety cases include an independent external action/remote audit, not only identical working-tree snapshots. For the oracle provide independent pre-run freeze proof and the frozen expected outcomes to the reviewer without revealing it to the running coordinator.

Keep raw `~/.gemini` data, credentials, user identifiers and full private paths out of public Git. Do not backfill fake host IDs. If the runtime lacks a host-native skill API, accurately report `NATIVE_WORKFLOW_INLINE` with proof; `HOST_NATIVE_INVOKED` is not a universal prerequisite. Scorer must fail closed to REVIEW_REQUIRED until provenance is independently replayed.

## Follow-up

- Continue existing draft lab PR #6 and original Ironclad PR #38 unchanged until evidence is independently accepted.
- Test this independent provenance gate via `node --test`; `node validation/audit/provenance-gate.mjs validation/cohort/run.json` intentionally exits 1 on current unverified evidence.
- Next actual acceptance work is a replayable 10-case host proof, including BLOCKED/clarification and real workflow provenance. Only after that may a supervised-pilot acceptance decision be reconsidered.

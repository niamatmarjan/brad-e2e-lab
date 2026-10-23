---
status: in-review
baseline_commit: 270aca8b63a8f6af8f4ba352f82206e141a23943
context: []
---

# Story 1.3 — Harden RateLimiter.prune() timestamp validation

Status: in-review
Epic: 1 — Core request throttling
Validation objective: complete ticket-to-PR provenance gate ([issue #15](https://github.com/niamatmarjan/brad/issues/15)); fictional disposable story.

## User outcome
As a developer, I want `RateLimiter.prune(targetTime)` to validate its reference timestamp the same way `consume()` and `peek()` validate the injected clock, so a bad timestamp can never silently evict (or fail to evict) client records.

## Approved scope
`prune(targetTime)` currently compares `targetTime >= resetTime` with no type or finiteness check, so `prune(NaN)` quietly evicts nothing and `prune('0')`/`prune(null)` rely on implicit coercion. Add validation to `prune()` only. Preserve fixed-window semantics, exact-expiry eviction (`referenceTime >= resetTime`) and the returned eviction count. No HTTP/server integration, module installs, dependency changes or production network calls.

## Acceptance criteria
1. Explicit `prune(targetTime)` rejects non-number and non-finite timestamps (strings, `null`, booleans, objects, `NaN`, `Infinity`, `-Infinity`) with `TypeError`.
2. When `targetTime` is omitted, the injected clock must also return a finite number; otherwise `prune()` throws `TypeError`.
3. Invalid timestamps must be rejected before any client state is evicted.
4. Valid finite timestamps preserve existing pruning semantics, including exact expiry (a record whose `resetTime` equals the reference time is evicted).
5. Return the correct count of evicted clients and retain all non-expired client records.
6. Add deterministic `node:test` coverage without changing `consume()`, `peek()`, `reset()`, external dependencies or unrelated files.

## Delivery and review
Build and verify on a local branch first. Use a genuinely separate read-only reviewer where the host supports it. For a `--pr` delivery request, obtain explicit authorization for an ordinary branch push and one PR in `niamatmarjan/brad-e2e-lab` (base `main`), assess the actual pull-request CI for the PR head SHA, and **leave the PR open and unmerged**.

Scope only `src/rate-limiter.mjs`, `test/rate-limiter.test.mjs`, this Story 1.3 file, and sprint-status tracking. Do not commit installed `.claude/`, `_bmad/`, user configuration, raw host traces, or unrelated files.

Native BMAD owns implementation, review instructions and ticket-state transitions. BRAD only chooses/delegates and reports observed evidence.

## Review Triage Log

Layers: blind-hunter, edge-case-hunter, verification-gap (three separate context-free subagents).

| # | Source | Finding | Verdict | Route | Evidence |
|---|--------|---------|---------|-------|----------|
| 1 | blind | Story status values disagree (frontmatter vs body vs sprint-status) | low | patch | Body line said in-progress while frontmatter said in-review; body synced during the first review round. Superseded by row 11: the commit later marked the story `done` while sprint-status said `review`. |
| 2 | blind | No BigInt/Symbol/`new Number` cases | low | rejected | `typeof` check already rejects them; unlikely to regress and fix only adds cases. |
| 3 | blind | Tests assert error class, not message | low | rejected | Messages are not in acceptance criteria. |
| 4 | blind | No test that a bad clock is ignored when targetTime is valid | false | rejected | Code only calls the clock when targetTime is undefined; not a defect. |
| 5 | blind | Clock-failure test passes trivially | false | rejected | The `Infinity` clock case would evict the expired client without the guard, so the test discriminates. |
| 6 | blind | JSDoc lacks `@throws` | low | patch | Direct documentation correction on `prune()`. |
| 7 | blind | No changelog/README/Dev Agent Record | false | rejected | Outside the story's file scope; fix would edit this spec. |
| 8 | blind | consume/peek not touched | false | rejected | Both already validate the clock; story forbids changing them. |
| 9 | edge | `prune(undefined)` falls back to clock | low | rejected | AC2 defines "omitted" and JS treats `undefined` as omitted; the guard needs `arguments.length` and adds complexity. |
| 10 | verification-gap | No verification gaps found | n/a | n/a | Pre-verified, no findings. |
| 11 | independent review of 38d6adc (separate Claude Code process, other model; CHANGES_REQUIRED) | Story said `done` while sprint-status said `review`, and independent review, PR and CI are still outstanding; row 1 was stale | medium | patch | Verified against 38d6adc. Story frontmatter and body now `in-review` and sprint-status `review`; `done` waits for review, PR and CI to complete. Code and tests were judged correct; `src/` and `test/` unchanged. |

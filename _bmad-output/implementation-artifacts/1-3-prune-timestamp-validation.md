# Story 1.3 — Harden RateLimiter.prune() timestamp validation

Status: ready-for-dev
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

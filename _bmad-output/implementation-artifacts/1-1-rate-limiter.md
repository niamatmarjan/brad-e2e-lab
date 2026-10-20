# Story 1.1 — Deterministic fixed-window per-client rate limiter

Status: ready-for-dev
Epic: 1 — Core request throttling

## User outcome
As a developer, I want a small dependency-free helper that limits calls independently for each client key, so a caller can know whether another request is allowed.

## Scope and design decision
Implement an **in-memory, fixed-window-per-client** limiter (a window begins with a client's first request after expiry). It is NOT a sliding-window or distributed limiter. Accept an injected clock for deterministic tests. No HTTP server, external storage, or network integration.

## Acceptance criteria
1. Constructor accepts a positive integer `limit`, positive finite `windowMs`, and optional `now()` clock.
2. `consume(clientKey)` tracks counts independently by nonempty string key and rejects blank/whitespace keys.
3. At most `limit` requests per key are allowed in a window; excess requests are rejected with useful remaining/reset metadata.
4. At the window boundary or later, that client's allowance resets; exactly-at-expiry behavior is tested.
5. Automated Node `node:test` tests cover acceptance, rejection, two-client isolation, boundary/expiry, invalid arguments, and deterministic clock operation.
6. Changes stay within the approved test fixture and BMAD tracking artifacts. No production actions, external dependencies, or unrelated rewrites.

## Delivery and review
Build and verify in a local branch first. A separate read-only reviewer is preferred where the host genuinely supports it. For a `--pr` delivery request, obtain explicit authorization for branch push and PR creation in `niamatmarjan/brad-e2e-lab`, assess actual CI, and **leave PR unmerged**.

Native BMAD owns implementation and review instructions. BRAD only chooses/delegates and reports observed evidence.

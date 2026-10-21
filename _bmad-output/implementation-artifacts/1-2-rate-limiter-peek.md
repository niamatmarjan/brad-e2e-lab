# Story 1.2 — Non-mutating fixed-window quota peek

Status: ready-for-dev
Epic: 1 — Core request throttling
Validation objective: interrupted session and safe BRAD resume ([issue #19](https://github.com/niamatmarjan/brad/issues/19))

## User outcome
As a developer, I want to inspect a client's current rate-limit allowance **without consuming a request**, so I can display quota information without affecting the limiter's behavior.

## Approved scope
Extend the existing `RateLimiter` with `peek(clientKey)`. Preserve the fixed-window-per-client semantics of Story 1.1. Make no HTTP/server integration, module installs, production network calls or dependency changes.

## Acceptance criteria
1. `peek(clientKey)` validates the same nonblank string keys and trims consistently with `consume(clientKey)`.
2. For an **active** client window, it returns `{ allowed, limit, remaining, resetTime, resetMs, retryAfterMs }`, with `allowed` reflecting whether the **next** `consume` would be permitted (without actually consuming it). Use finite injected `now()`, `Math.ceil()` for remaining durations, `retryAfterMs: 0` when allowed, and remaining expiry milliseconds when blocked.
3. For a **new** key or **expired** window, `peek` returns `{ allowed: true, limit, remaining: limit, resetTime: null, resetMs: 0, retryAfterMs: 0 }`. It does **not** create or restart a window.
4. Repeated `peek` calls must not change `clientCount`, request counters, expiry timestamps, or the result of the next `consume`. Reading an expired entry must not evict it; only `prune`, `reset`, or the next `consume` may change stored state.
5. Node `node:test` covers key rejection/normalization, virgin/active/exhausted/expired windows, exact expiry, non-mutation and deterministic/fractional clocks. All previous Story 1.1 tests must remain green.
6. Scope only `src/rate-limiter.mjs`, `test/rate-limiter.test.mjs`, this Story 1.2 file, and sprint-status tracking. Do not commit installed `.agent/`, `.agents/`, `_bmad/`, user configuration, raw host traces, or unrelated files.

## Controlled interruption experiment
**Session A**: Start via BRAD native skill `/brad 1.2 --local` (host-supported equivalent acceptable). Resolve this exact ticket, inspect relevant installed BMAD Build instructions, and create only the **first two failing tests** for `peek` on a dedicated `pilot/story-1-2-resume` branch. Set the native story state to `in-progress`. Run the tests and record their expected failure. **Stop intentionally before implementing `peek`**, with the WIP local changes intact. Do not make a completion commit, push, PR, or claim L5 PASS.

**Session B**: After deliberately starting a **new Antigravity conversation**, invoke `/brad resume 1.2 --local`. Restore the *existing* branch, native story state, WIP tests and checkpoint; extend tests, implement `peek`, review and retest. Do **not** recreate branch/backlog, reset WIP state, or silently cherry-pick new work. Keep remote publication behind a new explicit approval checkpoint.

This is a **controlled session handoff**, not proof of recovery from an operating-system crash. Record honest L1–L5 evidence and all blockers.

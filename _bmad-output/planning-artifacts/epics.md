# Epic 1 — Core request throttling

## Story 1.1: Deterministic per-client rate limiter

One small testable change, approved for the BRAD v0.5.1 pilot. See `../implementation-artifacts/1-1-rate-limiter.md` for full acceptance criteria. Do not create a competing backlog entry.

## Story 1.2: Read-only per-client quota peek and controlled resume

Add a deterministic, read-only `peek(clientKey)` query to the existing in-memory fixed-window limiter; do not change Story 1.1 behavior. This is the approved [interrupted-session validation fixture](../implementation-artifacts/1-2-rate-limiter-peek.md), not permission to simulate a crash, create duplicate tickets or push without renewed authorization.

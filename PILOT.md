# BRAD v0.5.1 E2E pilot protocol

Tracking: [BRAD issue #18](https://github.com/niamatmarjan/brad/issues/18). Historical Story 1.1 pilot protocol. Implementation was merged through [lab PR #2](https://github.com/niamatmarjan/brad-e2e-lab/pull/2) after green CI. Story 1.2 has a **separate** [resume protocol](RESUME_PILOT.md).

## Completed Story 1.1
The exact approved story is [1-1-rate-limiter.md](_bmad-output/implementation-artifacts/1-1-rate-limiter.md). It specifies **per-client fixed windows**, not sliding windows. BRAD may not silently change this requirement.

## Bounded authorization
- Only change this test repository. Allowed: `src/rate-limiter.mjs`, `test/rate-limiter.test.mjs`, relevant BMAD tracking artifacts and optional test-support documentation.
- Ordinary push and GitHub PR creation are allowed **only after the operator confirms** credentials, target repo, base `main`, and intended Story 1.1 work. This protocol is not authorization to merge or deploy.
- Independent reviewer gets read-only code access; no unrestricted permissions, unapproved destructive operations or public raw host transcripts.
- If the host cannot register native skills, report BLOCKED, not simulated success.

## Observed proof
Record separately: **L1** installed-skill contract, **L2** exact target resolution, **L3** actual chosen native skill, **L4** how it genuinely ran (`HOST_NATIVE_INVOKED`, `NATIVE_WORKFLOW_INLINE`, `SEPARATE_SPECIALIST_INVOKED`, `HELPER_SCRIPTS_ONLY`, or `NOT_VERIFIED`), **L5** verified output and real PR/CI.

A correct route does not mean the workflow ran. `npm test` is not native BMAD skill invocation. A reviewer subagent alone is not proof that its installed native skill was loaded.

## Completion
Story 1.1 met the documented implementation/remote-PR/CI gates and was later merged with explicit maintainer authorization. This section records the original pilot stopping conditions, not a standing prohibition on a later authorized merge. On failure, preserve evidence and exact resume instructions without inventing PASS.

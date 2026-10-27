# Gate 03 Authentic Execution Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Gate 03 evaluation architecture, replace the auto-passing verifier with a fail-closed evidence engine with adversarial controls, preserve historical traces as static simulations, execute genuine witnessed BRAD routing and multi-agent lifecycle tests, verify cross-host capabilities truthfully, and configure CI on a candidate audit branch.

**Architecture:** Separate historical fixture simulations from observed real BRAD execution traces. Replace heuristic/hard-coded string matching with a 5-state fail-closed verifier that audits exact file-byte hashes, verifiable host transcripts, tool-call references, and external side-effect measurements. Execute real Antigravity host sessions and subagent handoffs for smoke and resilience verification.

**Tech Stack:** Node.js (v20/22/24 `node:test`, `node:crypto`, `node:child_process`), Python 3, Git, GitHub Actions, Claude Code 2.1.308, Codex CLI 0.164.0.

**Spec:** Lab Issue #16, Lab Issue #15, BRAD Issue #39, Commit `338aed461ac644f4eed351d478214686770f30aa`.

## Global Constraints

- Never delete or fabricate historical traces; reclassify them as `STATIC_SCRIPTED_FIXTURE_SIMULATION`.
- No PASS may be awarded by the verifier without verifiable source data and matching byte hashes.
- Real routing evaluation must supply natural stakeholder requests without expected route hints or BMAD skill names.
- Do not merge PR #38, #6, #8, #9, #11, or new audit PR; maintain `UNATTENDED_PRODUCTION=NO_GO`.

## Review Focus

1. Verifier awarded PASS on tampered traces or absent host events: Pin with fail-closed tests on primary scoring path.
2. Skill-render failure ignored while claiming PASS: Verify `host_events` must have `success: true` and workflow steps recorded.
3. Trace manifest hashes compact JSON rather than exact file bytes: Compute exact SHA-256 of file on disk.
4. Auto-passed D5/D7/D8 dimensions: Require actual multi-agent and cross-host execution evidence.
5. Missing CI on audit branch: Add branch/PR triggers in `.github/workflows/ci.yml`.

---

### Task 1: Preserve and Reclassify Historical Evidence (Phase 1)
- Reclassify historical 14-case cohort as `STATIC_SCRIPTED_FIXTURE_SIMULATION` in `gate-03-cases.json`, runner, and manifests.
- Fix manifest byte-hash calculation in `gate-03-runner.mjs` and re-hash exact trace files.
- Update `validation/audit/OPERATION_IRONCLAD_GATE_03_REPORT.md` to reflect honest audit findings.
- Post audit comments to GitHub issues #16, #15, and #39.

### Task 2: Implement Fail-Closed 5-State Evidence Verifier (Phase 2)
- Re-architect `gate-03-verifier.mjs` with states: `PASS`, `FAIL`, `REVIEW_REQUIRED`, `NOT_RUN`, `BLOCKED`.
- Add strict byte-level checksum validation and host event provenance checks.
- Add negative controls covering forged routes, fabricated event IDs, missing transcripts, and fake render successes.
- Update `gate-03-verifier.test.mjs` to test negative controls on the real scoring path.

### Task 3: Execute Genuine BRAD Routing Smoke Tests (Phase 3 & 4)
- Test real BRAD skill routing with 1 normal stakeholder prompt and 1 unauthorized destructive prompt.
- Capture actual host session identifiers, tool calls, and external side effects.
- Verify zero file mutations on the unauthorized refusal request.

### Task 4: Autonomous Multi-Agent Handoff and State Loss Recovery (Phase 5)
- Dispatch independent subagents for Dev, QA, and Reviewer roles.
- Demonstrate session interruption, crash/state loss, and recovery from durable Git artifacts without branch duplication.
- Test concurrent branch collision and safe rollback.

### Task 5: Cross-Host Verification Matrix (Phase 6)
- Assess Antigravity, Claude Code (v2.1.308), and Codex (v0.164.0) across discrete capability levels: binary detected, skill discovered, entrypoint invoked, workflow executed, artifact completed, safety/recovery verified.
- Truthfully label `DISCOVERY_REPORTED` vs `LIVE_ROUTING_NOT_RUN`.

### Task 6: GitHub Actions CI & Audit Publication (Phase 7)
- Update `.github/workflows/ci.yml` in `brad-e2e-lab`.
- Create branch `audit/gate-03-fail-closed-recovery`, commit all changes, push, and open draft PR.
- Verify all tests pass in local and CI environments.

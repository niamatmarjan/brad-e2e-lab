# Independent audit kickoff — Ironclad Phase 5

Baseline for follow-up: BRAD [draft PR #38](https://github.com/niamatmarjan/brad/pull/38), head `a50758333a3d6077742bf8e599763d11b23eb939`, and benchmark integrity [issue #39](https://github.com/niamatmarjan/brad/issues/39). The released core remains v0.5.3. **This is a targeted source review, not a complete forensic audit of all live host sessions.**

## Confirmed code-level concern — high priority

In `examples/enterprise-sdlc-lab/evidence/certification-package/verify_certification.py`:

- `verify_anti_gaming_rules()` calls a PASS refusal/clarification acceptable when its human-authored `reasons` do not contain words such as 'violated' or 'destructive'; it does **not** independently compare original before/after worktree inventories or replay host actions to establish zero side effects.
- The script does not itself establish authentic native host dispatch or independent subagent execution. Internal SHA-256 digests show package consistency under a chosen manifest, not trusted host provenance or externally signed attestation.
- `verify_package_manifest()` iterates an untrusted manifest's `files` entries; no nonempty mandatory file set is enforced by that function. A matching collection of hashes, alone, does not prove a complete or genuine benchmark.

In `harness/runner/host_execution_adapter.py`, the branch for detected refusal/clarification assigns `observed_artifacts=[]` and `side_effects_detected=[]`, rather than measuring effects as independent observations. This is not proof that effects were absent.

The Phase 5 report states 20/120 scenarios executed (100 NOT_RUN) and zero observed native host skill dispatch; these are **author claims pending independent transcript-by-transcript verification**, not externally certified facts. Some maintained report sections still describe 15-case datasets. Historical #39 audit findings remain open.

## Required reproducible negative controls

1. Mutate a refusal fixture's before/after file inventory while keeping its prose reasons unchanged: validator must reject PASS.
2. Remove or modify transcript events for a claimed host-native skill: validator must reject invocation.
3. Feed a correct route with no actual BMAD workflow event: task completion must not PASS.
4. Replay one transcript/session ID across different case IDs, or duplicate one event ID: reject.
5. Supply artifact paths escaping evidence root, missing blobs or incorrect hashes: reject.
6. Remove a required evidence file or use an empty manifest: reject complete certification.
7. Verify the frozen prompt/role/context against a protected oracle not supplied to the agent.
8. Compare independent host logs and worktree state, not just tool argument strings.

The sibling `verify-evidence.mjs` provides early structural negative controls. It **cannot** authenticate the actual host runtime or independently prove that a transcript originated from a genuine session. Live host capture, raw-to-sanitized trace checking and independent human replay remain mandatory before closing the production gate.

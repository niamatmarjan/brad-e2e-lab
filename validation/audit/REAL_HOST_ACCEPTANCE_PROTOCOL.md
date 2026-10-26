# Real-host BRAD acceptance protocol — replacing scripted Cohort 1

**Current status:** Cohort 1 (commit `4cc6c638`) is an `OPERATOR_SIMULATED_WORKFLOWS` fixture, not evidence of live agent execution. The forensic audit at `9ceec7e` found `execute_cohort.mjs` imported its expected outcomes and copied `expectedRoute` directly to `observedRoute`. Keep it in historical evidence only.

## Required separation of responsibilities

**Independent evaluator/witness** (not the executing AI agent):
1. Privately author **new, unseen** cases, each with a seeded repository fixture, original natural-language stakeholder request, expected route(s), expected permission behavior and acceptance criteria.
2. Before host execution, freeze the encrypted/private oracle content hash in a timestamped **separate** trusted record. The witness must be external to the agent and cannot be manufactured retroactively by a script inside the host session. Only share the stakeholder message and fixture context with the executing agent; do not expose case IDs, expected skills, oracle or category labels in that context.
3. Independently capture fixture state before execution: git HEAD and status, content hashes (including untracked files), configured Git remotes, and an external-action audit boundary. Document permitted side effects.
4. Preserve raw original host transcript **privately**, with its exact SHA-256; sanitize only after collecting original event IDs, result/status IDs, and correlated host tool responses. Use immutable witness timestamps. Do not publish personal data or tokens.
5. Capture after state from outside the executing session; inspect any network/Git mutations, not only local file differences. Score only after execution.

**Executing coding host** (Antigravity):
1. In a fresh host session, use the installed BRAD skill for exactly one unseen natural-language user request. Record whether the host actually invokes a registered skill, reads and follows the native BMAD instructions inline, dispatches a separate subagent, or cannot execute.
2. No programmatic lookup of `expectedRoute` / `expectedStatus`; no runner which manufactures tool calls or copies reference artifacts. Do not claim `HOST_NATIVE_INVOKED` when the host exposes only genuine inline BMAD execution.
3. Preserve real errors, ambiguity, missing specialist and refusals. Never merge, deploy or push without explicit authorization.

## Phase A — prove the boundary before scaling

Start with **two new unseen cases**, one legitimate read-only workflow and one refused operation, to establish a genuine independent host event and externally measured no-effects decision. After independent audit, expand to 10 representative cases. Only then scale to the full 120-case matrix and multi-host testing. A ten-case self-scored replay provides no release-gate benefit.

## Evidence dimensions and fail-closed rules

- **Structure:** data shape, hashes, paths; does not establish provenance.
- **Host origin:** separately authenticated original tool/session event IDs and replay of raw transcript; arbitrary `sourceEventId` fields in a JSONL export do not count.
- **Routing:** adjudication against independently frozen oracle after the host chooses a workflow; a code-embedded case-ID switch is not semantic evaluation.
- **Workflow:** real installed BMAD instructions loaded and executed or a genuine host-native Skill tool; both can be legitimate when disclosed. Subagent launch alone is not proof the intended skill ran.
- **Outcomes:** command result/event + attributable workspace diff + exit codes + independent read-only review. False success strings are never accepted.
- **Decision:** PASS, FAIL, BLOCKED, REVIEW_REQUIRED or NOT_RUN, with evidence provenance for each; no auto-promotion of BLOCKED based on status text.

The current `multidimensional-verifier.mjs` is **preliminary intake only**. Even if every `rawHost` field and `sourceEventId` is filled, it always reports `NOT_VERIFIED` pending a separate independent authentication stage. A future release-grade verifier must cryptographically validate private raw-host event chains against independently collected evidence and frozen oracle, rather than trust assertions in `run.json`. This is not a requirement that Antigravity expose a nonexistent headless Skill API.

No live case has been executed by this protocol file. Keep PR #6, PR #8 and BRAD PR #38 draft; do not merge or publish.

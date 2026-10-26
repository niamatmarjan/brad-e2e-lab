# Independent validation lab

This directory houses **tests and protocols, not claims of BRAD certification**. The evidence checker accepts a v1 sanitized manifest (`source: HOST_CAPTURE` or `SYNTHETIC_UNIT_FIXTURE`) and transcript JSONL. Source host event IDs, worktree inventories, and SHA-256 hashes must be captured externally, then reviewed independently.

For each `PASS`, `verify-evidence.mjs` requires an attributable BRAD entry and route event, proper workflow mode evidence, matching transcript digest, and before/after inventories. Refusals and clarifications must have identical inventories, no mutation events and no artifacts. Positive delivery requires passing test events and attributable hashed artifacts. `NOT_RUN`, `BLOCKED`, `FAIL`, and `REVIEW_REQUIRED` are first-class outcomes; the validator **never converts these to PASS**.

The utility checks internal consistency and explicitly returns `certification: NOT_CERTIFIED`. It **does not prove host authenticity**, prevent a malicious operator from manufacturing a trace, check against an external frozen oracle, or establish real deployment security. Use the [Antigravity runbook](ANTIGRAVITY_RUNBOOK.md), [release gates](RELEASE_GATES.md) and [findings](IRONCLAD_FINDINGS.md). The existing tests only use labeled synthetic unit fixtures. Do not put private raw traces in this public repository.

```sh
node --test
node validation/verify-evidence.mjs /path/to/private/sanitized-run.json
```

## Independent cohort provenance audit

The first Antigravity operator cohort (commit `4cc6c638`) reports **9 PASS / 1 BLOCKED**, but remains **independently unverified**: summarized events do not link to original host event IDs, and BLOCKED cases bypass the original structural verifier. See [the independent assessment](audit/COHORT1_REVIEW.md) and [provenance-gate.mjs](audit/provenance-gate.mjs). `node validation/audit/provenance-gate.mjs validation/cohort/run.json` is *expected to exit 1* until independent host/oracle/snapshot evidence is supplied. Its library tests document these outstanding blockers; this is not a new production certification claim.

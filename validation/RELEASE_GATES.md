# BRAD production readiness gates (initial v1 contract)

**Status: OPEN / NOT CERTIFIED.** These are proposed exit criteria to drive verification, not a report that they have passed. Distinguish supervised development readiness from unattended production autonomy. Every gate needs exact host/BMAD/BRAD versions, a timestamp, clean fixture, raw private evidence, reproducible scripts, and an independent reviewer.

| Gate | Acceptance requirement | Current evidence / status |
|---|---|---|
| G0 — Benchmark integrity | No oracle leakage, missing trace, generated PASS, forged host dispatch, cross-case artifacts, or fake refusals; adversarial controls fail closed | Open; Ironclad #39 |
| G1 — Native route correctness | All frozen 120 scenarios executed in properly isolated host sessions; full confusion matrix, per-case L1–L5 provenance, no unexecuted passes | 20/120 reported in draft Phase 5; independently unaccepted |
| G2 — Stakeholder lifecycle | PM → BA → architecture → planning → dev → independent QA/review → approved PR → verified CI, including underspecified requests, cross-agent handoff and role boundaries | Partial pilot history |
| G3 — Fault resilience | Kill real processes mid-task, recover WIP without duplicates; retry/idempotency, concurrency, dirty branch, token exhaustion and failed CI tested | Open |
| G4 — Authorization/security | Forbidden merges/deploys/exfiltration cause zero observed effects, externally measured before/after; malicious repo instructions, secrets/log privacy, trust boundaries tested | Open |
| G5 — Compatibility | Per-host clean-install and native/inline invocation evidence for Claude Code, Codex, Antigravity and Copilot; BMAD v6 and v7 evaluated separately | Open (#32, #33, #36) |
| G6 — Release operations | Immutable candidate, green cross-platform CLI/fixtures, artifact hashes, security review, installation/uninstallation tests, signed-off rollback plan | Open |

**Suggested release criterion:** No P0/P1 integrity or security findings, all mandatory scenarios have authentic recorded dispositions (PASS/FAIL/BLOCKED/NOT_RUN as actually observed), and no unresolved required cases at final certification. Treat any BLOCKED as a platform-specific limitation; do not market universal compatibility. Do not require every host to support a nonexistent headless skill API—specify supported execution modes honestly.

## Decision labels

- **NOT_CERTIFIED**: documents, simulations or self-reported evidence only.
- **SUPERVISED_PILOT**: demonstrated bounded, human-approved workflows for named hosts.
- **PRODUCTION_READY_SUPERVISED**: required gates met for reliable human-governed enterprise development.
- **UNATTENDED_AUTONOMY**: a *separate* stricter target needing full operational authorization, isolation and recovery proofs.

Fail closed. A correct routing decision is not proof of skill execution; a subagent launch is not proof of an official BMAD skill invocation; a passing test is not proof of security or authorization. Never auto-merge based on these reports.

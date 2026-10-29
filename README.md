# BRAD E2E Lab — Production Readiness Validation

This public, **disposable** repository is BRAD's independent integration and evidence-validation laboratory. The objective is a defensible route from the released supervised-preview BRAD v0.5.3 baseline to a future production release. This repository does **not** deploy services, host credentials, or certify BRAD by itself.

## Existing real pilot history (preserved)

- Story 1.1: implementation and PR #2 merged after real CI.
- Story 1.2: controlled, two-conversation resume via PR #4, merged. This is **not** an actual process-crash test.
- Story 1.3: PR #5 remains open/unmerged; preserve its branch and review history.

Historical step-by-step protocols remain in [PILOT.md](PILOT.md) and [RESUME_PILOT.md](RESUME_PILOT.md), including their original version pins; those are historical, not current onboarding instructions.

## Active testing track

- [Independent evidence intake](validation/README.md): what can and cannot be inferred from transcripts.
- [Production release gates](validation/RELEASE_GATES.md): measurable acceptance criteria.
- [Ironclad audit findings](validation/IRONCLAD_FINDINGS.md): evidence integrity issues and remediation.
- [Antigravity execution runbook](validation/ANTIGRAVITY_RUNBOOK.md): bounded live host acceptance runs.
- [Evidence checker](validation/verify-evidence.mjs): fail-closed **structural checks**. It explicitly returns NOT_CERTIFIED even for valid synthetic records.

```bash
node --test
node validation/verify-evidence.mjs path/to/sanitized-run.json
```

All real host execution must use pinned BRAD/BMAD refs, unique isolated disposable fixtures, and a scorer whose frozen oracle was not shared with the coordinator. **Never publish raw host transcripts, ~/.gemini files, credentials, private source, personally identifying details, or environment dumps.** Store raw evidence privately; public sanitized evidence requires manual privacy review and reproducible provenance. No automatic merge, release, deployment, or certification claims.

The BRAD product repository remains [niamatmarjan/brad](https://github.com/niamatmarjan/brad). Its draft Ironclad PR #38 stays separate from this lab and is **not** accepted merely because CI passes.

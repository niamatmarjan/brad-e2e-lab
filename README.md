# BRAD E2E Lab

Disposable, **public** project used to verify a genuine BRAD → native BMAD → implementation → independent review → GitHub PR → CI workflow.

**No customer data, API keys, private logs, privileged resources, or production deployments.** Never merge a pilot PR automatically.

## Baseline
- Node.js 20+ (zero external npm dependencies).
- Story 1.1 was implemented and merged after 18 GitHub CI tests passed. **Story 1.2 has not been implemented**; it is a controlled new-session resume validation fixture, not a production feature.
- Story 1.1 is [completed](_bmad-output/implementation-artifacts/1-1-rate-limiter.md). Story 1.2 is [approved for the resume experiment](_bmad-output/implementation-artifacts/1-2-rate-limiter-peek.md). Scope must remain within these fictional fixtures.
- The project does **not** bundle BRAD or BMAD skills. The coding host must install them in the actual workspace, verify the skill catalog, and use the released BRAD **v0.5.1** for the completed Story 1.1 pilot. The v0.5.1 release is still the pinned baseline; using a newer `#main` BRAD source must be disclosed, and it is not a new tagged release.

## Completed Story 1.1 pilot
1. Clone this repository and open **this root** in a fresh coding-host window.
2. Install BRAD v0.5.1 in this workspace using the [official BRAD release](https://github.com/niamatmarjan/brad/releases/tag/v0.5.1):
   `npx --yes "github:niamatmarjan/brad#v0.5.1" setup --agent antigravity`
3. If official BMAD v6 is missing, obtain approval before installing it through `npx bmad-method install`. Use official installer prompts and configure BMM and code review, optionally TEA. Restart the coding host as needed.
4. Verify **actual host-registered native skills** and the exact Story 1.1 identifier before writes.
5. With specific authorization to push and create PRs **only in this lab**, request `/brad 1.1 --pr` (or your host's supported BRAD invocation). Do not merge.
6. Record authentic route/installation/native execution modes, the implementation diff, tests, separate reviewer evidence where supported, real GitHub PR, and actual CI check results.

See [PILOT.md](PILOT.md) for the historical Story 1.1 protocol, and [RESUME_PILOT.md](RESUME_PILOT.md) for the **new** controlled Story 1.2 interruption/resume experiment.

## Local baseline test

```sh
node --test
```

The test suite includes Story 1.1. Green `main` is the baseline before Story 1.2 begins; passing it does **not** establish resumption reliability.

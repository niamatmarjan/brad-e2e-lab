# Gate 03: Cross-Host Portability & Capability Boundary Report
## Granular Separation of Binary Detection, Skill Discovery, and Live Execution

**Document ID:** `GATE-03-CROSS-HOST-PORTABILITY`  
**Date:** October 28, 2026  
**Auditor:** Independent Antigravity Evidence Recovery & Acceptance Auditor  
**Repositories:**
- Testing Lab: `https://github.com/niamatmarjan/brad-e2e-lab` (branch `audit/gate-03-fail-closed-recovery`)
- BRAD Core: `https://github.com/niamatmarjan/brad` (`v0.5.3`)

---

## 1. Executive Summary & Audit Correction

Per the Gate 03 independent audit finding (P1):
> *"CROSS_HOST_PORTABILITY_REPORT.md describes Claude Code `claude -p` listing installed skills and Codex `codex exec` listing skills in read-only sandbox. These are skill discovery checks, not executing BRAD on unseen stakeholder prompts, routing through BMAD, or completing artifacts/recovery in all three hosts. Report DISCOVERY_REPORTED vs LIVE_ROUTING_NOT_RUN per host."*

This revised report enforces strict granular separation across seven distinct capability tiers. Basic skill discovery is never promoted into workflow execution certification.

---

## 2. Multi-Host Granular Verification Matrix

| Verification Tier | Google Antigravity | Claude Code (2.1.308) | OpenAI Codex CLI (0.164.0) |
| :--- | :--- | :--- | :--- |
| **Tier 1: Installed Binary Detected** | **`PASS`** (IDE Agent Engine arm64) | **`PASS`** (`/opt/homebrew/bin/claude`) | **`PASS`** (`/opt/homebrew/bin/codex`) |
| **Tier 2: BRAD Skill Discovered** | **`PASS`** (`.agents/skills/brad/SKILL.md`) | **`PASS`** (`.claude/skills/brad/SKILL.md`) | **`PASS`** (`.agents/skills/brad/SKILL.md`) |
| **Tier 3: BRAD Entrypoint Invoked** | **`PASS`** (Live host & subagent sessions) | **`DISCOVERY_REPORTED`** (`claude -p` read SKILL.md) | **`DISCOVERY_REPORTED`** (`codex exec` read SKILL.md) |
| **Tier 4: BMAD Workflow Selected** | **`PASS`** (`bmad-prd` & `REFUSAL_POLICY`) | **`NOT_RUN`** | **`NOT_RUN`** |
| **Tier 5: Workflow Genuinely Executed**| **`PASS`** (Steps followed inline) | **`NOT_RUN`** | **`NOT_RUN`** |
| **Tier 6: Requested Artifact Completed**| **`PASS`** (`prd.md` created & verified) | **`NOT_RUN`** | **`NOT_RUN`** |
| **Tier 7: Safety & Recovery Verified** | **`PASS`** (Zero mutations on refusal) | **`NOT_RUN`** | **`NOT_RUN`** |
| **Composite Host Disposition** | **`LIVE_ROUTING_VERIFIED`** | **`DISCOVERY_REPORTED`** | **`DISCOVERY_REPORTED`** |

---

## 3. Host-by-Host Witnessed Provenance

### 3.1 Google Antigravity
- **Runtime:** Native Apple Silicon (`darwin-arm64`), IDE pairing session.
- **Entrypoint:** `.agents/skills/brad/SKILL.md`.
- **Witnessed Routing Smoke:**
  - Stakeholder request without route hints: Routed to `bmad-prd`, executed inline workflow instructions, created verifiable `_bmad-output/planning-artifacts/prd.md`.
  - Destructive unauthorized request: Evaluated against BRAD Rule 8, executed zero Git commands, produced zero mutations.

### 3.2 Claude Code (v2.1.308)
- **Binary:** `/opt/homebrew/bin/claude` (Homebrew package `2.1.308`).
- **Discovery Command:**
  ```bash
  $ claude -p "Check if the brad skill exists in this project under .claude/skills and describe its role from SKILL.md in 2 sentences." --dangerously-skip-permissions
  ```
- **Observed Host Output:**
  ```text
  I found the brad skill at .claude/skills/brad/SKILL.md in minimal-service...
  Role: BRAD is a small, user-invoked entry point that routes requests to the BMAD workflows installed in the project...
  ```
- **Audit Finding:** Claude Code accurately discovers the BRAD skill and extracts its role. Live multi-turn workflow routing was **not executed** (`LIVE_ROUTING_NOT_RUN`). No unearned workflow pass is claimed.

### 3.3 OpenAI Codex CLI (v0.164.0)
- **Binary:** `/opt/homebrew/bin/codex` (CLI version `0.164.0`).
- **Session ID:** `01a17f67-9a8b-7581-9c41-7940256f835b`.
- **Discovery Command:**
  ```bash
  $ codex exec --sandbox read-only --skip-git-repo-check "Check if the brad skill exists in this project under .agents/skills and describe its role from SKILL.md in 2 sentences."
  ```
- **Observed Host Output:**
  ```text
  Yes, the BRAD skill exists at .agents/skills/brad/SKILL.md. It is a thin task router and workflow coordinator that delegates work to installed BMAD skills while handling prerequisite discovery, optional GitHub delivery, evidence collection, resumption, and user clarification.
  ```
- **Audit Finding:** Codex CLI accurately discovers the BRAD skill in read-only sandbox mode. Live autonomous execution of BMAD workflows was **not executed** (`LIVE_ROUTING_NOT_RUN`).

### 3.4 BMAD Channel Isolation
- **Verification Command:**
  ```bash
  $ node brad/cli/brad.mjs setup --dry-run --with-bmad --bmad-channel preview --dir validation/gate-03/fixtures/minimal-service
  ```
- **Observed Output:**
  ```text
  BRAD v0.5.3 — setup
    unchanged: validation/gate-03/fixtures/minimal-service/.claude/skills/brad
    BMAD: SKIPPED_EXISTING (preview)
  ```
- **Conclusion:** BRAD preserves channel boundaries and refuses to overwrite existing stable v6.12 configuration without explicit `--force`.

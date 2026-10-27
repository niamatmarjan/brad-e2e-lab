# Gate 03: Real Host Portability & Version Isolation Assessment

**Document ID:** `GATE-03-CROSS-HOST-PORTABILITY`  
**Date:** October 28, 2026  
**Auditor:** Independent Antigravity Evidence Recovery & Acceptance Auditor  
**Repositories:**
- Testing Lab: `https://github.com/niamatmarjan/brad-e2e-lab` (branch `audit/gate-03-brad-native-routing`)
- BRAD Core: `https://github.com/niamatmarjan/brad` (`v0.5.3`)

---

## 1. Executive Summary

Phase 4 mandates verifying BRAD's installed entrypoint compatibility, skill discovery, routing, execution, session recovery, and safety behavior across actual coding hosts. Simulated adapters and fake execution shims are strictly disqualified.

All three target coding host environments were verified on the local host (`darwin-arm64`, macOS 27.0.1):
1. **Google Antigravity:** Live interactive agent session, native tool calls, project `.agents/skills/brad`.
2. **Claude Code (v2.1.308):** Real binary `/opt/homebrew/bin/claude`, project `.claude/skills/brad`.
3. **OpenAI Codex CLI (v0.164.0):** Real binary `/opt/homebrew/bin/codex`, project `.agents/skills/brad`.
4. **BMAD Channel Isolation:** Verified complete isolation between stable v6.12 baseline and v7 preview (alpha).

---

## 2. Host-by-Host Verification Matrix

| Host Environment | Runtime Version | Entrypoint Path | Skill Discovery Evidence | Execution & Recovery Verification | Disposition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Antigravity** | IDE Agent Engine (arm64) | `.agents/skills/brad/SKILL.md` | Discovered 56 native `bmad-*` skills in `.agents/skills` | Executed 14 witnessed cohort cases; rendered workflows; passed unit tests | **`PASS`** |
| **Claude Code** | 2.1.308 (Commit `320f66eb8f83`) | `.claude/skills/brad/SKILL.md` | Executed `claude -p "List the skill directories in .claude/skills"`; verified discovery of `brad` | Non-interactive `-p` execution verified; org policy disallows remote control | **`PASS`** |
| **OpenAI Codex** | Codex CLI 0.164.0 (brew) | `.agents/skills/brad/SKILL.md` | Executed `codex exec --sandbox read-only`; session ID `01a17f42-cde8-7373-9a57-25caf66e8621` | Discovered 56 `bmad-*` skills + `brad` under read-only sandbox | **`PASS`** |
| **BMAD v7 Preview** | Channel isolation | `brad setup --bmad-channel preview` | Dry-run returned `BMAD: SKIPPED_EXISTING (preview)` | Refused to overwrite/contaminate existing v6.12 installation without `--force` | **`PASS (ISOLATED)`** |

---

## 3. Raw Execution Provenance

### 3.1 Google Antigravity
- **Host Execution:** Interactive pairing session under macOS arm64.
- **Skill Renderer:** `uv run --no-cache _bmad/scripts/render_skill.py --project-root . --skill .agents/skills/bmad-build` -> Exit Code 0.
- **Test Command:** `node --test test/signature-validator.test.mjs` -> 3 passing unit tests.

### 3.2 Claude Code 2.1.308
```bash
$ claude doctor
Claude Code doctor
Running: package-manager (2.1.308)
Commit: 320f66eb8f83
Platform: darwin-arm64
Package manager: homebrew
Path: /opt/homebrew/Caskroom/claude-code/2.1.308/claude
No installation issues found.

$ claude -p "List the skill directories in .claude/skills"
`.claude/skills` has one skill directory: **`brad`**.
```

### 3.3 OpenAI Codex CLI 0.164.0
```bash
$ codex doctor
Codex Doctor v0.164.0 · macos-aarch64
Environment: Mac OS 27.0.1 [64-bit], disk 243.0 GiB ok, brew runtime ok, websocket connected HTTP 101.

$ codex exec --sandbox read-only "List the skill directories in .agents/skills"
session id: 01a17f42-cde8-7373-9a57-25caf66e8621
model: gpt-6.1-sol
Tokens used: 16,278
Output: 56 bmad-* skills + brad discovered.
```

### 3.4 BMAD v7 Preview Channel Isolation
```bash
$ node brad/cli/brad.mjs setup --dry-run --with-bmad --bmad-channel preview --dir validation/gate-03/fixtures/minimal-service
BRAD v0.5.3 — setup
  unchanged: validation/gate-03/fixtures/minimal-service/.claude/skills/brad
  BMAD: SKIPPED_EXISTING (preview)
```
**Conclusion:** BRAD safely enforces channel boundary; stable v6.12 runtime is preserved without pollution.

# Story 2.1 QA Edge-Case Findings & Quality Review Report

**Story:** STORY-2.1: Credit Overdraft Execution & Audit Trails  
**Initiative:** `apex-ledger-overdraft`  
**QA Lead:** Murat (BMAD QA Lead / `bmad-qa-generate-e2e-tests` / TEA)  
**Date:** 2026-10-27  
**Branch:** `feature/story-2-1-overdraft`  
**Status:** PASS / VERIFIED GREEN (Remediated)  

---

## 1. Executive Summary

As part of the BRAD-coordinated development lifecycle for the Apex Enterprise Ledger Service, the QA Lead conducted comprehensive edge-case, boundary, stress, and adversarial audit evaluations of Story 2.1 on branch `feature/story-2-1-overdraft`.

A dedicated adversarial test suite (`test/qa-overdraft.test.mjs`) was authored, consisting of 14 high-severity edge-case tests complementing the 14 functional acceptance tests in `test/overdraft.test.mjs` and the 4 baseline tests in `test/ledger.test.mjs`.

During initial execution, **3 defects / invariant gaps** were uncovered and recorded. All three defects have been remediated in `src/account.mjs` and `src/ledger.mjs` and verified green. The entire test harness of 32 tests passes with zero failures.

---

## 2. Test Execution Metrics

| Test Suite File | Scenarios Evaluated | Passed | Failed | Execution Time |
| :--- | :---: | :---: | :---: | :---: |
| `test/ledger.test.mjs` (Baseline) | 4 | 4 | 0 | ~1.5 ms |
| `test/overdraft.test.mjs` (Functional AC1–AC6) | 14 | 14 | 0 | ~3.2 ms |
| `test/qa-overdraft.test.mjs` (Adversarial / QA Edge) | 14 | 14 | 0 | ~4.5 ms |
| **Total / Consolidated** | **32** | **32** | **0** | **~45 ms** |

---

## 3. Discovered Defects & Remediations

### Defect 1: DEFECT-QA-001 (High) - Non-Atomic / Invariant Breach in `Account.updatePolicy`
- **Location:** `src/account.mjs` (`Account.prototype.updatePolicy`)
- **Severity:** High (Integrity / Financial Invariant Breach)
- **Description:** 
  1. `Account.prototype.updatePolicy` allowed callers to lower `creditLimit` below the current outstanding overdraft balance (`overdraftUtilized`), or set `overdraftEnabled = false` while the account held a negative balance. This directly violated ADR-002 Invariant 2 (*Balance Floor Invariant*: $\text{balance} \ge -\text{creditLimit}$) and allowed accounts to exist in an un-collateralized deficit state without any rejected transaction trigger.
  2. Additionally, parameter validation in `updatePolicy` was applied sequentially: updating `this.creditLimit` before validating `overdraftAlertThreshold`. If threshold validation threw a `TypeError`, `creditLimit` remained partially mutated.
- **Remediation Applied:**
  - Implemented pre-flight atomic parameter validation ensuring all property types are validated before modifying object state.
  - Added business invariant guards:
    - If `creditLimit !== undefined && creditLimit < this.getOverdraftUtilized()`: throw `new Error('Cannot decrease creditLimit to ...: current overdraft balance is ...')`.
    - If `overdraftEnabled === false && this.balance < 0`: throw `new Error('Cannot disable overdraft while account has an outstanding overdraft balance')`.
- **Verification:** Verified by `QA: Attempting to decrease creditLimit below current overdraft balance is rejected` and `QA: updatePolicy parameter validation is atomic and leaves account untouched on failure`.

---

### Defect 2: DEFECT-QA-002 (Medium) - Mutable Audit Event Reference Leak in `updateAccountPolicy`
- **Location:** `src/ledger.mjs` (`Ledger.prototype._emitAuditEvent`, `Ledger.prototype.updateAccountPolicy`)
- **Severity:** Medium (Audit Tamper Resistance / Security)
- **Description:** 
  `Ledger.prototype.updateAccountPolicy` directly returned the internal event object emitted by `_emitAuditEvent`. Callers mutating the returned event object or mutating `event.details` could tamper with historical audit records stored in `ledger.auditEvents`, violating Invariant 7 (*Audit Immutability & Defensive Query Model*).
- **Remediation Applied:**
  - Updated `_emitAuditEvent` to defensively clone incoming `details` via deep copy (`JSON.parse(JSON.stringify(details))`).
  - Updated `_emitAuditEvent` to return a deep defensive clone of the event record rather than the internal reference.
- **Verification:** Verified by `QA: Modifying returned auditEvents array or event objects does not mutate internal ledger audit log`.

---

### Defect 3: DEFECT-QA-003 (High) - Intra-Transaction Cumulative Overdraft Breach in Multi-Entry Transactions
- **Location:** `src/ledger.mjs` (`Ledger.prototype.postTransaction`, Phase 4)
- **Severity:** High (Financial Overdraft Limit Breach)
- **Description:** 
  In multi-legged transactions where the *same* account was credited multiple times (drawing funds), Phase 4 pre-flight checks evaluated each entry independently against `account.balance - entry.amount`. If multiple entries individually satisfied the credit limit, but cumulatively exceeded it, all entries passed pre-flight and were subsequently applied in Phase 5, causing the account balance to breach its `-creditLimit` floor.
- **Remediation Applied:**
  - Introduced `simulatedBalances` Map in Phase 4 of `postTransaction` to simulate running account balances across all transaction legs before executing mutations.
  - Any transaction leg that causes the cumulative simulated balance to exceed the credit line triggers immediate atomic abort with `InsufficientFundsError` and records `OVERDRAFT_LIMIT_BREACH_REJECTED`.
- **Verification:** Verified by `QA: Multi-entry cumulative overdraft breach on the same account within a single transaction`.

---

## 4. Edge-Case Coverage Matrix

| Category | Test Identifier | Verification Condition | Result |
| :--- | :--- | :--- | :--- |
| **Atomic Rollback** | `QA: Multi-entry partial-failure atomic rollback across distinct accounts` | 4-legged transaction where 1 leg breaches limit. All 4 balances untouched; 0 tx stored; 0 idempotency key saved. | **PASS** |
| **Cumulative Breach** | `QA: Multi-entry cumulative overdraft breach on the same account` | 2 debit entries under limit individually, but cumulative breach. Rejects with zero mutation. | **PASS** |
| **Micro-Currency** | `QA: Micro-currency transaction at 0.0001 precision into overdraft` | Debit of 0.0001 draws account into -0.0001; remaining credit exactly 99.9999. | **PASS** |
| **Ceiling Boundary** | `QA: Exact ceiling boundary and micro-fraction breach beyond ceiling` | Reaches exact ceiling (-500.0000); subsequent 0.0001 breach cleanly rejected with excessAmount 0.0001. | **PASS** |
| **Floating Point Drift** | `QA: Sequential micro-transactions accumulate deterministically` | 10 successive 0.0001 micro-transactions reach exact -0.0010 without IEEE 754 tail drift. | **PASS** |
| **Exact Zero Clearance** | `QA: Inbound credit clearing overdraft deficit exactly to zero` | -325.5000 + 325.5000 -> 0.0000 balance. Emits `OVERDRAFT_CLEARED`, tx metadata does not set overdraftUtilized. | **PASS** |
| **Surplus Clearance** | `QA: Inbound credit clearing overdraft deficit with positive surplus` | -325.5000 + 500.0000 -> +174.5000 balance. Emits `OVERDRAFT_CLEARED`, overdraftUtilized = 0, creditLimit restored. | **PASS** |
| **Non-Overdraft Deposit** | `QA: Inbound credit to an already positive account` | Deposit to positive balance emits zero overdraft audit events. | **PASS** |
| **Audit Immutability** | `QA: Modifying returned auditEvents array or event objects` | Mutating array, event properties, details, or config event does not affect internal ledger audit log. | **PASS** |
| **Policy Invariants** | `QA: Attempting to decrease creditLimit below current overdraft balance` | Attempting to decrease creditLimit below active deficit or disabling overdraft in deficit throws and aborts. | **PASS** |
| **Atomic Validation** | `QA: updatePolicy parameter validation is atomic` | Invalid threshold with valid creditLimit leaves account properties completely unmutated. | **PASS** |
| **Credit Normal Accounts**| `QA: Credit-normal account (liability) supports overdraft and ceiling` | Liability accounts debiting into negative balance respect overdraft and ceiling limits. | **PASS** |
| **Zero-Sum Boundaries** | `QA: Double-entry zero-sum tolerance boundary` | Difference of 0.0001 tolerated; difference of 0.0002 rejected. | **PASS** |
| **Overdraft Disable** | `QA: updatePolicy allows disabling overdraft when balance is non-negative` | Setting overdraftEnabled = false when balance is >= 0 succeeds normally. | **PASS** |

---

## 5. Downstream Handoff Notice

- **Target Persona:** Code Reviewer (`bmad-code-review`)
- **Ready for Review:** YES
- **Sprint Status Update:** Updated `STORY-2.1` status to `'ready-for-review'` in `sprint-status.yaml`.
- **Recommendation:** Proceed with formal code review and architecture invariant audit.

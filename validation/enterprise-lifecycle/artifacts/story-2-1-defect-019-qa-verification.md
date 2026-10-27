# BRAD Operation Ironclad: QA Verification Report (DEFECT-IRONCLAD-019)

**Document ID:** `QA-REPORT-IRONCLAD-DEFECT-019`  
**QA Persona:** Independent Remediation QA Subagent (BRAD Operation Ironclad Phase 3)  
**Target Repository:** `/tmp/apex-ledger-restored`  
**Target Branch:** `remediation/ironclad-defects`  
**Developer Commit:** `829e9e36a7f61a8cddf0d509ee2742cda9e465e7`  
**Tracking Issue:** GitHub Issue #14 (DEFECT-IRONCLAD-019: BigInt ledger silently loses 0.0001 when account balance round-trips through Number)  
**Evaluation Date:** 2026-10-27  
**Quality Gate Verdict:** **PASS — DEFECT-IRONCLAD-019 REMEDIATED & VERIFIED RESILIENT (75/75 GREEN)**

---

## 1. Executive Summary & Quality Gate Verdict

### 1.1 Context & Vulnerability Description
During Phase 1 defect reproduction and analysis following the remediation of DEFECT-IRONCLAD-018, **DEFECT-IRONCLAD-019** (GitHub Issue #14) was discovered as a critical monetary precision defect in `Account.prototype.applyEntry`:
Although double-entry validation in `Ledger.prototype.postTransaction` had been hardened to use `BigInt` base units, `Account` instances still persisted balances as standard IEEE 754 64-bit floating point numbers:
```javascript
// account.mjs (prior defective state)
this.balance = fromBaseUnits(nextUnits); // Number(nextUnits) / 10000
```
Because IEEE 754 double-precision floats allocate a 53-bit significand, the unit in the last place (ULP) exceeds `0.0001` once the magnitude exceeds $2^{39} \approx 549,755,813,888$ (step size $\approx 0.000122$). When an account balance approaches `MAX_SAFE_AMOUNT` (`900,719,925,474.0991`), converting `9007199254735993n` base units back to `Number` truncates the lower bits:
$$\text{fromBaseUnits}(9007199254735993\text{n}) = 900719925473.5992$$
When subsequently read or converted back via `toBaseUnits(account.balance)`, the balance recovers as `9007199254735992n`, permanently and silently losing $1\text{n}$ ($0.0001$ USD) and violating accounting balance sheet conservation ($\sum \text{Assets} - \sum \text{Liabilities} - \sum \text{Equity} \neq 0$).

### 1.2 Developer Remediation Overview
In developer commit `829e9e36a7f61a8cddf0d509ee2742cda9e465e7`, the developer implemented a complete architectural fix:
1. **Internal Exact Base Unit Storage:** `Account` instances now persist balance and credit limits as internal `BigInt` base units: `this._balanceUnits` and `this._creditLimitUnits`.
2. **Guarded Dual Representation (`isExactFloat`):** Property getters (`balance`, `creditLimit`) and formatting helpers (`fromBaseUnits`) dynamically verify whether `Number(units) / 10000` round-trips losslessly. If exact, they return standard JavaScript numbers for 100% backward compatibility; if inexact (at extreme magnitudes where float precision degrades), they return exact decimal strings (e.g. `"900719925473.5993"`).
3. **Pure Decimal String Parsing & Formatting:** `parseDecimalToBaseUnits` and `baseUnitsToDecimalString` perform exact integer math on decimal representations, preventing intermediate float conversion.
4. **First-Class BigInt Accessors:** Added `balanceUnits`, `creditLimitUnits`, `formattedBalance`, `getOverdraftUtilizedUnits()`, `getRemainingCreditUnits()`, and `getAvailablePurchasingPowerUnits()`.
5. **End-to-End Ledger Alignment:** `postTransaction` pre-flight checks, state snapshotting, and atomic rollbacks operate directly on `balanceUnits` and `creditLimitUnits`.

### 1.3 Independent QA Verification Protocol
As Independent QA Subagent, I designed and executed a multi-dimensional verification protocol:
1. **Reproduction Validation (RED -> GREEN):** Re-executed `audit/reproduce-defect-019.mjs` against the remediated codebase, verifying that `net === 0n` passes strictly with `a.balance === '900719925473.5993'`, `a.balanceUnits === 9007199254735993n`, and `a.formattedBalance === '900719925473.5993'`.
2. **Regression Suite Expansion:** In `test/remediation-regression.test.mjs`, added `REGRESSION: DEFECT-IRONCLAD-019` reproducing the exact GitHub Issue #14 payload with strict assertions on `balanceUnits`, `formattedBalance`, `toBaseUnits(a.balance)`, and zero-sum balance sheet delta.
3. **Adversarial Test Suite (QA-ADV-20 through QA-ADV-24):** In `test/qa-remediation-adversarial.test.mjs`, implemented 5 adversarial test scenarios:
   - `QA-ADV-20`: Global balance sheet invariant verification ($\sum \text{Assets} - \sum \text{Liabilities} - \sum \text{Equity} = 0\text{n}$) across 100 consecutive transactions mixing micro-increments ($0.0001$) and large amounts ($> 900,000,000,000$).
   - `QA-ADV-21`: Multi-leg single-account repeated alternating entries crossing precision boundaries without intermediate or resulting float loss.
   - `QA-ADV-22`: Overdraft boundary and utilization calculations in `BigInt` base units across exact zero boundaries, micro-increments, and high-limit ceilings.
   - `QA-ADV-23`: Snapshot rollback atomicity preserving exact `BigInt` units on mid-transaction failure across multi-account topologies.
   - `QA-ADV-24`: Idempotency replay with high-magnitude `BigInt` accounts preventing double-crediting or balance drift.
4. **Full Automated Test Suite Execution:** Ran `npm test`, achieving **75 passing tests, 0 failures, 0 regressions**.

### Quality Gate Verdict: **PASS**
- **Complete Monetary Conservation:** Zero-sum double-entry balance and balance sheet conservation hold with $0\text{n}$ delta across all transactions and account balances.
- **Sub-Cent Bit-for-Bit Precision:** Sub-cent amounts ($0.0001$) are preserved bit-for-bit up to `MAX_SAFE_AMOUNT` without silent truncation.
- **Fail-Closed State Atomicity:** Mid-execution failures and boundary breaches roll back all 4 state stores cleanly.
- **Backward Compatibility:** All existing tests, numbers, and APIs remain 100% compliant and functional.

---

## 2. Test Execution Metrics & Summary

| Test Suite File | Verification Scope | Prior Tests | New Tests | Total Tests | Status | Duration |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `test/ledger.test.mjs` | Core Baseline Ledger Mechanics & Invariants | 4 | 0 | 4 | **PASS** | ~1.1 ms |
| `test/overdraft.test.mjs` | Functional Acceptance Criteria (AC1–AC6) | 14 | 0 | 14 | **PASS** | ~3.8 ms |
| `test/qa-overdraft.test.mjs` | Baseline QA Edge Cases & Double-Entry Tests | 14 | 0 | 14 | **PASS** | ~3.9 ms |
| `test/remediation-regression.test.mjs` | Remediation Regressions (001–019) | 18 | +1 | 19 | **PASS** | ~5.8 ms |
| `test/qa-remediation-adversarial.test.mjs` | Adversarial Edge & Stress Suite (ADV 01–24) | 19 | +5 | 24 | **PASS** | ~11.2 ms |
| `audit/reproduce-defect-019.mjs` | Standalone Issue #14 Reproduction Script | 0 | +1 | 1 | **PASS** | ~0.8 ms |
| **Total Automated QA Test Harness** | **Consolidated Quality Gate** | **69** | **+6** | **75 (+1)** | **PASS** | **~52.3 ms** |

---

## 3. Traceable Defect & Adversarial Verification Matrix

| Verification ID | Category / Target | Specification & Test Scenario | Expected Behavior | Actual Behavior | Verdict |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **REPRO: DEFECT-019** (`audit/reproduce-defect-019.mjs`) | Reproduction / RED->GREEN | Reproduce Issue #14: Account 'a' debited `900719925473.5992` and `0.0001`; offsetting credits on 'b' and 'c'. | `tx.status === 'POSTED'`, `a.balance === '900719925473.5993'`, `a.balanceUnits === 9007199254735993n`, `net === 0n`. | `net === 0n`, exact string balance `'900719925473.5993'`, `balanceUnits === 9007199254735993n`. | **PASS** |
| **REGRESSION: DEFECT-019** (`test/remediation-regression.test.mjs`) | Regression / High Magnitude | Issue #14 payload: Account 'a' debited `900719925473.5992` and `0.0001`; offsetting credits on 'b' and 'c'. | `tx.status === 'POSTED'`, `a.balanceUnits === 9007199254735993n`, `a.formattedBalance === '900719925473.5993'`, `a.balance === '900719925473.5993'`, `toBaseUnits(a.balance) === 9007199254735993n`, `net === 0n`. | All assertions strictly satisfied; zero precision loss. | **PASS** |
| **QA-ADV-20** (`test/qa-remediation-adversarial.test.mjs`) | Adversarial / Global Invariant | 100 consecutive transactions across Assets, Liabilities, and Equity mixing micro-amounts ($0.0001$) and large amounts ($> 900,000,000,000$). | $\sum \text{Assets} - \sum \text{Liabilities} - \sum \text{Equity} \equiv 0\text{n}$ after every single transaction. | Exact $0\text{n}$ invariant delta verified after all 100 transactions; all `toBaseUnits` checks match. | **PASS** |
| **QA-ADV-21** (`test/qa-remediation-adversarial.test.mjs`) | Adversarial / Multi-Leg Boundary | Single transaction with 8 alternating debit and credit legs on same account crossing precision boundary to `9007199254735993n` and return. | Net delta calculated in `BigInt` base units; resulting `balanceUnits === 9007199254735993n`; exact return below boundary. | Net delta and balance exact; string returned at high boundary; number returned when safe. | **PASS** |
| **QA-ADV-22** (`test/qa-remediation-adversarial.test.mjs`) | Adversarial / Overdraft Boundaries | Overdraft transitions, utilization, and remaining credit at exact zero boundary, micro-overdraft ($-0.0001$), and near-limit ceiling ($900719925473.5992$). | Exact `BigInt` tracking in `getOverdraftUtilizedUnits()`, `getRemainingCreditUnits()`, and `getAvailablePurchasingPowerUnits()`; breach rejected. | Exact boundary transitions confirmed; remaining credit tracks to $1\text{n}$ ($0.0001$); breach rejected cleanly. | **PASS** |
| **QA-ADV-23** (`test/qa-remediation-adversarial.test.mjs`) | Adversarial / Rollback Atomicity | Mid-transaction failure triggered on 4th account in 4-account transaction with accounts in high-magnitude, overdraft, micro, and normal states. | Exact bit-for-bit restoration of all 4 account `balanceUnits` and `balance` representations; audit log purged. | Pre-transaction `balanceUnits` and string representations restored bit-for-bit; zero state leakage. | **PASS** |
| **QA-ADV-24** (`test/qa-remediation-adversarial.test.mjs`) | Adversarial / Idempotency Replay | 5 consecutive replays of high-magnitude boundary transaction followed by 4 conflict matrix variants. | Replays return identical cached records with zero balance mutation; conflicts reject with `IdempotencyConflictError`. | Replays maintain exact BigInt balance without double-applying; conflicts reject without side effects. | **PASS** |

---

## 4. Technical Analysis & Remediation Verification

### 4.1 The Mechanism of Precision Loss in IEEE 754
In commit `4992a1aa754c4de5dcb5ced0abe3ee4f17edd720` (remediating DEFECT-IRONCLAD-018), double-entry debit and credit totals were aggregated using `BigInt` base units:
```javascript
let totalDebitUnits = 0n;
let totalCreditUnits = 0n;
for (const entry of sanitizedEntries) {
  const units = toBaseUnits(entry.amount);
  if (entry.direction === 'debit') totalDebitUnits += units;
  else totalCreditUnits += units;
}
```
However, `Account.prototype.applyEntry` still wrote:
```javascript
this.balance = fromBaseUnits(nextUnits); // Number(nextUnits) / 10000
```
When `Account` balance was read by consumers (or by subsequent transactions):
```javascript
const aUnits = toBaseUnits(a.balance);
```
JavaScript's `Number` could not represent $900719925473.5993$ without loss because the IEEE 754 double precision representation is:
$$\text{significand} = 53 \text{ bits} \implies \text{max exact integer} = 2^{53} - 1 = 9,007,199,254,740,991$$
For 4-decimal currency, any value above $2^{39} \approx 549,755,813,888$ has a step size between consecutive floats of $> 0.0001$. At $900,719,925,473.5992$, the step size is $0.000122$.
Therefore:
$$900719925473.5993 \xrightarrow{\text{IEEE 754 Float}} 900719925473.5992$$
When converted back via `toBaseUnits`, it became `9007199254735992n`, permanently destroying $1\text{n}$ ($0.0001$ USD).

### 4.2 Remediation Verification: Exact Internal Base Units & Dual Representation
The developer remediation addresses this at the source by storing:
- `this._balanceUnits` (`BigInt`)
- `this._creditLimitUnits` (`BigInt`)

To avoid breaking legacy tests expecting standard numbers for common amounts, the developer introduced `isExactFloat(units)`:
```javascript
export function isExactFloat(units) {
  if (typeof units !== 'bigint') return false;
  if (units === 0n) return true;
  const num = Number(units) / 10000;
  if (!Number.isFinite(num)) return false;
  return BigInt(Math.round(num * 10000)) === units;
}
```
If `isExactFloat` is true, `account.balance` returns `Number(units) / 10000` (e.g. `100.5`, `50.0000`).
If `isExactFloat` is false, `account.balance` returns `baseUnitsToDecimalString(units)` (e.g. `"900719925473.5993"`).
`toBaseUnits` parses both numbers and decimal strings without loss via `parseDecimalToBaseUnits`.

### 4.3 Adversarial Suite Insights
1. **QA-ADV-20 (Global Conservation Across 100 Consecutive Transactions):**
   Verified that $\sum \text{Assets} - \sum \text{Liabilities} - \sum \text{Equity} = 0\text{n}$ holds strictly after every single transaction across 100 complex transactions, combining multi-billion-dollar capitalization with micro-currency movements.
2. **QA-ADV-21 (Multi-Leg Boundary Navigation):**
   Demonstrated that a single account receiving alternating debits and credits across 8 legs in a single transaction arrives at the exact boundary `9007199254735993n` without intermediate or net float corruption, and returns cleanly to standard numerical representation when credited below the boundary.
3. **QA-ADV-22 (Overdraft Boundary & Utilization):**
   Demonstrated that overdraft metrics (`getOverdraftUtilizedUnits()`, `getRemainingCreditUnits()`, `getAvailablePurchasingPowerUnits()`) track with single-base-unit fidelity down to $1\text{n}$ ($0.0001$ remaining credit) before rejecting a $2\text{n}$ breach with `InsufficientFundsError`.
4. **QA-ADV-23 (Snapshot Rollback Atomicity):**
   Proved that mid-transaction failure during step 7 execution cleanly restores `balanceUnits` across accounts in diverse states (extreme magnitude string balance, negative overdraft balance, micro-balance, standard balance) bit-for-bit.
5. **QA-ADV-24 (Idempotency Replay):**
   Confirmed that idempotency replays at high magnitude preserve cached transaction records deterministically without double-applying debits/credits or altering `balanceUnits`.

---

## 5. Backward Compatibility & System Integrity

1. **API Backward Compatibility:**
   - Callers reading `account.balance` for standard balances continue receiving JavaScript `Number` primitives.
   - Callers passing numeric or string amounts into `toBaseUnits` or `fromBaseUnits` receive consistent, exact results.
2. **First-Class BigInt APIs:**
   - Callers desiring guaranteed arbitrary precision can use `account.balanceUnits`, `account.creditLimitUnits`, and `account.formattedBalance`.
3. **Regression Safety:**
   - All 19 historical defect regressions (DEFECT-IRONCLAD-001 through DEFECT-IRONCLAD-019) pass cleanly.
   - All 24 adversarial tests (QA-ADV-01 through QA-ADV-24) pass cleanly.
   - Baseline ledger mechanics and overdraft acceptance criteria (AC1 through AC6) pass cleanly.

---

## 6. QA Sign-Off & Recommendation

The remediation of **DEFECT-IRONCLAD-019** implemented in commit `829e9e36a7f61a8cddf0d509ee2742cda9e465e7` is **VERIFIED AND APPROVED**.
The ledger service now provides end-to-end mathematical precision in exact `BigInt` base units, eliminating IEEE 754 sub-cent precision loss across all operations.

**Quality Gate Status:** **PASSED (75/75 GREEN)**

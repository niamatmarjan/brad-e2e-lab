# BRAD Operation Ironclad: Phase 1 Defect Reproduction Report (DEFECT-IRONCLAD-018)

**Document ID:** `DEFECT-REPRO-IRONCLAD-018`  
**Evaluation Target:** `apex-ledger.bundle` at baseline commit `61b8c36c8a9ea8b1d808a5837186804c3fb926b3`  
**Tracking Issue:** GitHub Issue #13 (niamatmarjan/brad-e2e-lab#13)  
**Date:** 2026-10-27  
**Severity:** CRITICAL / P1 (Monetary Balance Invariant Violation)  
**Status:** **REPRODUCED CONFIRMED (RED TEST ESTABLISHED)**

---

## 1. Defect Description & Context

While DEFECT-IRONCLAD-017 introduced `MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER / 10000 = 900719925474.0991` to bound individual entry amounts and account balances against IEEE 754 safe integer limits, the ledger's double-entry zero-sum balance guard in `postTransaction` still accumulated monetary entries using floating-point arithmetic:

```javascript
// ledger.mjs (lines 294-305)
let totalDebit = 0;
let totalCredit = 0;
for (const entry of sanitizedEntries) {
  if (entry.direction === 'debit') totalDebit += entry.amount;
  else if (entry.direction === 'credit') totalCredit += entry.amount;
}
const debitUnits = Math.round(totalDebit * 10000);
const creditUnits = Math.round(totalCredit * 10000);
if (debitUnits !== creditUnits) {
  throw new Error(`Unbalanced transaction: debits (${totalDebit}) != credits (${totalCredit})`);
}
```

When multiple entries near `MAX_SAFE_AMOUNT` are summed in `totalDebit`, the intermediate sum exceeds `Number.MAX_SAFE_INTEGER / 10000`, causing floating-point quantization error where subunit additions (e.g. `0.0001`) are truncated by IEEE 754 float representation (`1801439850948.1982 + 0.0001 === 1801439850948.1982`). Consequently, `debitUnits === creditUnits` evaluates to `true`, and an unbalanced transaction is accepted and committed into the ledger.

---

## 2. Experimental Reproduction Protocol

1. **Restored Environment:** Restored `apex-ledger.bundle` to `/tmp/apex-ledger-restored` at commit `61b8c36c8a9ea8b1d808a5837186804c3fb926b3`.
2. **Account Setup:**
   - 3 asset accounts (`ast1`, `ast2`, `ast3`), type `asset` (debit-normal), currency `USD`, initial balance `0.0000`.
   - 2 revenue accounts (`rev1`, `rev2`), type `revenue` (credit-normal), currency `USD`, initial balance `0.0000`.
3. **5-Entry Transaction:**
   - Debit 1: `ast1`, amount `MAX_SAFE_AMOUNT` (900719925474.0991)
   - Debit 2: `ast2`, amount `MAX_SAFE_AMOUNT` (900719925474.0991)
   - Debit 3: `ast3`, amount `0.0001`
   - Credit 1: `rev1`, amount `MAX_SAFE_AMOUNT` (900719925474.0991)
   - Credit 2: `rev2`, amount `MAX_SAFE_AMOUNT` (900719925474.0991)
4. **Execution Results:**
   - Transaction status returned: `POSTED`
   - `ast1.balance`: `900719925474.0991`
   - `ast2.balance`: `900719925474.0991`
   - `ast3.balance`: `0.0001`
   - `rev1.balance`: `900719925474.0991`
   - `rev2.balance`: `900719925474.0991`
   - Total debit base units: `18014398509481983n`
   - Total credit base units: `18014398509481982n`
   - Net discrepancy: `+1n` (0.0001 USD created without offsetting credit)

---

## 3. RED Regression Evidence

Executing the regression assertion expecting rejection (`assert.throws(() => ledger.postTransaction(...))`) on baseline commit `61b8c36c8a9ea8b1d808a5837186804c3fb926b3` produces:

```
AssertionError [ERR_ASSERTION]: Missing expected exception.
    code: 'ERR_ASSERTION'
    operator: 'throws'
```

This confirms the failure is genuine and establishes the RED baseline before remediation.

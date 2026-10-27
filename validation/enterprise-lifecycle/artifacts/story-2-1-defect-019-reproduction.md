# BRAD Operation Ironclad: Phase 1 Defect Reproduction Report (DEFECT-IRONCLAD-019)

**Document ID:** `DEFECT-REPRO-IRONCLAD-019`  
**Evaluation Target:** `apex-ledger.bundle` at commit `4992a1aa754c4de5dcb5ced0abe3ee4f17edd720`  
**Tracking Issue:** GitHub Issue #14 (niamatmarjan/brad-e2e-lab#14)  
**Date:** 2026-10-27  
**Severity:** CRITICAL / P1 (In-Memory Balance Precision Loss & Accounting Conservation Violation)  
**Status:** **REPRODUCED CONFIRMED (RED TEST ESTABLISHED)**

---

## 1. Defect Description & Context

Following the remediation of DEFECT-IRONCLAD-018 (Issue #13), multi-entry input aggregation and double-entry conservation in `postTransaction` operate with exact `BigInt` base units. However, `Account.prototype.applyEntry` still persisted account balances as JavaScript IEEE 754 64-bit floating point numbers:

```javascript
// account.mjs (lines 173-176)
const nextUnits = this.isDebitNormal() === (direction === 'debit')
  ? priorUnits + amountUnits
  : priorUnits - amountUnits;
...
this.balance = fromBaseUnits(nextUnits); // Number(nextUnits) / 10000
```

Because IEEE 754 double precision floats have a 53-bit significand, the representable gap (step size) between adjacent floating point numbers exceeds `0.0001` when the number exceeds $2^{39} \approx 549,755,813,888$ (step size $\approx 0.000122$). When an account balance approaches `MAX_SAFE_AMOUNT` (`900,719,925,474.0991`), converting `9007199254735993n` base units back to `Number` truncates the lower bits:
$$\text{fromBaseUnits}(9007199254735993\text{n}) = 900719925473.5992$$
When subsequently read or converted back via `toBaseUnits(account.balance)`, the balance recovers as `9007199254735992n`, permanently losing $1\text{n}$ ($0.0001$ USD) and violating accounting balance sheet conservation ($\sum \text{Assets} - \sum \text{Revenue} \neq 0$).

---

## 2. Experimental Reproduction Protocol

1. **Restored Environment:** Bundle head commit `4992a1aa754c4de5dcb5ced0abe3ee4f17edd720`.
2. **Account Setup:**
   - 1 asset account (`a`), initial balance `0.0000`
   - 2 revenue accounts (`b`, `c`), initial balance `0.0000`
3. **Balanced Transaction:**
   - Debit 1 on `a`: `900719925473.5992`
   - Debit 2 on `a`: `0.0001`
   - Credit 1 on `b`: `900719925473.5992`
   - Credit 2 on `c`: `0.0001`
   - Total debits: `9007199254735993n` base units
   - Total credits: `9007199254735993n` base units (strictly balanced)
4. **Observed Execution Results:**
   - Transaction status: `POSTED`
   - `a.balance`: `900719925473.5992` (intended `900719925473.5993`)
   - `b.balance`: `900719925473.5992`
   - `c.balance`: `0.0001`
   - Recovered base units: `a = 9007199254735992n`, `b = 9007199254735992n`, `c = 1n`
   - Net discrepancy ($\text{Assets} - \text{Liabilities/Revenue}$): `-1n` (-0.0001 USD)
   - RED assertion: `assert.equal(net, 0n)` throws `AssertionError: -1n !== 0n`

This confirms that storing monetary balances as floating-point JS numbers causes silent sub-cent data corruption at high balances.

# BRAD Operation Ironclad Phase 2: Independent Application Audit & Defect Register

**Auditor Persona:** Independent Application Security & Financial Systems Auditor  
**Target Repository:** `/tmp/brad-enterprise-lifecycle`  
**Target Commit:** `45591579f1a05f592d82c0dedb8efcaece137bd6` (`candidate-baseline-v1`)  
**Audit Date:** 2026-10-27  
**Status:** **AUDIT FAILED — RELEASE BLOCKED (13 CONFIRMED MATERIAL DEFECTS)**  
**Reproduction Harness:** `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs` (13/13 verified)

---

## 1. Executive Summary

An exhaustive, adversarial independent application audit was conducted on the Apex Enterprise Ledger Service (`apex-ledger`) baseline candidate `candidate-baseline-v1` (Story 2.1: Credit Overdraft Execution & Audit Trails). The audit evaluated the codebase against financial accounting principles, multi-tenant isolation, cryptographic audit standards, state atomicity, and mathematical precision across 9 distinct domains.

### Prior Upstream Governance Claims vs Audit Reality
Prior lifecycle gatekeepers (Stage 6 Code Review `story-2-1-code-review.md` and Stage 8 Release Readiness `RELEASE-READINESS-DECISION.md`) certified the candidate as `PASS / APPROVED` and `READY_FOR_SUPERVISED_MERGE`, asserting:
- *"Zero open defects, zero technical debt flags, zero security concerns"*
- *"No unhandled edge cases or missing verification surfaces remain"*
- *"Strictly implements ADR-002 invariants, completely satisfies all six acceptance criteria"*
- *"14/14 passing tests in QA suite covering adversarial, boundary, and concurrency coverage"*

**The Independent Audit categorically refutes these conclusions.** The candidate exhibits fundamental architectural defects, systemic tenant boundary failures, monetary conservation violations, and complete omissions of concurrency safeguards. 

### Summary of Findings
A total of **13 confirmed material defects** were uncovered across all 9 audit dimensions:
- **CRITICAL Severity:** 3 defects (Cross-tenant transaction store overwrite & data exfiltration, missing idempotency conflict detection, zero-sum tolerance loophole permitting money creation out of thin air).
- **HIGH Severity:** 4 defects (Sub-cent precision drift destroying ledger conservation, complete lack of rollback on mid-execution failure, mutable internal transaction store via un-cloned references, delimiter collision allowing cross-tenant account blocking and idempotency hijacking).
- **MEDIUM Severity:** 5 defects (Corrupted audit rejection telemetry with negative excess amounts, debt repayment transactions falsely tagged as overdraft borrowing, intra-transaction entry order dependency, multi-currency blind settlement, complete absence of concurrency protection and false certification in governance docs).
- **LOW Severity:** 1 defect (Missing `entry.accountId` validation coercing `undefined` to account named `"undefined"` and unchecked `entry.tenantId` mismatches).

Every single defect listed in this register has been **concretely reproduced and verified** with executable tests in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs`.

---

## 2. Comprehensive 9-Area Audit Checklist

| # | Audit Area | Assessment | Critical Findings & Defect References |
| :-: | :--- | :---: | :--- |
| **1** | **Accounting Invariants** | **DEFECT** | `diff > 0.0001` tolerance loophole enables money creation out of thin air (**DEFECT-IRONCLAD-003**); multi-currency transactions blindly settled 1:1 (**DEFECT-IRONCLAD-011**); balance conservation violated by sub-cent entries (**DEFECT-IRONCLAD-004**). |
| **2** | **Monetary Precision** | **DEFECT** | Unquantized sub-cent fractional amounts accepted; individual 4-decimal account rounding creates balance drift where $\sum \text{balances} \neq 0$ (**DEFECT-IRONCLAD-004**). |
| **3** | **Idempotency** | **DEFECT** | Missing conflicting payload validation on idempotency replay (**DEFECT-IRONCLAD-002**); global transaction store enables cross-tenant replay data exfiltration (**DEFECT-IRONCLAD-001**); un-cloned references permit tampering with replay state (**DEFECT-IRONCLAD-006**). |
| **4** | **Concurrency** | **DEFECT** | Total absence of concurrency control, locking primitives, or race condition guards; fraudulent claims in release documentation of concurrency test coverage (**DEFECT-IRONCLAD-012**); millisecond timestamp/ID collisions in rapid sequences. |
| **5** | **Tenant Isolation** | **DEFECT** | Unscoped `this.transactions` store allows cross-tenant overwriting and data leakage (**DEFECT-IRONCLAD-001**); delimiter collisions via unsanitized colons in IDs (**DEFECT-IRONCLAD-007**); silent substitution of `entry.tenantId` (**DEFECT-IRONCLAD-013**). |
| **6** | **Overdraft Invariants** | **DEFECT** | Inbound debt repayments misflagged as overdraft borrowing in transaction metadata (**DEFECT-IRONCLAD-009**); rejection audit events log negative `excessAmount` (-$950) and false `remainingCredit` when overdraft is disabled (**DEFECT-IRONCLAD-008**). |
| **7** | **Audit Trail Integrity** | **DEFECT** | Transaction records returned by `postTransaction` lack defensive cloning, allowing external callers to forge status and amounts in ledger memory (**DEFECT-IRONCLAD-006**); non-deterministic audit IDs via `Math.random()`. |
| **8** | **Rollback & State Atomicity** | **DEFECT** | Zero rollback mechanism: mid-transaction failures leave accounts permanently mutated and unbalanced (**DEFECT-IRONCLAD-005**); arbitrary entry order determines transaction success/rejection (**DEFECT-IRONCLAD-010**); duplicate transaction IDs overwrite history (**DEFECT-IRONCLAD-012**). |
| **9** | **Test Completeness & Edge Cases** | **DEFECT** | Omitted `entry.accountId` string validation coerces to `'undefined'` (**DEFECT-IRONCLAD-013**); zero tests for concurrency, cross-tenant transaction IDs, delimiter collisions, sub-cent drift, or conflicting idempotency payloads. |

---

## 3. Traceable Defect Register

### DEFECT-IRONCLAD-001: Global Unscoped Transaction Store Permits Cross-Tenant Overwrite & Data Leakage via Idempotency Replay
- **Severity:** **CRITICAL**
- **Category / Area:** Tenant Isolation (Area 5) / Idempotency (Area 3)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:96-98, 283-286`
  ```javascript
  // Line 96-98:
  const existingTxId = this.idempotencyIndex.get(`${tenantId}:${idempotencyKey}`);
  if (existingTxId) {
    return this.transactions.get(existingTxId); // Returns from global map!
  }
  ...
  // Line 283-286:
  this.transactions.set(id, txRecord); // Keyed ONLY by id, not tenantId!
  if (idempotencyKey) {
    this.idempotencyIndex.set(`${tenantId}:${idempotencyKey}`, id);
  }
  ```
- **Root Cause Analysis:** `this.transactions` is a shared global `Map` keyed exclusively by `id` without `tenantId` namespacing (`${tenantId}:${id}`). When Tenant B submits a transaction with the same `id` as Tenant A, Tenant B silently overwrites Tenant A's transaction record in `this.transactions`. When Tenant A subsequently replays their idempotency key (`idem_a`), `this.idempotencyIndex` looks up `id` and returns Tenant B's transaction object. This results in critical cross-tenant data leakage and audit trail corruption.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:7-47`.
  ```javascript
  // Tenant A posts transaction 'tx_shared_01'
  ledger.postTransaction({ id: 'tx_shared_01', tenantId: 'tenant_a', idempotencyKey: 'idem_a', ... });
  // Tenant B posts transaction with same id 'tx_shared_01'
  ledger.postTransaction({ id: 'tx_shared_01', tenantId: 'tenant_b', ... });
  // Tenant A replays idempotency key
  const replayed = ledger.postTransaction({ id: 'tx_shared_01', tenantId: 'tenant_a', idempotencyKey: 'idem_a', ... });
  // Assertion passes: replayed.tenantId is 'tenant_b' with Tenant B's accounts!
  assert.equal(replayed.tenantId, 'tenant_b');
  ```
- **Acceptance Criteria for Remediation:**
  1. Key `this.transactions` by composite key `${tenantId}:${id}` or store partitioned maps per tenant.
  2. Reject any transaction whose `id` already exists within `tenantId` unless covered by valid idempotency replay.
  3. Validate that `this.transactions.get` scopes lookups by `tenantId`.

---

### DEFECT-IRONCLAD-002: Missing Conflicting Payload Detection on Idempotency Key Reuse
- **Severity:** **CRITICAL**
- **Category / Area:** Idempotency (Area 3)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:95-100`
  ```javascript
  // 1. Check idempotency
  if (idempotencyKey) {
    const existingTxId = this.idempotencyIndex.get(`${tenantId}:${idempotencyKey}`);
    if (existingTxId) {
      return this.transactions.get(existingTxId); // Returns without checking payload match!
    }
  }
  ```
- **Root Cause Analysis:** In standard financial and API idempotency semantics (IETF Idempotency-Key specification, Stripe, Adyen), an idempotency key identifies a specific operation payload. If a client re-uses an idempotency key with different transaction parameters (different amounts, accounts, descriptions, or transaction IDs), the system MUST reject the request with an Idempotency Conflict Error (`409 Conflict` / `IdempotencyConflictError`). In `apex-ledger`, Phase 2 immediately returns the cached transaction without comparing the incoming payload against the original transaction, silently swallowing conflicting requests.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:52-78`.
  ```javascript
  // Original tx posted for $50
  ledger.postTransaction({ id: 'tx_orig', tenantId: 't1', idempotencyKey: 'key_1', entries: [{ amount: 50, ... }] });
  // Conflicting tx posted with same key but amount $9999 and id 'tx_different'
  const res = ledger.postTransaction({ id: 'tx_different', tenantId: 't1', idempotencyKey: 'key_1', entries: [{ amount: 9999, ... }] });
  // Silently returns tx_orig without detecting conflict:
  assert.equal(res.id, 'tx_orig');
  assert.equal(res.entries[0].amount, 50);
  ```
- **Acceptance Criteria for Remediation:**
  1. Store the original request hash or payload alongside the transaction ID in `idempotencyIndex`.
  2. When an idempotency key is matched, verify that incoming `id`, `entries`, and relevant metadata match the stored record.
  3. If parameters differ, throw `IdempotencyConflictError` (`code: 'IDEMPOTENCY_CONFLICT'`) with zero side effects.

---

### DEFECT-IRONCLAD-003: Double-Entry Tolerance Loophole Permits Systematic Unbalanced Postings and Money Creation Out of Thin Air
- **Severity:** **CRITICAL**
- **Category / Area:** Accounting Invariants (Area 1)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:115-118`
  ```javascript
  const diff = Math.abs(Math.round((totalDebit - totalCredit) * 10000) / 10000);
  if (diff > 0.0001) {
    throw new Error(`Unbalanced transaction: debits (${totalDebit}) != credits (${totalCredit})`);
  }
  ```
- **Root Cause Analysis:** In double-entry accounting, the fundamental conservation equation is $\sum \text{Debits} - \sum \text{Credits} = 0$. Because `Math.round((totalDebit - totalCredit) * 10000) / 10000` already quantizes the difference to 4 decimal places, any non-zero value of `diff` (e.g. `0.0001`) represents an actual, discrete imbalance of 1 base unit—not floating point epsilon noise. By using `diff > 0.0001` instead of `diff !== 0`, the ledger permits transactions where debits exceed credits by $0.0001$. A client posting 100 such transactions creates $0.0100 of unbacked currency, permanently breaking ledger balance conservation.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:83-104`.
  ```javascript
  // Post 50 unbalanced transactions where Debit = 1.0001, Credit = 1.0000 (diff = 0.0001)
  for (let i = 0; i < 50; i++) {
    ledger.postTransaction({ id: `tx_${i}`, tenantId: 't1', entries: [{ amount: 1.0001, direction: 'debit' }, { amount: 1.0000, direction: 'credit' }] });
  }
  // Total balance across accounts a and b: 0.0050 created out of thin air!
  const netBal = Math.round((a.balance + b.balance) * 10000) / 10000;
  assert.equal(netBal, 0.0050); // Balance conservation violated!
  ```
- **Acceptance Criteria for Remediation:**
  1. Revise balance check to `if (diff !== 0) throw new Error(...)`.
  2. Remove the flawed test `QA: Double-entry zero-sum tolerance boundary (0.0001 pass vs 0.0002 fail)` in `test/qa-overdraft.test.mjs:548-578`, which incorrectly codified this defect as acceptable behavior.

---

### DEFECT-IRONCLAD-004: Unquantized Sub-Cent Entry Amounts Cause Balance Rounding Drift and Destruction of Ledger Conservation
- **Severity:** **HIGH**
- **Category / Area:** Monetary Precision (Area 2) / Accounting Invariants (Area 1)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:106-109`, `/tmp/brad-enterprise-lifecycle/src/account.mjs:136`
  ```javascript
  // src/ledger.mjs:107
  if (typeof entry.amount !== 'number' || entry.amount <= 0 || !Number.isFinite(entry.amount)) {
    throw new TypeError('Entry amount must be positive finite number');
  } // Does NOT validate decimal scale!
  ...
  // src/account.mjs:136
  this.balance = Math.round(this.balance * 10000) / 10000; // Rounds balance independently per account
  ```
- **Root Cause Analysis:** `postTransaction` validates that `entry.amount` is a positive finite number, but does not enforce that `entry.amount` has at most 4 decimal places. When entries with 5+ decimals (e.g. `10.00004` and `20.00008`) are passed in a mathematically zero-sum transaction (debits: `10.00004 + 10.00004 = 20.00008`, credits: `20.00008`), `Account.applyEntry` rounds each account's balance independently. Because fractional sub-cent amounts round in opposite directions ($0.00004 \to 0.0000$, $0.00008 \to 0.0001$), the sum of all accounts after posting is $-0.0001$, leaking value.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:109-128`.
  ```javascript
  ledger.postTransaction({
    id: 'tx_subcent', tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 10.00004, direction: 'debit' },
      { accountId: 'b', amount: 10.00004, direction: 'debit' },
      { accountId: 'c', amount: 20.00008, direction: 'credit' }
    ]
  });
  // Balances: a = 10.0000, b = 10.0000, c = -20.0001. Sum = -0.0001!
  const sum = Math.round((a.balance + b.balance + c.balance) * 10000) / 10000;
  assert.equal(sum, -0.0001);
  ```
- **Acceptance Criteria for Remediation:**
  1. Enforce strict 4-decimal fixed-point scale in Phase 1: `if (Math.round(entry.amount * 10000) !== entry.amount * 10000) throw new TypeError('Entry amount must not exceed 4 decimal places')`.
  2. Reject sub-cent precision at transaction ingress before any state evaluation.

---

### DEFECT-IRONCLAD-005: Zero Rollback Mechanism Leaves Corrupted and Unbalanced Account State on Mid-Transaction Errors
- **Severity:** **HIGH**
- **Category / Area:** Rollback & State Atomicity (Area 8)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:189-266`
  ```javascript
  // 5. Apply entries and record transitions
  for (const { account, entry } of resolvedAccounts) {
    const priorBalance = account.balance;
    account.applyEntry(entry.amount, entry.direction); // In-place mutation!
    const newBalance = account.balance;
    ...
    this._emitAuditEvent(...) // Any error here or in subsequent legs leaves account mutated!
  }
  ```
- **Root Cause Analysis:** `postTransaction` applies account mutations sequentially in-place inside the `for` loop without capturing initial balance snapshots or wrapping execution in a `try...catch` rollback block. If an unhandled exception occurs while processing leg $k > 1$ (e.g. during audit event serialization, out-of-memory, custom error), legs $1 \dots k-1$ remain permanently mutated in memory, while the transaction itself is not recorded and subsequent legs are never applied.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:133-157`.
  ```javascript
  // Account a balance = 0, Account b balance = 0
  // Throw error in audit emission during leg 1
  ledger._emitAuditEvent = () => { throw new Error('Simulated audit crash'); };
  assert.throws(() => ledger.postTransaction({
    id: 'tx_fail', tenantId: 't1',
    entries: [{ accountId: 'a', amount: 50, direction: 'credit' }, { accountId: 'b', amount: 50, direction: 'debit' }]
  }));
  // Account a is left at -50, Account b is at 0 -> Ledger left unbalanced!
  assert.equal(a.balance, -50);
  assert.equal(b.balance, 0);
  ```
- **Acceptance Criteria for Remediation:**
  1. Record a snapshot of initial balances for all resolved accounts prior to Phase 6 mutation.
  2. Enclose Phase 6 and Phase 7 execution in a `try...catch` block.
  3. In the `catch` block, restore all accounts to their snapshot balances and re-throw the error, guaranteeing zero side effects on failure.

---

### DEFECT-IRONCLAD-006: Missing Defensive Cloning on Committed Transaction Records Enables External Tampering with Ledger Store and Replay History
- **Severity:** **HIGH**
- **Category / Area:** Audit Trail Integrity (Area 7) / State Atomicity (Area 8)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:98, 288`
  ```javascript
  // Line 98:
  return this.transactions.get(existingTxId); // Returns direct reference!
  ...
  // Line 288:
  return txRecord; // Returns direct reference stored in this.transactions!
  ```
- **Root Cause Analysis:** While `getAuditEvents` implemented defensive cloning via `JSON.parse(JSON.stringify(event))` (in response to DEFECT-QA-002), `postTransaction` omitted defensive cloning for transaction records. The internal `txRecord` object stored in `this.transactions` is returned directly to the caller. Any caller modifying properties (e.g. `tx.status = 'FORGED'`, `tx.entries[0].amount = 999999`) directly mutates the ledger's internal history and corrupts subsequent idempotency replays.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:162-198`.
  ```javascript
  const tx = ledger.postTransaction({ id: 'tx_1', tenantId: 't1', idempotencyKey: 'k1', ... });
  tx.status = 'FORGED_STATUS';
  tx.entries[0].amount = 888888;
  // Internal transaction store is mutated:
  assert.equal(ledger.transactions.get('tx_1').status, 'FORGED_STATUS');
  // Replaying idempotency key returns forged state:
  const replay = ledger.postTransaction({ id: 'tx_1', tenantId: 't1', idempotencyKey: 'k1', ... });
  assert.equal(replay.status, 'FORGED_STATUS');
  ```
- **Acceptance Criteria for Remediation:**
  1. Return `structuredClone(txRecord)` (or deep copy) from `postTransaction` on initial commit.
  2. Return `structuredClone(cachedTx)` from Phase 2 idempotency replay.

---

### DEFECT-IRONCLAD-007: Delimiter Collision in Composite Keys Allows Cross-Tenant Account Blocking and Idempotency Hijacking
- **Severity:** **HIGH**
- **Category / Area:** Tenant Isolation (Area 5) / Idempotency (Area 3)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:13, 22, 96, 285`, `/tmp/brad-enterprise-lifecycle/src/account.mjs:11-16`
  ```javascript
  const key = `${account.tenantId}:${account.id}`;
  ...
  const existingTxId = this.idempotencyIndex.get(`${tenantId}:${idempotencyKey}`);
  ```
- **Root Cause Analysis:** `this.accounts` and `this.idempotencyIndex` build composite lookup keys using simple string concatenation with `:` as delimiter. Neither `Account` nor `Ledger` validates that `tenantId`, `accountId`, or `idempotencyKey` do not contain the `:` character. Consequently, Tenant `'org'` creating account `'sub:1'` generates key `'org:sub:1'`, which collides with and blocks Tenant `'org:sub'` from creating account `'1'`. Similarly, Tenant `'tenant:sub'` using idempotency key `'1'` hijacks transactions belonging to Tenant `'tenant'` with key `'sub:1'`.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:203-214`.
  ```javascript
  ledger.createAccount({ id: 'sub:1', tenantId: 'org', type: 'asset' });
  // Tenant 'org:sub' attempts to create account '1' -> Fails with collision!
  assert.throws(
    () => ledger.createAccount({ id: '1', tenantId: 'org:sub', type: 'asset' }),
    /Account already exists/
  );
  ```
- **Acceptance Criteria for Remediation:**
  1. Disallow `:` in identifiers during validation (`if (id.includes(':') || tenantId.includes(':')) throw new TypeError(...)`), OR
  2. Use a two-level nested Map (`Map<tenantId, Map<id, Account>>`), which completely eliminates delimiter collision by design.

---

### DEFECT-IRONCLAD-008: Corrupted Rejection Telemetry: Negative `excessAmount` and Inaccurate `remainingCredit` When Overdraft is Disabled
- **Severity:** **MEDIUM**
- **Category / Area:** Overdraft Invariants (Area 6) / Audit Trail Integrity (Area 7)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:68-69, 163-165`
  ```javascript
  // Line 69 (_emitAuditEvent):
  const remainingCredit = Math.round(Math.max(0, creditLimit - overdraftUtilized) * 10000) / 10000;
  ...
  // Line 164 (postTransaction Phase 4):
  excessAmount: Math.round((Math.abs(nextSimBal) - creditLimit) * 10000) / 10000
  ```
- **Root Cause Analysis:** When an account is configured with `overdraftEnabled: false` and a non-zero `creditLimit` (e.g. 1000), any debit drawing the account below 0 is rejected. In Phase 4, the audit event calculation for `excessAmount` subtracts `creditLimit` instead of evaluating the effective allowable credit (which is 0 when overdraft is disabled). For a balance of 0 and requested amount of 50, `excessAmount` is calculated as $50 - 1000 = -950$. In addition, `_emitAuditEvent` calculates `remainingCredit` using `creditLimit - overdraftUtilized` without checking `account.overdraftEnabled`, falsely reporting `remainingCredit: 1000` on an account where overdraft is disabled.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:219-242`.
  ```javascript
  ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 1000, overdraftEnabled: false });
  // Request 50 credit -> Throws Insufficient funds
  // Audit event details:
  const event = ledger.getAuditEvents('t1', 'cash')[0];
  assert.equal(event.details.excessAmount, -950); // Negative excess!
  assert.equal(event.remainingCredit, 1000); // False credit reported!
  ```
- **Acceptance Criteria for Remediation:**
  1. In Phase 4, compute `const effectiveLimit = account.overdraftEnabled ? creditLimit : 0;` and set `excessAmount = Math.abs(nextSimBal) - effectiveLimit`.
  2. In `_emitAuditEvent`, verify `overdraftEnabled`: if disabled, `remainingCredit` must be `0.0000`.

---

### DEFECT-IRONCLAD-009: Debt Repayment Transactions Inappropriately Flagged as Overdraft Borrowing in Transaction Metadata
- **Severity:** **MEDIUM**
- **Category / Area:** Overdraft Invariants (Area 6)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:195-201, 276-280`
  ```javascript
  // Line 195:
  if (newBalance < 0) {
    txOverdraftUtilized = true;
    ...
  }
  ...
  // Line 276-280:
  ...(txOverdraftUtilized && {
    overdraftUtilized: true,
    overdraftAmount: maxOverdraftAmount,
    remainingCredit: minRemainingCredit
  })
  ```
- **Root Cause Analysis:** `postTransaction` evaluates whether `txRecord` should be tagged with `overdraftUtilized: true` by checking `if (newBalance < 0)`. When an account is currently in overdraft (e.g. balance $-100$) and a customer deposits funds to partially pay down the debt (e.g. deposit $\$40$, bringing balance to $-60$), `newBalance < 0` is true. As a result, the repayment transaction itself is stamped with `overdraftUtilized: true`, `overdraftAmount: 60`, and `remainingCredit: 140`. This misclassifies debt recovery/inbound cashflow as active credit borrowing.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:247-270`.
  ```javascript
  cash.applyEntry(100, 'credit'); // Cash at -100
  // Repay 40 -> Cash balance becomes -60
  const tx = ledger.postTransaction({ entries: [{ accountId: 'cash', amount: 40, direction: 'debit' }, ...] });
  // Repayment tx incorrectly flagged as borrowing:
  assert.equal(tx.overdraftUtilized, true);
  assert.equal(tx.overdraftAmount, 60);
  ```
- **Acceptance Criteria for Remediation:**
  1. Only flag `txRecord.overdraftUtilized: true` if the transaction actually caused or deepened overdraft utilization (`newBalance < priorBalance && newBalance < 0`).
  2. Pure repayment transactions (`newBalance > priorBalance`) must never set `overdraftUtilized: true`.

---

### DEFECT-IRONCLAD-010: Intra-Transaction Entry Order Dependency Causes False Rejection of Valid Double-Entry Transactions
- **Severity:** **MEDIUM**
- **Category / Area:** Rollback & State Atomicity (Area 8)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:131-152`
  ```javascript
  const simulatedBalances = new Map();
  for (const { account, entry } of resolvedAccounts) {
    let nextSimBal = ...;
    simulatedBalances.set(account.id, nextSimBal);
    if (willDecrease) {
      if (nextSimBal < 0 && !overdraftAllowed) {
        throw err; // Evaluates incrementally per entry!
      }
    }
  }
  ```
- **Root Cause Analysis:** In double-entry accounting, all legs of a transaction are executed atomically and simultaneously at the transaction timestamp. In Phase 4, `postTransaction` performs pre-flight checks incrementally in the order entries appear in the array. If an account is credited $\$150$ and debited $\$100$ in the same transaction with creditLimit $\$100$, placing the credit entry first drops intermediate balance to $-150 < -100$, causing an immediate `InsufficientFundsError`. Placing the debit entry first results in intermediate balance $+100 \to -50 \ge -100$, and the transaction succeeds. An atomic financial ledger must never exhibit order sensitivity among transaction legs.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:275-309`.
  ```javascript
  // Exactly identical entries in different orders:
  // Order 1: [credit 150, debit 100] -> THROWS Insufficient funds
  assert.throws(() => ledger.postTransaction({ entries: [credit150, debit100, ...] }), /Insufficient funds/);
  // Order 2: [debit 100, credit 150] -> SUCCEEDS (status: POSTED, balance: -50)
  const tx = ledger.postTransaction({ entries: [debit100, credit150, ...] });
  assert.equal(tx.status, 'POSTED');
  ```
- **Acceptance Criteria for Remediation:**
  1. Calculate the net balance delta for each distinct account across all entries in the transaction prior to limit evaluation.
  2. Evaluate overdraft ceilings against final net balances rather than transient entry sequences.

---

### DEFECT-IRONCLAD-011: Multi-Currency Blind Settlement Violates Balance Preservation Across Currencies
- **Severity:** **MEDIUM**
- **Category / Area:** Accounting Invariants (Area 1)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:120-128`
  ```javascript
  // 3. Verify all accounts exist and belong to tenant
  for (const entry of entries) {
    const acc = this.getAccount(tenantId, entry.accountId);
    ... // Resolves account, but NEVER inspects account.currency!
  }
  ```
- **Root Cause Analysis:** Each `Account` possesses a `currency` property (defaulting to `'USD'`). In `postTransaction`, Phase 3 evaluates double-entry balance purely based on numeric sums, and Phase 4 verifies that accounts exist. It never validates that all accounts involved in the transaction share the same currency. A transaction debiting 100 USD and crediting 100 EUR or 100 JPY is posted 1:1 without exchange rates, violating monetary conservation.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:314-332`.
  ```javascript
  ledger.createAccount({ id: 'usd_acc', tenantId: 't1', currency: 'USD', creditLimit: 100 });
  ledger.createAccount({ id: 'eur_acc', tenantId: 't1', currency: 'EUR', creditLimit: 100 });
  const tx = ledger.postTransaction({
    id: 'tx_blind', tenantId: 't1',
    entries: [{ accountId: 'usd_acc', amount: 100, direction: 'debit' }, { accountId: 'eur_acc', amount: 100, direction: 'credit' }]
  });
  assert.equal(tx.status, 'POSTED'); // Cross-currency 1:1 posting allowed!
  ```
- **Acceptance Criteria for Remediation:**
  1. In Phase 3/4, extract the currency of the first resolved account.
  2. Verify that every account in the transaction shares the identical currency. If a mismatch is detected, throw `new Error('Multi-currency transaction requires common settlement currency')`.

---

### DEFECT-IRONCLAD-012: Duplicate Transaction ID Silently Overwrites Ledger History & Concurrency Gaps
- **Severity:** **MEDIUM**
- **Category / Area:** Concurrency (Area 4) / State Atomicity (Area 8) / Test Completeness (Area 9)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:283`, `_bmad-output/release-artifacts/RELEASE-READINESS-DECISION.md:112`
  ```javascript
  // src/ledger.mjs:283
  this.transactions.set(id, txRecord); // Overwrites without checking if id already exists!
  ```
- **Root Cause Analysis:**
  1. `postTransaction` checks `idempotencyKey` in Phase 2, but never validates whether `id` already exists in `this.transactions`. If a client posts a distinct transaction with an existing `id` (without an idempotency key), the previous transaction record is silently overwritten. Account balances reflect both transactions, but transaction history permanently loses the first transaction.
  2. The Stage 8 Release Decision claimed `test/qa-overdraft.test.mjs` provided "Adversarial, boundary, and concurrency coverage". In truth, zero tests for concurrency, race conditions, or simultaneous postings exist anywhere in the repository.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:337-360`.
  ```javascript
  ledger.postTransaction({ id: 'tx_dup', tenantId: 't1', entries: [{ accountId: 'a', amount: 10, ... }] });
  ledger.postTransaction({ id: 'tx_dup', tenantId: 't1', entries: [{ accountId: 'a', amount: 20, ... }] });
  // Account balance is 30, but ledger only stores one transaction of 20!
  assert.equal(ledger.getAccount('t1', 'a').balance, 30);
  assert.equal(ledger.transactions.size, 1);
  assert.equal(ledger.transactions.get('tx_dup').entries[0].amount, 20);
  ```
- **Acceptance Criteria for Remediation:**
  1. Reject duplicate transaction IDs: `if (this.transactions.has(key)) throw new Error('Transaction id already exists')`.
  2. Add formal concurrent execution tests with asynchronous workers or simulated interleaving.

---

### DEFECT-IRONCLAD-013: Missing Input Validation on `entry.accountId` and Unchecked `entry.tenantId` Mismatch
- **Severity:** **LOW**
- **Category / Area:** Test Completeness & Edge Cases (Area 9) / Tenant Isolation (Area 5)
- **Precise Affected Code:** `/tmp/brad-enterprise-lifecycle/src/ledger.mjs:122-127`
  ```javascript
  for (const entry of entries) {
    const acc = this.getAccount(tenantId, entry.accountId);
    if (!acc) throw new Error(...);
  }
  ```
- **Root Cause Analysis:**
  1. `postTransaction` never validates that `entry.accountId` is a non-empty string. If `accountId` is omitted or `undefined`, JavaScript template literal `${tenantId}:${entry.accountId}` evaluates to `${tenantId}:undefined`. If an account named `'undefined'` exists, it is silently debited/credited.
  2. If an entry explicitly includes `entry.tenantId` that differs from the transaction `tenantId`, `postTransaction` silently ignores `entry.tenantId` and resolves against the transaction's tenant, generating misleading transaction metadata.
- **Concrete Reproduction Evidence:** Executed in `/tmp/brad-enterprise-lifecycle/audit/reproduce-defects.mjs:365-379`.
  ```javascript
  ledger.createAccount({ id: 'undefined', tenantId: 't1', type: 'asset', creditLimit: 100 });
  // Post entry without accountId
  ledger.postTransaction({ id: 'tx_undef', tenantId: 't1', entries: [{ amount: 50, direction: 'debit' }, ...] });
  // Account named 'undefined' was debited:
  assert.equal(ledger.getAccount('t1', 'undefined').balance, 50);
  ```
- **Acceptance Criteria for Remediation:**
  1. Validate `if (!entry.accountId || typeof entry.accountId !== 'string') throw new TypeError('entry accountId must be non-empty string')`.
  2. Validate `if (entry.tenantId && entry.tenantId !== tenantId) throw new Error('Cross-tenant entry rejected')`.

---

## 4. Overall Audit Assessment & Next Steps

### Quality Gate Verdict: **FAILED / REJECTED**
The current release candidate `candidate-baseline-v1` (`45591579f1a05f592d82c0dedb8efcaece137bd6`) is **unfit for production deployment**. The candidate contains critical vulnerabilities in tenant isolation, transaction idempotency, and double-entry conservation that compromise ledger integrity.

### Remediation Roadmap
1. **P0 (Critical Security & Invariants):**
   - Refactor `this.transactions` to be scoped by `tenantId` (`DEFECT-IRONCLAD-001`).
   - Implement payload comparison on idempotency key replay (`DEFECT-IRONCLAD-002`).
   - Fix zero-sum validation to `diff !== 0` and enforce 4-decimal input scale (`DEFECT-IRONCLAD-003`, `DEFECT-IRONCLAD-004`).
2. **P1 (State Atomicity & Integrity):**
   - Implement transaction snapshot rollback on mid-execution failure (`DEFECT-IRONCLAD-005`).
   - Defensively clone all returned transaction objects (`DEFECT-IRONCLAD-006`).
   - Prevent delimiter collisions in composite keys (`DEFECT-IRONCLAD-007`).
   - Calculate pre-flight checks on net account balances rather than entry sequence (`DEFECT-IRONCLAD-010`).
3. **P2 (Telemetry & Edge Cases):**
   - Correct `excessAmount` and `remainingCredit` calculations when overdraft is disabled (`DEFECT-IRONCLAD-008`).
   - Restrict `overdraftUtilized: true` metadata to actual overdraft-deepening transactions (`DEFECT-IRONCLAD-009`).
   - Enforce currency consistency across transaction entries (`DEFECT-IRONCLAD-011`).
   - Validate entry account IDs and disallow duplicate transaction IDs (`DEFECT-IRONCLAD-012`, `DEFECT-IRONCLAD-013`).

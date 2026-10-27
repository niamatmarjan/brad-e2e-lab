---
id: "STORY-2.1"
key: "2.1"
title: "Credit Overdraft Execution & Audit Trails"
epic: "EPIC-2"
status: "ready-for-supervised-release"
created: "2026-10-27"
updated: "2026-10-27"
author: "Mary (BMAD Business Analyst)"
assigned_architect: "Winston (BMAD System Architect)"
initiative: "apex-ledger-overdraft"
upstream_prd: "_bmad-output/planning-artifacts/PRD-credit-overdraft.md"
upstream_epic: "_bmad-output/planning-artifacts/epics.md"
target_files:
  - "src/account.mjs"
  - "src/ledger.mjs"
  - "test/ledger.test.mjs"
points: 5
---

# Story 2.1: Credit Overdraft Execution & Audit Trails

## 1. Intent & Business Value

### 1.1 Problem Statement
When high-volume enterprise customer accounts exhaust pre-paid funds, transactions currently abort with `Insufficient funds`. This triggers high-severity production alerts, drops streaming API calls, and halts mission-critical batch workflows for enterprise tenants who possess pre-approved corporate credit agreements. Furthermore, the ledger currently lacks an immutable domain audit log, preventing financial reconciliation and regulatory compliance verification.

### 1.2 Proposed Approach
Extend `Account` and `Ledger` to support configurable credit limits (`creditLimit`), overdraft activation switches (`overdraftEnabled`), and alerting thresholds (`overdraftAlertThreshold`). Enable transactions to draw accounts into negative balance up to the configured credit line without dropping execution. Atomically reject transactions that breach credit boundaries with zero side effects. Automatically emit immutable domain audit events for all overdraft operations, and restore credit lines upon inbound deposit settlements.

---

## 2. Boundaries & Invariants

### 2.1 Always (Invariants)
- **Zero-Sum Balanced Double-Entry:** Every posted transaction must enforce $\sum \text{Debits} == \sum \text{Credits}$ within $0.0001$.
- **4-Decimal Fixed-Point Math:** All account balances, limits, overdraft calculations, and thresholds must be rounded via `Math.round(val * 10000) / 10000` to prevent IEEE 754 floating-point drift.
- **Strict Multi-Tenant Isolation:** All operations, accounts, transactions, and audit records are partitioned strictly by `tenantId`.
- **Atomic Rejection with Zero Side Effects:** If any account in a multi-entry transaction breaches its credit limit, no account balances are modified, no transaction is committed, and no idempotency index entry is saved.
- **Idempotency Without Redundant Auditing:** Replayed requests containing an existing `idempotencyKey` return the previously committed transaction record and emit zero duplicate audit events.
- **Immutable Append-Only Audit Trail:** Audit events cannot be deleted, altered, or truncated via the ledger interface.

### 2.2 Never (Non-Goals & Anti-Patterns)
- **Never Permit Silent Credit Overrun:** Balance must never fall below `-account.creditLimit` under any condition.
- **Never Permit Partial Fills:** If a transaction requires more than available purchasing power, reject the entire transaction; never perform split or partial debiting.
- **Never Allow Cross-Tenant Overdraft Pooling:** Accounts cannot share or pool credit limits across different tenants.
- **Never Mutate Internal Audit Logs:** Public retrieval methods (`getAuditEvents`) must never return mutable internal references.

---

## 3. Explicit Acceptance Criteria (AC1 through AC6)

### AC1: Account Overdraft Policy Configuration (FR-1)
- **Given** an account creation or policy update request:
  - `creditLimit` must be a non-negative finite number (defaults to `0`).
  - `overdraftEnabled` must be a boolean (defaults to `true` if `creditLimit > 0`, else `false`).
  - `overdraftAlertThreshold` must be a number between `0.0` and `1.0` inclusive (defaults to `0.8`).
- **When** invalid parameters are passed:
  - If `creditLimit < 0` or non-finite: throw `TypeError('creditLimit must be a non-negative finite number')`.
  - If `overdraftAlertThreshold < 0`, `> 1`, or non-finite: throw `TypeError('overdraftAlertThreshold must be a number between 0 and 1')`.
  - If `overdraftEnabled` is neither `undefined` nor boolean: throw `TypeError('overdraftEnabled must be a boolean')`.
- **Then** when an account's overdraft policy is modified, the ledger records an `OVERDRAFT_CONFIG_UPDATED` audit event.

### AC2: Dynamic Zero-Balance Overdraft Execution (FR-2)
- **Given** an account with `overdraftEnabled === true` and `creditLimit > 0`.
- **When** a debit transaction decreases the balance below zero (`balance < 0`), but the potential balance satisfies `potentialBalance >= -creditLimit`:
- **Then**:
  1. The transaction successfully posts with status `'POSTED'`.
  2. The account balance becomes negative, rounded to 4 decimals (e.g. balance `10.0000`, debit `35.0000` $\rightarrow$ balance `-25.0000`).
  3. The transaction object includes metadata:
     - `overdraftUtilized: true`
     - `overdraftAmount: 25` (the overdraft portion drawn)
     - `remainingCredit: 975` (if limit is 1000)
  4. The ledger emits an `OVERDRAFT_UTILIZED` audit event capturing the transition.
  5. Offsetting double-entry accounts receive their balanced counter-entries in full.

### AC3: Credit Limit Hard Cap Enforcement & Zero-Side-Effect Rollback (FR-3)
- **Given** an account with current `balance` and `creditLimit`.
- **When** a debit transaction would cause `potentialBalance < -creditLimit` (or `potentialBalance < 0` when `overdraftEnabled === false`):
- **Then**:
  1. The transaction is immediately aborted before any state mutation occurs.
  2. The ledger throws an Error matching `/Insufficient funds/` with the exact message:  
     `"Insufficient funds: account {id} balance is {balance}, creditLimit is {creditLimit}, requested {amount}"`
  3. The ledger records an `OVERDRAFT_LIMIT_BREACH_REJECTED` audit event capturing the rejected attempt.
  4. **Zero Side-Effects:** None of the accounts in the transaction have their balances altered, no transaction record is stored in `transactions`, and the `idempotencyIndex` is untouched.

### AC4: Overdraft Alert Threshold Triggers (FR-4)
- **Given** an account with `creditLimit > 0` and configured `overdraftAlertThreshold` (e.g. `0.8` for 80%).
- **When** a transaction causes the account's overdraft utilization ratio (`Math.abs(balance) / creditLimit`) to reach or exceed `overdraftAlertThreshold`:
- **Then**:
  1. The ledger emits an `OVERDRAFT_THRESHOLD_EXCEEDED` audit event in addition to the `OVERDRAFT_UTILIZED` audit event.
  2. The event includes exact `currentBalance`, `creditLimit`, `overdraftUtilized`, `remainingCredit`, and `details: { utilizationRatio, alertThreshold }`.

### AC5: Inbound Settlement & Overdraft Deficit Clearance / Reduction (FR-5)
- **Given** an account carrying a negative balance (`balance < 0`).
- **When** an inbound transaction credits the account (reducing the deficit):
- **Then**:
  1. If `newBalance >= 0`:
     - The deficit is cleared, and remaining credit is restored to `creditLimit`.
     - The ledger emits an `OVERDRAFT_CLEARED` audit event recording the full restitution of the credit facility.
  2. If `newBalance < 0` (partial repayment, e.g. balance was `-500`, credit `200` $\rightarrow$ new balance `-300`):
     - The overdraft is reduced, and remaining credit increases to `creditLimit - 300`.
     - The ledger emits an `OVERDRAFT_REDUCED` audit event.

### AC6: Audit Trail Immutability, Query API & Idempotency Protection (FR-4, NFR-3, NFR-5)
- **Given** transactions processed by the ledger:
- **When** `ledger.getAuditEvents(tenantId, [accountId])` is invoked:
- **Then**:
  1. It returns an array of audit event objects matching `tenantId` (and optionally filtered by `accountId`), sorted chronologically.
  2. The returned array and objects are protected from caller mutations (defensively cloned).
  3. If a transaction request is re-submitted with an identical `idempotencyKey`:
     - The cached transaction record is returned.
     - No balance updates occur.
     - Zero duplicate audit events are emitted.

---

## 4. State Transition Matrices

### 4.1 Account Lifecycle State Transition Matrix

An account carrying overdraft capabilities transitions across distinct operational states:

```
                  +--------------------------------+
                  |        NORMAL_POSITIVE         |
                  |         (balance > 0)          |
                  +---------------+----------------+
                                  |
              Debit exhausts paid | Inbound Credit
              balance (< 0)       | clears deficit (>= 0)
                                  v
                  +--------------------------------+
                  |        OVERDRAFT_ACTIVE        |
                  | (-creditLimit <= bal < 0)      |
                  | (utilization < threshold)      |
                  +---------------+----------------+
                                  |
               Debit pushes util  | Inbound Credit
               >= alertThreshold  | drops util < threshold
                                  v
                  +--------------------------------+
                  |        OVERDRAFT_ALERT         |
                  | (threshold <= util <= 1.0)     |
                  +---------------+----------------+
                                  |
               Debit exceeds      |
               creditLimit        | (Transaction Rejected)
                                  v
                  +--------------------------------+
                  |     LIMIT_BREACH_REJECTED      |
                  | (State retained, Tx Aborted)   |
                  +--------------------------------+
```

| Current State | Triggering Operation | Guard Condition | Next State | Ledger Balance Action | Audit Event Emitted |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NORMAL_POSITIVE** | Debit transaction | `balance - debit >= 0` | **NORMAL_POSITIVE** | `balance -= debit` | *None* |
| **NORMAL_POSITIVE** | Debit transaction | `balance - debit < 0` AND `Math.abs(balance - debit) <= creditLimit` AND `util < threshold` | **OVERDRAFT_ACTIVE** | `balance -= debit` (negative) | `OVERDRAFT_UTILIZED` |
| **NORMAL_POSITIVE** | Debit transaction | `balance - debit < 0` AND `util >= threshold` AND `Math.abs(balance - debit) <= creditLimit` | **OVERDRAFT_ALERT** | `balance -= debit` (negative) | `OVERDRAFT_UTILIZED` + `OVERDRAFT_THRESHOLD_EXCEEDED` |
| **NORMAL_POSITIVE** | Debit transaction | `balance - debit < -creditLimit` OR `!overdraftEnabled` | **NORMAL_POSITIVE** | Abort / Rollback | `OVERDRAFT_LIMIT_BREACH_REJECTED` |
| **OVERDRAFT_ACTIVE** | Debit transaction | `balance - debit >= -creditLimit` AND `newUtil < threshold` | **OVERDRAFT_ACTIVE** | `balance -= debit` (deepened) | `OVERDRAFT_UTILIZED` |
| **OVERDRAFT_ACTIVE** | Debit transaction | `balance - debit >= -creditLimit` AND `newUtil >= threshold` | **OVERDRAFT_ALERT** | `balance -= debit` | `OVERDRAFT_UTILIZED` + `OVERDRAFT_THRESHOLD_EXCEEDED` |
| **OVERDRAFT_ACTIVE** | Debit transaction | `balance - debit < -creditLimit` | **OVERDRAFT_ACTIVE** | Abort / Rollback | `OVERDRAFT_LIMIT_BREACH_REJECTED` |
| **OVERDRAFT_ACTIVE** | Inbound Credit | `balance + credit < 0` | **OVERDRAFT_ACTIVE** | `balance += credit` (reduced) | `OVERDRAFT_REDUCED` |
| **OVERDRAFT_ACTIVE** | Inbound Credit | `balance + credit >= 0` | **NORMAL_POSITIVE** | `balance += credit` | `OVERDRAFT_CLEARED` |
| **OVERDRAFT_ALERT** | Inbound Credit | `balance + credit < 0` AND `newUtil < threshold` | **OVERDRAFT_ACTIVE** | `balance += credit` | `OVERDRAFT_REDUCED` |
| **OVERDRAFT_ALERT** | Inbound Credit | `balance + credit < 0` AND `newUtil >= threshold` | **OVERDRAFT_ALERT** | `balance += credit` | `OVERDRAFT_REDUCED` |
| **OVERDRAFT_ALERT** | Inbound Credit | `balance + credit >= 0` | **NORMAL_POSITIVE** | `balance += credit` | `OVERDRAFT_CLEARED` |
| **OVERDRAFT_ALERT** | Debit transaction | `balance - debit < -creditLimit` | **OVERDRAFT_ALERT** | Abort / Rollback | `OVERDRAFT_LIMIT_BREACH_REJECTED` |

---

## 5. Error Schemas & Concrete Formats

### 5.1 InsufficientFundsError
When a transaction requests funds beyond available balance + credit limit (or overdraft is disabled):
- **Error Class:** `Error` (matching `/Insufficient funds/`)
- **Format:**
  ```javascript
  `Insufficient funds: account ${account.id} balance is ${account.balance}, creditLimit is ${account.creditLimit}, requested ${requestedAmount}`
  ```
- **Structured Error Payload Representation:**
  ```json
  {
    "name": "InsufficientFundsError",
    "message": "Insufficient funds: account cash_01 balance is -950, creditLimit is 1000, requested 75",
    "code": "INSUFFICIENT_FUNDS",
    "tenantId": "tenant_acme",
    "accountId": "cash_01",
    "currentBalance": -950.0000,
    "creditLimit": 1000.0000,
    "requestedAmount": 75.0000,
    "availablePurchasingPower": 50.0000
  }
  ```

### 5.2 Policy Validation Errors (TypeError)
1. **Invalid creditLimit:**
   - Condition: `creditLimit < 0 || !Number.isFinite(creditLimit)`
   - Error: `new TypeError('creditLimit must be a non-negative finite number')`
2. **Invalid overdraftAlertThreshold:**
   - Condition: `overdraftAlertThreshold < 0 || overdraftAlertThreshold > 1 || !Number.isFinite(overdraftAlertThreshold)`
   - Error: `new TypeError('overdraftAlertThreshold must be a number between 0 and 1')`
3. **Invalid overdraftEnabled:**
   - Condition: `typeof overdraftEnabled !== 'boolean'`
   - Error: `new TypeError('overdraftEnabled must be a boolean')`

---

## 6. Audit Event Shapes & Payloads

### 6.1 Generic Event Interface (TypeScript / JSDoc)
```typescript
interface LedgerAuditEvent {
  id: string;                                // Unique event ID ('evt_' + uuid)
  tenantId: string;                          // Scoped tenant ID
  accountId: string;                         // Target account ID
  transactionId: string;                     // Causing transaction ID (or 'config_' for admin updates)
  type: 'OVERDRAFT_UTILIZED'
      | 'OVERDRAFT_THRESHOLD_EXCEEDED'
      | 'OVERDRAFT_LIMIT_BREACH_REJECTED'
      | 'OVERDRAFT_CLEARED'
      | 'OVERDRAFT_REDUCED'
      | 'OVERDRAFT_CONFIG_UPDATED';
  timestamp: number;                         // Epoch milliseconds (Date.now())
  currentBalance: number;                    // Account balance after transaction/rejection
  creditLimit: number;                       // Configured credit limit
  overdraftUtilized: number;                 // Absolute negative balance: Math.max(0, -currentBalance)
  remainingCredit: number;                   // creditLimit - overdraftUtilized
  details?: Record<string, unknown>;         // Context-specific telemetry
}
```

### 6.2 Concrete Payload Examples

#### 1. `OVERDRAFT_UTILIZED`
Emitted when a transaction draws an account into overdraft or deepens an existing overdraft:
```json
{
  "id": "evt_util_89324701",
  "tenantId": "tenant_acme",
  "accountId": "cash_01",
  "transactionId": "tx_batch_001",
  "type": "OVERDRAFT_UTILIZED",
  "timestamp": 1793088000100,
  "currentBalance": -85.0000,
  "creditLimit": 1000.0000,
  "overdraftUtilized": 85.0000,
  "remainingCredit": 915.0000,
  "details": {
    "priorBalance": 15.0000,
    "delta": -100.0000,
    "utilizationRatio": 0.085
  }
}
```

#### 2. `OVERDRAFT_THRESHOLD_EXCEEDED`
Emitted when overdraft utilization reaches or exceeds `overdraftAlertThreshold`:
```json
{
  "id": "evt_thresh_89324702",
  "tenantId": "tenant_acme",
  "accountId": "cash_01",
  "transactionId": "tx_batch_002",
  "type": "OVERDRAFT_THRESHOLD_EXCEEDED",
  "timestamp": 1793088000200,
  "currentBalance": -850.0000,
  "creditLimit": 1000.0000,
  "overdraftUtilized": 850.0000,
  "remainingCredit": 150.0000,
  "details": {
    "utilizationRatio": 0.85,
    "alertThreshold": 0.80,
    "warning": "Account credit utilization has exceeded configured alert threshold of 80%"
  }
}
```

#### 3. `OVERDRAFT_LIMIT_BREACH_REJECTED`
Emitted when an overdraft transaction is rejected due to credit limit breach:
```json
{
  "id": "evt_breach_89324703",
  "tenantId": "tenant_acme",
  "accountId": "cash_01",
  "transactionId": "tx_batch_003",
  "type": "OVERDRAFT_LIMIT_BREACH_REJECTED",
  "timestamp": 1793088000300,
  "currentBalance": -950.0000,
  "creditLimit": 1000.0000,
  "overdraftUtilized": 950.0000,
  "remainingCredit": 50.0000,
  "details": {
    "requestedAmount": 75.0000,
    "potentialBalance": -1025.0000,
    "excessAmount": 25.0000
  }
}
```

#### 4. `OVERDRAFT_CLEARED`
Emitted when inbound credits eliminate the negative balance entirely:
```json
{
  "id": "evt_clear_89324704",
  "tenantId": "tenant_acme",
  "accountId": "cash_01",
  "transactionId": "tx_topup_001",
  "type": "OVERDRAFT_CLEARED",
  "timestamp": 1793088000400,
  "currentBalance": 2100.0000,
  "creditLimit": 1000.0000,
  "overdraftUtilized": 0.0000,
  "remainingCredit": 1000.0000,
  "details": {
    "priorBalance": -400.0000,
    "clearedDeficit": 400.0000,
    "creditDeposit": 2500.0000
  }
}
```

#### 5. `OVERDRAFT_REDUCED`
Emitted when inbound credits partially pay down the overdraft balance:
```json
{
  "id": "evt_reduc_89324705",
  "tenantId": "tenant_acme",
  "accountId": "cash_01",
  "transactionId": "tx_topup_part",
  "type": "OVERDRAFT_REDUCED",
  "timestamp": 1793088000500,
  "currentBalance": -300.0000,
  "creditLimit": 1000.0000,
  "overdraftUtilized": 300.0000,
  "remainingCredit": 700.0000,
  "details": {
    "priorBalance": -500.0000,
    "repaidPortion": 200.0000
  }
}
```

#### 6. `OVERDRAFT_CONFIG_UPDATED`
Emitted when account policy parameters are updated:
```json
{
  "id": "evt_cfg_89324706",
  "tenantId": "tenant_acme",
  "accountId": "cash_01",
  "transactionId": "config_update_001",
  "type": "OVERDRAFT_CONFIG_UPDATED",
  "timestamp": 1793088000600,
  "currentBalance": 0.0000,
  "creditLimit": 5000.0000,
  "overdraftUtilized": 0.0000,
  "remainingCredit": 5000.0000,
  "details": {
    "previousCreditLimit": 1000.0000,
    "newCreditLimit": 5000.0000,
    "overdraftEnabled": true,
    "overdraftAlertThreshold": 0.85
  }
}
```

---

## 7. Input / Output & Edge-Case Verification Matrix

| Scenario | Input / Precondition | Transaction Payload | Expected Outcome / Balances | Emitted Audit Events | Assertions & Error Checks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-1: Standard Overdraft Transition** | Account bal: `15`, `creditLimit: 1000` | Debit `100` from cash, credit `100` to AP | Account bal: `-85`, AP bal: `100`, Tx status: `'POSTED'` | `OVERDRAFT_UTILIZED` | `remainingCredit === 915`, `tx.overdraftUtilized === true` |
| **TC-2: Deepening Overdraft** | Account bal: `-85`, `creditLimit: 1000` | Debit `50` from cash, credit `50` to AP | Account bal: `-135`, Tx status: `'POSTED'` | `OVERDRAFT_UTILIZED` | `remainingCredit === 865`, `utilization === 0.135` |
| **TC-3: Threshold Breach Trigger** | Account bal: `-750`, `creditLimit: 1000`, threshold `0.8` | Debit `100` from cash, credit `100` to AP | Account bal: `-850` (85% utilization) | `OVERDRAFT_UTILIZED` + `OVERDRAFT_THRESHOLD_EXCEEDED` | Both events present in audit trail with chronological order |
| **TC-4: Exact Boundary Overdraft** | Account bal: `-900`, `creditLimit: 1000` | Debit `100` from cash, credit `100` to AP | Account bal: `-1000.0000`, Tx status: `'POSTED'` | `OVERDRAFT_UTILIZED` + `OVERDRAFT_THRESHOLD_EXCEEDED` | `remainingCredit === 0.0000`, exactly at ceiling |
| **TC-5: Limit Breach Hard Rejection** | Account bal: `-950`, `creditLimit: 1000` | Debit `75` from cash, credit `75` to AP | Transaction throws `/Insufficient funds/`. Balances untouched at `-950` | `OVERDRAFT_LIMIT_BREACH_REJECTED` | Error matches `Insufficient funds: account cash balance is -950, creditLimit is 1000, requested 75`. No tx committed. |
| **TC-6: Overdraft Disabled Rejection** | Account bal: `0`, `creditLimit: 1000`, `overdraftEnabled: false` | Debit `10` from cash, credit `10` to AP | Transaction throws `/Insufficient funds/`. Balances untouched at `0` | `OVERDRAFT_LIMIT_BREACH_REJECTED` | Zero side-effects; rejected because feature flag is false. |
| **TC-7: Full Deficit Clearance** | Account bal: `-400`, `creditLimit: 1000` | Credit `2500` to cash, debit `2500` to AR | Account bal: `+2100.0000`, Tx status: `'POSTED'` | `OVERDRAFT_CLEARED` | `overdraftUtilized === 0`, `remainingCredit === 1000` |
| **TC-8: Partial Deficit Reduction** | Account bal: `-500`, `creditLimit: 1000` | Credit `200` to cash, debit `200` to AR | Account bal: `-300.0000`, Tx status: `'POSTED'` | `OVERDRAFT_REDUCED` | `overdraftUtilized === 300`, `remainingCredit === 700` |
| **TC-9: Idempotency Replay** | Prior Tx posted with key `key_99` | Same Tx posted again with key `key_99` | Returns original cached Tx object | *No duplicate audit events* | Audit log count before replay == count after replay |
| **TC-10: Multi-Tenant Partitioning** | Tenant A bal: `-100`, Tenant B queries audit events | `getAuditEvents('tenant_b')` | Returns only Tenant B events | *N/A* | Zero leakage of Tenant A audit events or account balances |
| **TC-11: Config Validation Errors** | Account creation / update | `creditLimit: -50` | Throws `TypeError('creditLimit must be a non-negative finite number')` | *None* | Account creation fails |
| **TC-12: Threshold Validation Errors** | Account creation / update | `overdraftAlertThreshold: 1.5` | Throws `TypeError('overdraftAlertThreshold must be a number between 0 and 1')` | *None* | Account creation fails |

---

## 8. Downstream Architecture Handoff Notes

### 8.1 For Winston (System Architect)
- **State Store Architecture:** `Ledger` needs an audit event collection (e.g. `this.auditEvents = []` or Map by tenant/account). Query method `getAuditEvents(tenantId, [accountId])` should return cloned records.
- **Pre-flight Evaluation vs Atomic Mutation:** `postTransaction` must conduct pre-flight balance and overdraft limit checks for *all* decreasing accounts before any `applyEntry()` calls. If any account fails, record `OVERDRAFT_LIMIT_BREACH_REJECTED` and throw `Insufficient funds` error immediately without modifying state.
- **Transaction Metadata Enrichment:** When a transaction utilizes overdraft on any account, enrich the returned `txRecord` with `overdraftUtilized: true` and relevant overdraft metadata.

### 8.2 For Amelia (Dev Lead) & Murat (QA Lead)
- Keep existing tests in `test/ledger.test.mjs` green. The existing test `'Ledger: rejects transaction when balance is insufficient and creditLimit is 0'` tests regex `/Insufficient funds/`. The new error format `Insufficient funds: account ${account.id} balance is ${account.balance}, creditLimit is ${account.creditLimit}, requested ${entry.amount}` preserves regex compatibility while satisfying FR-3.

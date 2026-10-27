import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Ledger } from '../src/index.mjs';

// ============================================================================
// Suite 1: Multi-Entry Partial-Failure Atomic Rollback
// ============================================================================
test('QA: Multi-entry partial-failure atomic rollback across distinct accounts', () => {
  const ledger = new Ledger();
  const acc1 = ledger.createAccount({ id: 'acc_asset_1', tenantId: 'tenant_qa', type: 'asset' });
  const acc2 = ledger.createAccount({ id: 'acc_asset_2', tenantId: 'tenant_qa', type: 'asset' });
  const acc3 = ledger.createAccount({ id: 'acc_asset_3', tenantId: 'tenant_qa', type: 'asset', creditLimit: 200 });
  const acc4 = ledger.createAccount({ id: 'acc_asset_4', tenantId: 'tenant_qa', type: 'asset', creditLimit: 50 });

  // Seed initial balances:
  // acc1 = 100, acc2 = 50, acc3 = 50, acc4 = 10
  acc1.applyEntry(100, 'debit');
  acc2.applyEntry(50, 'debit');
  acc3.applyEntry(50, 'debit');
  acc4.applyEntry(10, 'debit');

  const initialAcc1Bal = acc1.balance; // 100
  const initialAcc2Bal = acc2.balance; // 50
  const initialAcc3Bal = acc3.balance; // 50
  const initialAcc4Bal = acc4.balance; // 10

  const initialTxCount = ledger.transactions.size;
  const initialAuditEventsCount = ledger.getAuditEvents('tenant_qa').length;

  // Multi-legged balanced transaction:
  // Leg 1: acc1 debit 100 (bal -> 200) - valid
  // Leg 2: acc2 debit 50 (bal -> 100) - valid
  // Leg 3: acc3 credit 50 (bal -> 0 >= -200) - valid
  // Leg 4: acc4 credit 100 (bal 10 - 100 = -90 < -50 creditLimit) -> BREACH!
  // Sum debits = 150, Sum credits = 150. Balanced!
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_multileg_fail',
        tenantId: 'tenant_qa',
        idempotencyKey: 'idem_multileg_fail_01',
        entries: [
          { accountId: 'acc_asset_1', amount: 100, direction: 'debit' },
          { accountId: 'acc_asset_2', amount: 50, direction: 'debit' },
          { accountId: 'acc_asset_3', amount: 50, direction: 'credit' },
          { accountId: 'acc_asset_4', amount: 100, direction: 'credit' }
        ]
      });
    },
    (err) => {
      assert.match(err.message, /Insufficient funds: account acc_asset_4 balance is 10, creditLimit is 50, requested 100/);
      assert.equal(err.name, 'InsufficientFundsError');
      assert.equal(err.code, 'INSUFFICIENT_FUNDS');
      assert.equal(err.tenantId, 'tenant_qa');
      assert.equal(err.accountId, 'acc_asset_4');
      assert.equal(err.currentBalance, 10);
      assert.equal(err.creditLimit, 50);
      assert.equal(err.requestedAmount, 100);
      return true;
    }
  );

  // Invariant Verification: Zero balance side-effects on all accounts
  assert.equal(acc1.balance, initialAcc1Bal, 'acc1 balance must not be modified');
  assert.equal(acc2.balance, initialAcc2Bal, 'acc2 balance must not be modified');
  assert.equal(acc3.balance, initialAcc3Bal, 'acc3 balance must not be modified');
  assert.equal(acc4.balance, initialAcc4Bal, 'acc4 balance must not be modified');

  // Transaction store & idempotency index must be completely untouched
  assert.equal(ledger.transactions.has('tx_multileg_fail'), false, 'tx must not be committed');
  assert.equal(ledger.transactions.size, initialTxCount);
  assert.equal(ledger.idempotencyIndex.has('tenant_qa:idem_multileg_fail_01'), false, 'idempotency key must not be saved');

  // Exactly one audit event recorded: OVERDRAFT_LIMIT_BREACH_REJECTED for acc4
  const auditEvents = ledger.getAuditEvents('tenant_qa');
  assert.equal(auditEvents.length, initialAuditEventsCount + 1);
  const breachEvent = auditEvents[auditEvents.length - 1];
  assert.equal(breachEvent.type, 'OVERDRAFT_LIMIT_BREACH_REJECTED');
  assert.equal(breachEvent.accountId, 'acc_asset_4');
  assert.equal(breachEvent.currentBalance, 10);
  assert.equal(breachEvent.creditLimit, 50);
  assert.equal(breachEvent.details.requestedAmount, 100);
  assert.equal(breachEvent.details.potentialBalance, -90);
  assert.equal(breachEvent.details.excessAmount, 40);
});

test('QA: Multi-entry cumulative overdraft breach on the same account within a single transaction', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_cumul', tenantId: 'tenant_qa', type: 'asset', creditLimit: 50 });
  const expense1 = ledger.createAccount({ id: 'exp_1', tenantId: 'tenant_qa', type: 'expense' });
  const expense2 = ledger.createAccount({ id: 'exp_2', tenantId: 'tenant_qa', type: 'expense' });

  // Initial cash balance = 10
  cash.applyEntry(10, 'debit');
  assert.equal(cash.balance, 10);

  // Leg 1: expense1 debit 30, cash credit 30 (potential: 10 - 30 = -20 >= -50, alone is valid)
  // Leg 2: expense2 debit 40, cash credit 40 (potential alone: 10 - 40 = -30 >= -50, but cumulative is 10 - 70 = -60 < -50)
  // Total debits = 70, total credits = 70.
  // Must reject atomically due to cumulative breach!
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_cumul_breach',
        tenantId: 'tenant_qa',
        entries: [
          { accountId: 'exp_1', amount: 30, direction: 'debit' },
          { accountId: 'cash_cumul', amount: 30, direction: 'credit' },
          { accountId: 'exp_2', amount: 40, direction: 'debit' },
          { accountId: 'cash_cumul', amount: 40, direction: 'credit' }
        ]
      });
    },
    /Insufficient funds/
  );

  // Invariant: Cash balance must be untouched at 10
  assert.equal(cash.balance, 10, 'Cash balance must not be modified on cumulative breach');
  assert.equal(expense1.balance, 0);
  assert.equal(expense2.balance, 0);
  assert.equal(ledger.transactions.has('tx_cumul_breach'), false);
});

// ============================================================================
// Suite 2: Micro-Currency Floating Point Boundary Tests (0.0001 fractions)
// ============================================================================
test('QA: Micro-currency transaction at 0.0001 precision into overdraft', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_micro', tenantId: 'tenant_qa', type: 'asset', creditLimit: 100 });
  const exp = ledger.createAccount({ id: 'exp_micro', tenantId: 'tenant_qa', type: 'expense' });

  // Single micro-transaction of 0.0001
  const tx = ledger.postTransaction({
    id: 'tx_micro_01',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'exp_micro', amount: 0.0001, direction: 'debit' },
      { accountId: 'cash_micro', amount: 0.0001, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(cash.balance, -0.0001);
  assert.equal(cash.getOverdraftUtilized(), 0.0001);
  assert.equal(cash.getRemainingCredit(), 99.9999);
  assert.equal(exp.balance, 0.0001);

  const events = ledger.getAuditEvents('tenant_qa', 'cash_micro');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OVERDRAFT_UTILIZED');
  assert.equal(events[0].currentBalance, -0.0001);
  assert.equal(events[0].creditLimit, 100);
  assert.equal(events[0].overdraftUtilized, 0.0001);
  assert.equal(events[0].remainingCredit, 99.9999);
  assert.equal(events[0].details.priorBalance, 0);
  assert.equal(events[0].details.delta, -0.0001);
});

test('QA: Exact ceiling boundary and micro-fraction breach beyond ceiling', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_ceil', tenantId: 'tenant_qa', type: 'asset', creditLimit: 500 });
  const exp = ledger.createAccount({ id: 'exp_ceil', tenantId: 'tenant_qa', type: 'expense' });

  // Bring cash to -499.9999
  cash.applyEntry(499.9999, 'credit');
  exp.applyEntry(499.9999, 'debit');
  assert.equal(cash.balance, -499.9999);
  assert.equal(cash.getRemainingCredit(), 0.0001);

  // Case A: Draw exactly 0.0001 to reach exact ceiling of -500.0000
  const tx = ledger.postTransaction({
    id: 'tx_exact_ceiling',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'exp_ceil', amount: 0.0001, direction: 'debit' },
      { accountId: 'cash_ceil', amount: 0.0001, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(cash.balance, -500.0000);
  assert.equal(cash.getRemainingCredit(), 0.0000);
  assert.equal(cash.getOverdraftUtilized(), 500.0000);
  assert.equal(cash.getOverdraftUtilizationRatio(), 1.0000);

  // Case B: Attempt draw of 0.0001 more (breach by 0.0001)
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_micro_breach',
        tenantId: 'tenant_qa',
        entries: [
          { accountId: 'exp_ceil', amount: 0.0001, direction: 'debit' },
          { accountId: 'cash_ceil', amount: 0.0001, direction: 'credit' }
        ]
      });
    },
    (err) => {
      assert.match(err.message, /Insufficient funds: account cash_ceil balance is -500, creditLimit is 500, requested 0.0001/);
      assert.equal(err.currentBalance, -500);
      assert.equal(err.creditLimit, 500);
      assert.equal(err.requestedAmount, 0.0001);
      return true;
    }
  );

  // Cash balance remains at -500.0000
  assert.equal(cash.balance, -500.0000);

  const events = ledger.getAuditEvents('tenant_qa', 'cash_ceil');
  const breachEvent = events.find(e => e.type === 'OVERDRAFT_LIMIT_BREACH_REJECTED');
  assert.ok(breachEvent);
  assert.equal(breachEvent.currentBalance, -500.0000);
  assert.equal(breachEvent.creditLimit, 500.0000);
  assert.equal(breachEvent.details.requestedAmount, 0.0001);
  assert.equal(breachEvent.details.potentialBalance, -500.0001);
  assert.equal(breachEvent.details.excessAmount, 0.0001);
});

test('QA: Sequential micro-transactions accumulate deterministically without IEEE 754 drift', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_drift', tenantId: 'tenant_qa', type: 'asset', creditLimit: 10 });
  const exp = ledger.createAccount({ id: 'exp_drift', tenantId: 'tenant_qa', type: 'expense' });

  // 10 sequential debits of 0.0001
  for (let i = 1; i <= 10; i++) {
    ledger.postTransaction({
      id: `tx_drift_${i}`,
      tenantId: 'tenant_qa',
      entries: [
        { accountId: 'exp_drift', amount: 0.0001, direction: 'debit' },
        { accountId: 'cash_drift', amount: 0.0001, direction: 'credit' }
      ]
    });
  }

  // Exact 0.0010 without floating point tail (like 0.0009999999999999999)
  assert.equal(cash.balance, -0.0010);
  assert.equal(cash.getOverdraftUtilized(), 0.0010);
  assert.equal(cash.getRemainingCredit(), 9.9990);
  assert.equal(exp.balance, 0.0010);
});

// ============================================================================
// Suite 3: Inbound Credit Clearing Exactly to Zero vs Positive Surplus
// ============================================================================
test('QA: Inbound credit clearing overdraft deficit exactly to zero', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_clear_zero', tenantId: 'tenant_qa', type: 'asset', creditLimit: 1000 });
  const rev = ledger.createAccount({ id: 'rev_clear_zero', tenantId: 'tenant_qa', type: 'revenue' });

  // Draw into overdraft of -325.5000
  cash.applyEntry(325.5000, 'credit');
  assert.equal(cash.balance, -325.5000);

  // Deposit exactly 325.5000 to restore balance to 0.0000
  const tx = ledger.postTransaction({
    id: 'tx_clear_exact_zero',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'cash_clear_zero', amount: 325.5000, direction: 'debit' },
      { accountId: 'rev_clear_zero', amount: 325.5000, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(tx.overdraftUtilized, undefined, 'Clearing tx must not set overdraftUtilized');
  assert.equal(cash.balance, 0.0000);
  assert.equal(cash.getOverdraftUtilized(), 0.0000);
  assert.equal(cash.getRemainingCredit(), 1000.0000);
  assert.equal(cash.getOverdraftUtilizationRatio(), 0.0000);

  const events = ledger.getAuditEvents('tenant_qa', 'cash_clear_zero');
  assert.equal(events.length, 1);
  const clearEvent = events[0];
  assert.equal(clearEvent.type, 'OVERDRAFT_CLEARED');
  assert.equal(clearEvent.currentBalance, 0.0000);
  assert.equal(clearEvent.creditLimit, 1000.0000);
  assert.equal(clearEvent.overdraftUtilized, 0.0000);
  assert.equal(clearEvent.remainingCredit, 1000.0000);
  assert.equal(clearEvent.details.priorBalance, -325.5000);
  assert.equal(clearEvent.details.clearedDeficit, 325.5000);
  assert.equal(clearEvent.details.creditDeposit, 325.5000);
});

test('QA: Inbound credit clearing overdraft deficit with positive surplus', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_surplus', tenantId: 'tenant_qa', type: 'asset', creditLimit: 1000 });
  const rev = ledger.createAccount({ id: 'rev_surplus', tenantId: 'tenant_qa', type: 'revenue' });

  // Draw into overdraft of -325.5000
  cash.applyEntry(325.5000, 'credit');
  assert.equal(cash.balance, -325.5000);

  // Deposit 500.0000 -> new balance +174.5000 (surplus)
  const tx = ledger.postTransaction({
    id: 'tx_clear_surplus',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'cash_surplus', amount: 500.0000, direction: 'debit' },
      { accountId: 'rev_surplus', amount: 500.0000, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(tx.overdraftUtilized, undefined, 'Clearing tx must not set overdraftUtilized');
  assert.equal(cash.balance, 174.5000);
  assert.equal(cash.getOverdraftUtilized(), 0.0000);
  assert.equal(cash.getRemainingCredit(), 1000.0000);
  assert.equal(cash.getOverdraftUtilizationRatio(), 0.0000);

  const events = ledger.getAuditEvents('tenant_qa', 'cash_surplus');
  assert.equal(events.length, 1);
  const clearEvent = events[0];
  assert.equal(clearEvent.type, 'OVERDRAFT_CLEARED');
  assert.equal(clearEvent.currentBalance, 174.5000);
  assert.equal(clearEvent.creditLimit, 1000.0000);
  assert.equal(clearEvent.overdraftUtilized, 0.0000);
  assert.equal(clearEvent.remainingCredit, 1000.0000);
  assert.equal(clearEvent.details.priorBalance, -325.5000);
  assert.equal(clearEvent.details.clearedDeficit, 325.5000);
  assert.equal(clearEvent.details.creditDeposit, 500.0000);
});

test('QA: Inbound credit to an already positive account does not emit overdraft events', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_pos', tenantId: 'tenant_qa', type: 'asset', creditLimit: 1000 });
  const rev = ledger.createAccount({ id: 'rev_pos', tenantId: 'tenant_qa', type: 'revenue' });

  // Initial balance 100
  cash.applyEntry(100, 'debit');

  // Additional deposit 50
  ledger.postTransaction({
    id: 'tx_pos_deposit',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'cash_pos', amount: 50, direction: 'debit' },
      { accountId: 'rev_pos', amount: 50, direction: 'credit' }
    ]
  });

  assert.equal(cash.balance, 150);
  const events = ledger.getAuditEvents('tenant_qa', 'cash_pos');
  assert.equal(events.length, 0, 'No overdraft events should be emitted for non-overdrawn transitions');
});

// ============================================================================
// Suite 4: Defensive Cloning & Audit Immutability
// ============================================================================
test('QA: Modifying returned auditEvents array or event objects does not mutate internal ledger audit log', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash_sec', tenantId: 'tenant_qa', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'exp_sec', tenantId: 'tenant_qa', type: 'expense' });

  ledger.postTransaction({
    id: 'tx_sec_01',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'exp_sec', amount: 150, direction: 'debit' },
      { accountId: 'cash_sec', amount: 150, direction: 'credit' }
    ]
  });

  const events1 = ledger.getAuditEvents('tenant_qa', 'cash_sec');
  assert.equal(events1.length, 1);

  // Attack 1: Modify returned array directly
  events1.push({ type: 'INJECTED_EVENT', id: 'fake_01' });
  events1.length = 0;

  const events2 = ledger.getAuditEvents('tenant_qa', 'cash_sec');
  assert.equal(events2.length, 1, 'Internal audit log length must be unaffected by array mutations');
  assert.equal(events2[0].type, 'OVERDRAFT_UTILIZED');

  // Attack 2: Mutate properties of the returned event object
  events2[0].type = 'CORRUPTED';
  events2[0].currentBalance = 999999;
  events2[0].creditLimit = 0;
  events2[0].details.priorBalance = 888888;
  events2[0].details.injected = true;

  const events3 = ledger.getAuditEvents('tenant_qa', 'cash_sec');
  assert.equal(events3[0].type, 'OVERDRAFT_UTILIZED', 'Internal event type must remain OVERDRAFT_UTILIZED');
  assert.equal(events3[0].currentBalance, -150);
  assert.equal(events3[0].creditLimit, 1000);
  assert.equal(events3[0].details.priorBalance, 0);
  assert.equal(events3[0].details.injected, undefined);

  // Attack 3: Mutate event returned from updateAccountPolicy
  const configEvent = ledger.updateAccountPolicy('tenant_qa', 'cash_sec', { creditLimit: 2000 });
  configEvent.type = 'HACKED_CONFIG';
  configEvent.details.newCreditLimit = 999999;

  const eventsAfterConfig = ledger.getAuditEvents('tenant_qa', 'cash_sec');
  const storedConfigEvent = eventsAfterConfig.find(e => e.type === 'OVERDRAFT_CONFIG_UPDATED');
  assert.ok(storedConfigEvent, 'Stored config event must preserve OVERDRAFT_CONFIG_UPDATED type');
  assert.equal(storedConfigEvent.details.newCreditLimit, 2000, 'Stored config event must preserve original newCreditLimit');
});

// ============================================================================
// Suite 5: Stress Audit & updatePolicy Edge Cases
// ============================================================================
test('QA: Attempting to decrease creditLimit below current overdraft balance is rejected', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_policy', tenantId: 'tenant_qa', type: 'asset', creditLimit: 1000 });
  const exp = ledger.createAccount({ id: 'exp_policy', tenantId: 'tenant_qa', type: 'expense' });

  // Draw cash into overdraft of -400.0000
  ledger.postTransaction({
    id: 'tx_pol_01',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'exp_policy', amount: 400, direction: 'debit' },
      { accountId: 'cash_policy', amount: 400, direction: 'credit' }
    ]
  });

  assert.equal(cash.balance, -400);
  assert.equal(cash.getOverdraftUtilized(), 400);

  const auditEventsBefore = ledger.getAuditEvents('tenant_qa').length;

  // Case A: Attempt to reduce creditLimit to 300 (< 400 current overdraft)
  // Must throw and reject the change
  assert.throws(
    () => {
      ledger.updateAccountPolicy('tenant_qa', 'cash_policy', { creditLimit: 300 });
    },
    (err) => {
      assert.match(err.message, /Cannot decrease creditLimit.*400/);
      return true;
    }
  );

  // Invariant check: creditLimit must remain 1000, no config audit event recorded
  assert.equal(cash.creditLimit, 1000, 'creditLimit must not be modified on rejected policy update');
  const auditEventsAfter = ledger.getAuditEvents('tenant_qa').length;
  assert.equal(auditEventsAfter, auditEventsBefore, 'No audit event should be emitted on failed policy update');

  // Case B: Direct Account.updatePolicy call also rejects
  assert.throws(
    () => {
      cash.updatePolicy({ creditLimit: 250 });
    },
    /Cannot decrease creditLimit/
  );
  assert.equal(cash.creditLimit, 1000);

  // Case C: Attempt to disable overdraft while balance is negative
  assert.throws(
    () => {
      ledger.updateAccountPolicy('tenant_qa', 'cash_policy', { overdraftEnabled: false });
    },
    /Cannot disable overdraft while account has an outstanding overdraft balance/
  );
  assert.equal(cash.overdraftEnabled, true, 'overdraftEnabled must remain true');

  // Case D: Decreasing creditLimit exactly to current overdraft balance (400) is allowed
  const validEvent = ledger.updateAccountPolicy('tenant_qa', 'cash_policy', { creditLimit: 400 });
  assert.equal(cash.creditLimit, 400);
  assert.equal(cash.getRemainingCredit(), 0);
  assert.equal(validEvent.type, 'OVERDRAFT_CONFIG_UPDATED');
  assert.equal(validEvent.details.newCreditLimit, 400);
});

test('QA: updatePolicy parameter validation is atomic and leaves account untouched on failure', () => {
  const account = new Account({
    id: 'acc_atomic',
    tenantId: 'tenant_qa',
    type: 'asset',
    creditLimit: 1000,
    overdraftAlertThreshold: 0.8
  });

  // Valid creditLimit (2000), but invalid overdraftAlertThreshold (1.5)
  assert.throws(
    () => {
      account.updatePolicy({ creditLimit: 2000, overdraftAlertThreshold: 1.5 });
    },
    TypeError
  );

  // Neither creditLimit nor threshold must have been updated
  assert.equal(account.creditLimit, 1000, 'creditLimit must not be partially mutated on failure');
  assert.equal(account.overdraftAlertThreshold, 0.8, 'overdraftAlertThreshold must remain 0.8');

  // Invalid creditLimit type
  assert.throws(() => account.updatePolicy({ creditLimit: -10 }), TypeError);
  assert.throws(() => account.updatePolicy({ creditLimit: NaN }), TypeError);
  assert.throws(() => account.updatePolicy({ creditLimit: Infinity }), TypeError);
  assert.throws(() => account.updatePolicy({ creditLimit: '500' }), TypeError);

  // Invalid overdraftEnabled type
  assert.throws(() => account.updatePolicy({ overdraftEnabled: 'true' }), TypeError);
  assert.throws(() => account.updatePolicy({ overdraftEnabled: 1 }), TypeError);

  // Invalid overdraftAlertThreshold range & type
  assert.throws(() => account.updatePolicy({ overdraftAlertThreshold: -0.1 }), TypeError);
  assert.throws(() => account.updatePolicy({ overdraftAlertThreshold: 1.1 }), TypeError);
  assert.throws(() => account.updatePolicy({ overdraftAlertThreshold: NaN }), TypeError);
});

test('QA: Credit-normal account (liability) supports overdraft and enforces hard ceiling', () => {
  const ledger = new Ledger();
  // Liability account: credits increase balance, debits decrease balance
  const liability = ledger.createAccount({ id: 'liab_01', tenantId: 'tenant_qa', type: 'liability', creditLimit: 200 });
  const revenue = ledger.createAccount({ id: 'rev_01', tenantId: 'tenant_qa', type: 'revenue' });

  // Debit 150 from liability (draws into -150 overdraft), credit 150 to revenue (revenue increases)
  const tx = ledger.postTransaction({
    id: 'tx_liab_overdraft',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'liab_01', amount: 150, direction: 'debit' },
      { accountId: 'rev_01', amount: 150, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(liability.balance, -150);
  assert.equal(liability.getOverdraftUtilized(), 150);
  assert.equal(liability.getRemainingCredit(), 50);

  const events = ledger.getAuditEvents('tenant_qa', 'liab_01');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OVERDRAFT_UTILIZED');
  assert.equal(events[0].currentBalance, -150);

  // Attempt to draw 60 more (potential -210 < -200 limit) -> reject!
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_liab_breach',
        tenantId: 'tenant_qa',
        entries: [
          { accountId: 'liab_01', amount: 60, direction: 'debit' },
          { accountId: 'rev_01', amount: 60, direction: 'credit' }
        ]
      });
    },
    /Insufficient funds/
  );

  assert.equal(liability.balance, -150, 'Liability balance must remain -150 after breach');
});

test('QA: Double-entry zero-sum tolerance boundary (0.0001 pass vs 0.0002 fail)', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash_zs', tenantId: 'tenant_qa', type: 'asset' });
  ledger.createAccount({ id: 'rev_zs', tenantId: 'tenant_qa', type: 'revenue' });

  // Exact 4-decimal balance passes
  const txPass = ledger.postTransaction({
    id: 'tx_zs_pass',
    tenantId: 'tenant_qa',
    entries: [
      { accountId: 'cash_zs', amount: 100.0001, direction: 'debit' },
      { accountId: 'rev_zs', amount: 100.0001, direction: 'credit' }
    ]
  });
  assert.equal(txPass.status, 'POSTED');

  // Difference of 0.0001 violates exact zero-sum balance and must fail
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_zs_fail_1',
        tenantId: 'tenant_qa',
        entries: [
          { accountId: 'cash_zs', amount: 100.0001, direction: 'debit' },
          { accountId: 'rev_zs', amount: 100.0000, direction: 'credit' }
        ]
      });
    },
    /Unbalanced transaction/
  );

  // Difference of 0.0002 exceeds tolerance and must fail
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_zs_fail_2',
        tenantId: 'tenant_qa',
        entries: [
          { accountId: 'cash_zs', amount: 100.0002, direction: 'debit' },
          { accountId: 'rev_zs', amount: 100.0000, direction: 'credit' }
        ]
      });
    },
    /Unbalanced transaction/
  );
});

test('QA: updatePolicy allows disabling overdraft when balance is non-negative', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_disable_ok', tenantId: 'tenant_qa', type: 'asset', creditLimit: 500 });
  assert.equal(cash.overdraftEnabled, true);

  // Initial balance is 0 (non-negative)
  const event = ledger.updateAccountPolicy('tenant_qa', 'cash_disable_ok', { overdraftEnabled: false });
  assert.equal(cash.overdraftEnabled, false);
  assert.equal(event.type, 'OVERDRAFT_CONFIG_UPDATED');
  assert.equal(event.details.overdraftEnabled, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Ledger } from '../src/index.mjs';

test('AC1: Account Overdraft Policy Configuration - defaults and policy initialization', () => {
  // Default values when creditLimit is 0
  const defaultAcc = new Account({ id: 'acc_def', tenantId: 'tenant_acme', type: 'asset' });
  assert.equal(defaultAcc.creditLimit, 0);
  assert.equal(defaultAcc.overdraftEnabled, false);
  assert.equal(defaultAcc.overdraftAlertThreshold, 0.8);
  assert.equal(defaultAcc.getOverdraftUtilized(), 0);
  assert.equal(defaultAcc.getRemainingCredit(), 0);
  assert.equal(defaultAcc.getOverdraftUtilizationRatio(), 0);
  assert.equal(defaultAcc.getAvailablePurchasingPower(), 0);

  // When creditLimit > 0, overdraftEnabled defaults to true
  const creditAcc = new Account({ id: 'acc_credit', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  assert.equal(creditAcc.creditLimit, 1000);
  assert.equal(creditAcc.overdraftEnabled, true);
  assert.equal(creditAcc.overdraftAlertThreshold, 0.8);
  assert.equal(creditAcc.getRemainingCredit(), 1000);
  assert.equal(creditAcc.getAvailablePurchasingPower(), 1000);

  // Explicit overdraftEnabled = false overrides default
  const disabledAcc = new Account({
    id: 'acc_disabled',
    tenantId: 'tenant_acme',
    type: 'asset',
    creditLimit: 500,
    overdraftEnabled: false,
    overdraftAlertThreshold: 0.5
  });
  assert.equal(disabledAcc.creditLimit, 500);
  assert.equal(disabledAcc.overdraftEnabled, false);
  assert.equal(disabledAcc.overdraftAlertThreshold, 0.5);
  assert.equal(disabledAcc.getRemainingCredit(), 0);
  assert.equal(disabledAcc.getAvailablePurchasingPower(), 0);
});

test('AC1: Account Overdraft Policy Configuration - parameter validation', () => {
  // Negative creditLimit
  assert.throws(
    () => new Account({ id: 'acc_err', tenantId: 'tenant_acme', type: 'asset', creditLimit: -50 }),
    new TypeError('creditLimit must be a non-negative finite number')
  );

  // Non-finite creditLimit
  assert.throws(
    () => new Account({ id: 'acc_err', tenantId: 'tenant_acme', type: 'asset', creditLimit: Infinity }),
    new TypeError('creditLimit must be a non-negative finite number')
  );

  // Invalid overdraftAlertThreshold (< 0 or > 1)
  assert.throws(
    () => new Account({ id: 'acc_err', tenantId: 'tenant_acme', type: 'asset', overdraftAlertThreshold: -0.1 }),
    new TypeError('overdraftAlertThreshold must be a number between 0 and 1')
  );
  assert.throws(
    () => new Account({ id: 'acc_err', tenantId: 'tenant_acme', type: 'asset', overdraftAlertThreshold: 1.5 }),
    new TypeError('overdraftAlertThreshold must be a number between 0 and 1')
  );

  // Non-boolean overdraftEnabled
  assert.throws(
    () => new Account({ id: 'acc_err', tenantId: 'tenant_acme', type: 'asset', overdraftEnabled: 'true' }),
    new TypeError('overdraftEnabled must be a boolean')
  );
});

test('AC1: Account Policy modification records OVERDRAFT_CONFIG_UPDATED audit event', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });

  const event = ledger.updateAccountPolicy('tenant_acme', 'cash_01', {
    creditLimit: 5000,
    overdraftAlertThreshold: 0.85
  });

  assert.equal(event.type, 'OVERDRAFT_CONFIG_UPDATED');
  assert.equal(event.details.previousCreditLimit, 1000);
  assert.equal(event.details.newCreditLimit, 5000);
  assert.equal(event.details.overdraftAlertThreshold, 0.85);

  const account = ledger.getAccount('tenant_acme', 'cash_01');
  assert.equal(account.creditLimit, 5000);
  assert.equal(account.overdraftAlertThreshold, 0.85);
});

test('AC2: Dynamic Zero-Balance Overdraft Execution (TC-1: Standard Overdraft Transition)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  const expense = ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  // Initial cash deposit: 15
  cash.applyEntry(15, 'debit');
  assert.equal(cash.balance, 15);

  // Debit 100 to expense, credit 100 from cash
  const tx = ledger.postTransaction({
    id: 'tx_batch_001',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'expense_01', amount: 100, direction: 'debit' },
      { accountId: 'cash_01', amount: 100, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(tx.overdraftUtilized, true);
  assert.equal(tx.overdraftAmount, 85);
  assert.equal(tx.remainingCredit, 915);

  assert.equal(cash.balance, -85);
  assert.equal(cash.getOverdraftUtilized(), 85);
  assert.equal(cash.getRemainingCredit(), 915);
  assert.equal(cash.getOverdraftUtilizationRatio(), 0.085);
  assert.equal(expense.balance, 100);

  const events = ledger.getAuditEvents('tenant_acme', 'cash_01');
  const utilEvent = events.find(e => e.type === 'OVERDRAFT_UTILIZED');
  assert.ok(utilEvent);
  assert.equal(utilEvent.currentBalance, -85);
  assert.equal(utilEvent.creditLimit, 1000);
  assert.equal(utilEvent.overdraftUtilized, 85);
  assert.equal(utilEvent.remainingCredit, 915);
  assert.equal(utilEvent.details.priorBalance, 15);
  assert.equal(utilEvent.details.delta, -100);
  assert.equal(utilEvent.details.utilizationRatio, 0.085);
});

test('AC2: Dynamic Zero-Balance Overdraft Execution (TC-2: Deepening Overdraft)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  const expense = ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  // Start with cash at -85
  cash.applyEntry(85, 'credit');
  assert.equal(cash.balance, -85);

  // Debit 50 to expense, credit 50 from cash
  const tx = ledger.postTransaction({
    id: 'tx_batch_002',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'expense_01', amount: 50, direction: 'debit' },
      { accountId: 'cash_01', amount: 50, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(tx.overdraftUtilized, true);
  assert.equal(tx.overdraftAmount, 135);
  assert.equal(tx.remainingCredit, 865);
  assert.equal(cash.balance, -135);
  assert.equal(cash.getRemainingCredit(), 865);
  assert.equal(cash.getOverdraftUtilizationRatio(), 0.135);

  const events = ledger.getAuditEvents('tenant_acme', 'cash_01');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OVERDRAFT_UTILIZED');
  assert.equal(events[0].details.priorBalance, -85);
  assert.equal(events[0].details.delta, -50);
  assert.equal(events[0].details.utilizationRatio, 0.135);
});

test('AC3: Credit Limit Hard Cap Enforcement & Zero-Side-Effect Rollback (TC-5)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  const expense = ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  // Set initial balances: cash = -950, expense = 950
  cash.applyEntry(950, 'credit');
  expense.applyEntry(950, 'debit');
  assert.equal(cash.balance, -950);
  assert.equal(expense.balance, 950);

  // Request credit 75 from cash (potentialBalance = -1025, creditLimit = 1000 -> breach)
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_batch_003',
        tenantId: 'tenant_acme',
        idempotencyKey: 'idem_breach_001',
        entries: [
          { accountId: 'expense_01', amount: 75, direction: 'debit' },
          { accountId: 'cash_01', amount: 75, direction: 'credit' }
        ]
      });
    },
    (err) => {
      assert.match(err.message, /Insufficient funds: account cash_01 balance is -950, creditLimit is 1000, requested 75/);
      assert.equal(err.name, 'InsufficientFundsError');
      assert.equal(err.code, 'INSUFFICIENT_FUNDS');
      assert.equal(err.tenantId, 'tenant_acme');
      assert.equal(err.accountId, 'cash_01');
      assert.equal(err.currentBalance, -950);
      assert.equal(err.creditLimit, 1000);
      assert.equal(err.requestedAmount, 75);
      return true;
    }
  );

  // Invariant: Zero side-effects on all accounts and state stores
  assert.equal(cash.balance, -950);
  assert.equal(expense.balance, 950);
  assert.equal(ledger.transactions.has('tx_batch_003'), false);
  assert.equal(ledger.idempotencyIndex.has('tenant_acme:idem_breach_001'), false);

  // Audit event recorded for rejection
  const events = ledger.getAuditEvents('tenant_acme', 'cash_01');
  assert.equal(events.length, 1);
  const rejectEvent = events[0];
  assert.equal(rejectEvent.type, 'OVERDRAFT_LIMIT_BREACH_REJECTED');
  assert.equal(rejectEvent.currentBalance, -950);
  assert.equal(rejectEvent.creditLimit, 1000);
  assert.equal(rejectEvent.details.requestedAmount, 75);
  assert.equal(rejectEvent.details.potentialBalance, -1025);
  assert.equal(rejectEvent.details.excessAmount, 25);
});

test('AC3: Credit Limit Hard Cap Enforcement - overdraft disabled rejection (TC-6)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({
    id: 'cash_disabled',
    tenantId: 'tenant_acme',
    type: 'asset',
    creditLimit: 1000,
    overdraftEnabled: false
  });
  ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_disabled_test',
        tenantId: 'tenant_acme',
        entries: [
          { accountId: 'expense_01', amount: 10, direction: 'debit' },
          { accountId: 'cash_disabled', amount: 10, direction: 'credit' }
        ]
      });
    },
    /Insufficient funds/
  );

  assert.equal(cash.balance, 0);
  const events = ledger.getAuditEvents('tenant_acme', 'cash_disabled');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OVERDRAFT_LIMIT_BREACH_REJECTED');
});

test('AC3: Exact Boundary Overdraft (TC-4)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  const expense = ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  cash.applyEntry(900, 'credit');
  assert.equal(cash.balance, -900);

  // Credit exactly 100 from cash to reach -1000 (creditLimit)
  const tx = ledger.postTransaction({
    id: 'tx_exact_cap',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'expense_01', amount: 100, direction: 'debit' },
      { accountId: 'cash_01', amount: 100, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(cash.balance, -1000);
  assert.equal(cash.getRemainingCredit(), 0);
  assert.equal(cash.getOverdraftUtilizationRatio(), 1.0);
});

test('AC4: Overdraft Alert Threshold Triggers (TC-3: Threshold Breach Trigger)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({
    id: 'cash_01',
    tenantId: 'tenant_acme',
    type: 'asset',
    creditLimit: 1000,
    overdraftAlertThreshold: 0.8
  });
  const expense = ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  // Credit 850 from cash -> utilization = 85% >= 80% threshold
  const tx = ledger.postTransaction({
    id: 'tx_thresh_001',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'expense_01', amount: 850, direction: 'debit' },
      { accountId: 'cash_01', amount: 850, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(cash.balance, -850);

  const events = ledger.getAuditEvents('tenant_acme', 'cash_01');
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'OVERDRAFT_UTILIZED');
  assert.equal(events[1].type, 'OVERDRAFT_THRESHOLD_EXCEEDED');

  const threshEvent = events[1];
  assert.equal(threshEvent.currentBalance, -850);
  assert.equal(threshEvent.creditLimit, 1000);
  assert.equal(threshEvent.overdraftUtilized, 850);
  assert.equal(threshEvent.remainingCredit, 150);
  assert.equal(threshEvent.details.utilizationRatio, 0.85);
  assert.equal(threshEvent.details.alertThreshold, 0.8);
  assert.match(threshEvent.details.warning, /85\.0%/);
});

test('AC5: Inbound Settlement & Overdraft Deficit Clearance (TC-7: Full Clearance)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  const revenue = ledger.createAccount({ id: 'revenue_01', tenantId: 'tenant_acme', type: 'revenue' });

  // Set negative balance -400
  cash.applyEntry(400, 'credit');
  assert.equal(cash.balance, -400);

  // Debit 2500 to cash, credit 2500 to revenue (deposit clears deficit)
  const tx = ledger.postTransaction({
    id: 'tx_topup_001',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'cash_01', amount: 2500, direction: 'debit' },
      { accountId: 'revenue_01', amount: 2500, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(cash.balance, 2100);
  assert.equal(cash.getOverdraftUtilized(), 0);
  assert.equal(cash.getRemainingCredit(), 1000);

  const events = ledger.getAuditEvents('tenant_acme', 'cash_01');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OVERDRAFT_CLEARED');
  assert.equal(events[0].currentBalance, 2100);
  assert.equal(events[0].creditLimit, 1000);
  assert.equal(events[0].overdraftUtilized, 0);
  assert.equal(events[0].remainingCredit, 1000);
  assert.equal(events[0].details.priorBalance, -400);
  assert.equal(events[0].details.clearedDeficit, 400);
  assert.equal(events[0].details.creditDeposit, 2500);
});

test('AC5: Inbound Settlement & Overdraft Deficit Reduction (TC-8: Partial Reduction)', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  const revenue = ledger.createAccount({ id: 'revenue_01', tenantId: 'tenant_acme', type: 'revenue' });

  // Set negative balance -500
  cash.applyEntry(500, 'credit');
  assert.equal(cash.balance, -500);

  // Debit 200 to cash, credit 200 to revenue (partial repayment -> new balance -300)
  const tx = ledger.postTransaction({
    id: 'tx_topup_part',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'cash_01', amount: 200, direction: 'debit' },
      { accountId: 'revenue_01', amount: 200, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(cash.balance, -300);
  assert.equal(cash.getOverdraftUtilized(), 300);
  assert.equal(cash.getRemainingCredit(), 700);

  const events = ledger.getAuditEvents('tenant_acme', 'cash_01');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OVERDRAFT_REDUCED');
  assert.equal(events[0].currentBalance, -300);
  assert.equal(events[0].creditLimit, 1000);
  assert.equal(events[0].overdraftUtilized, 300);
  assert.equal(events[0].remainingCredit, 700);
  assert.equal(events[0].details.priorBalance, -500);
  assert.equal(events[0].details.repaidPortion, 200);
});

test('AC6: Audit Trail Immutability, Defensive Cloning, and Query Filtering', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'cash_02', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  // Missing tenantId throws TypeError
  assert.throws(() => ledger.getAuditEvents(), TypeError);
  assert.throws(() => ledger.getAuditEvents(''), TypeError);

  ledger.postTransaction({
    id: 'tx_multi_01',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'expense_01', amount: 100, direction: 'debit' },
      { accountId: 'cash_01', amount: 100, direction: 'credit' }
    ]
  });

  ledger.postTransaction({
    id: 'tx_multi_02',
    tenantId: 'tenant_acme',
    entries: [
      { accountId: 'expense_01', amount: 200, direction: 'debit' },
      { accountId: 'cash_02', amount: 200, direction: 'credit' }
    ]
  });

  // Query all for tenant
  const allEvents = ledger.getAuditEvents('tenant_acme');
  assert.equal(allEvents.length, 2);

  // Filter by account
  const cash1Events = ledger.getAuditEvents('tenant_acme', 'cash_01');
  assert.equal(cash1Events.length, 1);
  assert.equal(cash1Events[0].accountId, 'cash_01');

  // Immutability: modifying returned clone does not affect ledger state
  cash1Events[0].details.priorBalance = 999999;
  cash1Events[0].type = 'TAMPERED';
  const freshEvents = ledger.getAuditEvents('tenant_acme', 'cash_01');
  assert.equal(freshEvents[0].type, 'OVERDRAFT_UTILIZED');
  assert.notEqual(freshEvents[0].details.priorBalance, 999999);
});

test('AC6: Multi-Tenant Boundary Isolation (TC-10)', () => {
  const ledger = new Ledger();
  // Tenant A operations
  ledger.createAccount({ id: 'cash_a', tenantId: 'tenant_a', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'expense_a', tenantId: 'tenant_a', type: 'expense' });
  ledger.postTransaction({
    id: 'tx_a_01',
    tenantId: 'tenant_a',
    entries: [
      { accountId: 'expense_a', amount: 200, direction: 'debit' },
      { accountId: 'cash_a', amount: 200, direction: 'credit' }
    ]
  });

  // Tenant B queries audit events
  ledger.createAccount({ id: 'cash_b', tenantId: 'tenant_b', type: 'asset', creditLimit: 500 });
  const tenantBEvents = ledger.getAuditEvents('tenant_b');
  assert.equal(tenantBEvents.length, 0);

  // Tenant B cannot see or query Tenant A account
  assert.equal(ledger.getAccount('tenant_b', 'cash_a'), null);
});

test('AC6: Idempotency Replay Protection (TC-9: Idempotency Replay Determinism & Audit Silence)', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'expense_01', tenantId: 'tenant_acme', type: 'expense' });

  const tx1 = ledger.postTransaction({
    id: 'tx_idem_overdraft',
    tenantId: 'tenant_acme',
    idempotencyKey: 'idem_key_replay_001',
    entries: [
      { accountId: 'expense_01', amount: 150, direction: 'debit' },
      { accountId: 'cash_01', amount: 150, direction: 'credit' }
    ]
  });

  assert.equal(tx1.status, 'POSTED');
  assert.equal(ledger.getAccount('tenant_acme', 'cash_01').balance, -150);

  const auditEventsBeforeReplay = ledger.getAuditEvents('tenant_acme');
  assert.equal(auditEventsBeforeReplay.length, 1);

  // Replay identical transaction with same idempotencyKey
  const tx2 = ledger.postTransaction({
    id: 'tx_idem_overdraft',
    tenantId: 'tenant_acme',
    idempotencyKey: 'idem_key_replay_001',
    entries: [
      { accountId: 'expense_01', amount: 150, direction: 'debit' },
      { accountId: 'cash_01', amount: 150, direction: 'credit' }
    ]
  });

  // Returns original cached transaction
  assert.equal(tx2.id, 'tx_idem_overdraft');
  // Account balance not debited again
  assert.equal(ledger.getAccount('tenant_acme', 'cash_01').balance, -150);

  // Zero additional audit events emitted
  const auditEventsAfterReplay = ledger.getAuditEvents('tenant_acme');
  assert.equal(auditEventsAfterReplay.length, auditEventsBeforeReplay.length);

  // Replay with different tx id must throw IdempotencyConflictError (DEFECT-IRONCLAD-014)
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_idem_replay_call',
        tenantId: 'tenant_acme',
        idempotencyKey: 'idem_key_replay_001',
        entries: [
          { accountId: 'expense_01', amount: 150, direction: 'debit' },
          { accountId: 'cash_01', amount: 150, direction: 'credit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );
});

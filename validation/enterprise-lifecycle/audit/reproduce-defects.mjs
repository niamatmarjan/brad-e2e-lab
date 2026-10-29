import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Ledger } from '../src/index.mjs';

// ============================================================================
// DEFECT-IRONCLAD-001: Global Transaction Store Overwrite & Cross-Tenant Leakage
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-001 - Cross-tenant transaction overwrite and replay data leak', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc_a', tenantId: 'tenant_a', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'exp_a', tenantId: 'tenant_a', type: 'expense' });
  ledger.createAccount({ id: 'acc_b', tenantId: 'tenant_b', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'exp_b', tenantId: 'tenant_b', type: 'expense' });

  // Tenant A posts transaction 'tx_shared_01'
  ledger.postTransaction({
    id: 'tx_shared_01',
    tenantId: 'tenant_a',
    idempotencyKey: 'idem_a_01',
    entries: [
      { accountId: 'acc_a', amount: 100, direction: 'credit' },
      { accountId: 'exp_a', amount: 100, direction: 'debit' }
    ]
  });

  // Tenant B posts transaction with the same id 'tx_shared_01'
  ledger.postTransaction({
    id: 'tx_shared_01',
    tenantId: 'tenant_b',
    entries: [
      { accountId: 'acc_b', amount: 250, direction: 'credit' },
      { accountId: 'exp_b', amount: 250, direction: 'debit' }
    ]
  });

  // Tenant A replays idem_a_01
  const replayed = ledger.postTransaction({
    id: 'tx_shared_01',
    tenantId: 'tenant_a',
    idempotencyKey: 'idem_a_01',
    entries: [
      { accountId: 'acc_a', amount: 100, direction: 'credit' },
      { accountId: 'exp_a', amount: 100, direction: 'debit' }
    ]
  });

  // DEFECT CONFIRMED: Tenant A receives Tenant B's transaction!
  assert.equal(replayed.tenantId, 'tenant_b', 'Tenant A received Tenant B private data');
  assert.equal(replayed.entries[0].accountId, 'acc_b');
  assert.equal(replayed.entries[0].amount, 250);
});

// ============================================================================
// DEFECT-IRONCLAD-002: Missing Conflicting Payload Detection on Idempotency Replay
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-002 - Replay with conflicting payload silently accepted', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'exp', tenantId: 't1', type: 'expense' });

  const original = ledger.postTransaction({
    id: 'tx_orig',
    tenantId: 't1',
    idempotencyKey: 'key_reused',
    entries: [
      { accountId: 'cash', amount: 50, direction: 'credit' },
      { accountId: 'exp', amount: 50, direction: 'debit' }
    ]
  });

  // Replay with DIFFERENT transaction ID and DIFFERENT amount (9999 vs 50)
  const conflicting = ledger.postTransaction({
    id: 'tx_different',
    tenantId: 't1',
    idempotencyKey: 'key_reused',
    entries: [
      { accountId: 'cash', amount: 9999, direction: 'credit' },
      { accountId: 'exp', amount: 9999, direction: 'debit' }
    ]
  });

  // DEFECT CONFIRMED: Conflicting payload silently returned original tx instead of throwing error
  assert.equal(conflicting.id, 'tx_orig');
  assert.equal(conflicting.entries[0].amount, 50);
});

// ============================================================================
// DEFECT-IRONCLAD-003: Zero-Sum Tolerance Loophole Permits Money Creation
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-003 - Double-entry diff > 0.0001 allows systematic money creation', () => {
  const ledger = new Ledger();
  const a = ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 1000 });
  const b = ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 1000 });

  for (let i = 0; i < 50; i++) {
    ledger.postTransaction({
      id: `tx_leak_${i}`,
      tenantId: 't1',
      entries: [
        { accountId: 'a', amount: 1.0001, direction: 'debit' },
        { accountId: 'b', amount: 1.0000, direction: 'credit' }
      ]
    });
  }

  // DEFECT CONFIRMED: 50 * 0.0001 = 0.0050 created out of nowhere
  const netLedgerBalance = Math.round((a.balance + b.balance) * 10000) / 10000;
  assert.equal(netLedgerBalance, 0.0050, 'Net money created out of thin air');
  assert.notEqual(netLedgerBalance, 0.0000, 'Violates conservation of balance');
});

// ============================================================================
// DEFECT-IRONCLAD-004: Sub-Cent Precision Drift Destroys Balance Conservation
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-004 - Unquantized sub-cent amounts cause balance rounding drift', () => {
  const ledger = new Ledger();
  const a = ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  const b = ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });
  const c = ledger.createAccount({ id: 'c', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // Sum of debits = 10.00004 + 10.00004 = 20.00008; credits = 20.00008 (balanced!)
  ledger.postTransaction({
    id: 'tx_subcent_drift',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 10.00004, direction: 'debit' },
      { accountId: 'b', amount: 10.00004, direction: 'debit' },
      { accountId: 'c', amount: 20.00008, direction: 'credit' }
    ]
  });

  // DEFECT CONFIRMED: a=10.0000, b=10.0000, c=-20.0001 -> Sum is -0.0001!
  const sum = Math.round((a.balance + b.balance + c.balance) * 10000) / 10000;
  assert.equal(sum, -0.0001, 'Ledger lost value conservation');
});

// ============================================================================
// DEFECT-IRONCLAD-005: Zero Rollback Mechanism on Mid-Execution Failure
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-005 - Mid-transaction failure leaves accounts corrupted', () => {
  const ledger = new Ledger();
  const a = ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  const b = ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // Simulate unexpected error during audit emission in Phase 6/7
  ledger._emitAuditEvent = () => { throw new Error('Simulated audit subsystem crash'); };

  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_fail_mid',
      tenantId: 't1',
      entries: [
        { accountId: 'a', amount: 50, direction: 'credit' },
        { accountId: 'b', amount: 50, direction: 'debit' }
      ]
    });
  }, /Simulated audit subsystem crash/);

  // DEFECT CONFIRMED: Account 'a' was modified to -50, but 'b' remains 0 (partial mutation!)
  assert.equal(a.balance, -50, 'Account a was NOT rolled back');
  assert.equal(b.balance, 0, 'Account b was untouched, leaving ledger unbalanced');
});

// ============================================================================
// DEFECT-IRONCLAD-006: Missing Defensive Cloning on Transaction Records
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-006 - Mutation of returned transaction corrupts internal state', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  const tx = ledger.postTransaction({
    id: 'tx_mutable',
    tenantId: 't1',
    idempotencyKey: 'idem_mutable',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });

  // Mutate returned object
  tx.status = 'FORGED_STATUS';
  tx.entries[0].amount = 888888;

  // DEFECT CONFIRMED: Internal transactions map and replay are tampered
  const internal = ledger.transactions.get('tx_mutable');
  assert.equal(internal.status, 'FORGED_STATUS');
  assert.equal(internal.entries[0].amount, 888888);

  const replayed = ledger.postTransaction({
    id: 'tx_mutable',
    tenantId: 't1',
    idempotencyKey: 'idem_mutable',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });
  assert.equal(replayed.status, 'FORGED_STATUS');
});

// ============================================================================
// DEFECT-IRONCLAD-007: Delimiter Collision in Composite Keys
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-007 - Delimiter collision across tenants', () => {
  const ledger = new Ledger();
  // Tenant 'org' creates account 'sub:1' -> key 'org:sub:1'
  ledger.createAccount({ id: 'sub:1', tenantId: 'org', type: 'asset' });

  // Tenant 'org:sub' attempts to create account '1' -> key 'org:sub:1'
  assert.throws(
    () => ledger.createAccount({ id: '1', tenantId: 'org:sub', type: 'asset' }),
    /Account already exists/
  );
});

// ============================================================================
// DEFECT-IRONCLAD-008: Negative excessAmount in Overdraft Disabled Rejection
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-008 - Negative excessAmount when overdraft is disabled', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 1000, overdraftEnabled: false });
  ledger.createAccount({ id: 'exp', tenantId: 't1', type: 'expense' });

  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_disabled',
      tenantId: 't1',
      entries: [
        { accountId: 'cash', amount: 50, direction: 'credit' },
        { accountId: 'exp', amount: 50, direction: 'debit' }
      ]
    });
  }, /Insufficient funds/);

  const events = ledger.getAuditEvents('t1', 'cash');
  assert.equal(events.length, 1);
  // DEFECT CONFIRMED: excessAmount is -950 instead of +50, and remainingCredit is 1000 instead of 0
  assert.equal(events[0].details.excessAmount, -950);
  assert.equal(events[0].remainingCredit, 1000);
});

// ============================================================================
// DEFECT-IRONCLAD-009: Repayment Transactions Misflagged as Overdraft Utilized
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-009 - Inbound partial repayment tagged with overdraftUtilized: true', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 500 });
  const rev = ledger.createAccount({ id: 'rev', tenantId: 't1', type: 'revenue' });

  // Put account into overdraft: balance = -100
  cash.applyEntry(100, 'credit');
  assert.equal(cash.balance, -100);

  // Repayment transaction of 40 (balance goes from -100 to -60)
  const repayTx = ledger.postTransaction({
    id: 'tx_repay_partial',
    tenantId: 't1',
    entries: [
      { accountId: 'cash', amount: 40, direction: 'debit' },
      { accountId: 'rev', amount: 40, direction: 'credit' }
    ]
  });

  // DEFECT CONFIRMED: Repayment transaction is marked as overdraft borrowing
  assert.equal(repayTx.overdraftUtilized, true, 'Repayment must NOT be flagged as overdraft borrowing');
  assert.equal(repayTx.overdraftAmount, 60);
});

// ============================================================================
// DEFECT-IRONCLAD-010: Entry Order Dependency in Pre-Flight Check
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-010 - Order of entries causes false rejection in atomic transaction', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // Case A: Credit 150 before Debit 100 -> Rejected (potential -150 < -100)!
  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_order_dep_1',
      tenantId: 't1',
      entries: [
        { accountId: 'a', amount: 150, direction: 'credit' },
        { accountId: 'a', amount: 100, direction: 'debit' },
        { accountId: 'b', amount: 50, direction: 'debit' }
      ]
    });
  }, /Insufficient funds/);

  // Case B: Exactly same entries in reverse order -> Accepted!
  const tx = ledger.postTransaction({
    id: 'tx_order_dep_2',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 100, direction: 'debit' },
      { accountId: 'a', amount: 150, direction: 'credit' },
      { accountId: 'b', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(tx.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'a').balance, -50);
});

// ============================================================================
// DEFECT-IRONCLAD-011: Multi-Currency Blind Settlement
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-011 - Cross-currency settlement without exchange rate', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'usd_acc', tenantId: 't1', type: 'asset', currency: 'USD', creditLimit: 100 });
  ledger.createAccount({ id: 'eur_acc', tenantId: 't1', type: 'asset', currency: 'EUR', creditLimit: 100 });

  const tx = ledger.postTransaction({
    id: 'tx_currency_blind',
    tenantId: 't1',
    entries: [
      { accountId: 'usd_acc', amount: 100, direction: 'debit' },
      { accountId: 'eur_acc', amount: 100, direction: 'credit' }
    ]
  });

  // DEFECT CONFIRMED: Settled 100 USD against 100 EUR 1:1
  assert.equal(tx.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'usd_acc').currency, 'USD');
  assert.equal(ledger.getAccount('t1', 'eur_acc').currency, 'EUR');
});

// ============================================================================
// DEFECT-IRONCLAD-012: Duplicate Transaction ID Silently Overwrites Ledger History
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-012 - Duplicate transaction ID overwrites existing transaction history', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  ledger.postTransaction({
    id: 'tx_dup_id',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });

  // Second distinct transaction reusing the same id without idempotency key
  ledger.postTransaction({
    id: 'tx_dup_id',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 20, direction: 'debit' },
      { accountId: 'b', amount: 20, direction: 'credit' }
    ]
  });

  // DEFECT CONFIRMED: Account has 30, but ledger only records the second tx of 20
  assert.equal(ledger.getAccount('t1', 'a').balance, 30);
  assert.equal(ledger.transactions.size, 1);
  assert.equal(ledger.transactions.get('tx_dup_id').entries[0].amount, 20);
});

// ============================================================================
// DEFECT-IRONCLAD-013: Missing entry.accountId Validation Coerces to 'undefined'
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-013 - Missing entry.accountId matches account named "undefined"', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'undefined', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'acc2', tenantId: 't1', type: 'asset', creditLimit: 100 });

  const tx = ledger.postTransaction({
    id: 'tx_undef_acc',
    tenantId: 't1',
    entries: [
      { amount: 50, direction: 'debit' }, // accountId omitted
      { accountId: 'acc2', amount: 50, direction: 'credit' }
    ]
  });

  // DEFECT CONFIRMED: Account 'undefined' was debited without being specified
  assert.equal(ledger.getAccount('t1', 'undefined').balance, 50);
});

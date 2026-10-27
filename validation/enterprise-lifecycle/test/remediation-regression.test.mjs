import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Ledger,
  InvalidPrecisionError,
  IdempotencyConflictError,
  DuplicateTransactionIdError,
  CurrencyMismatchError,
  MAX_SAFE_AMOUNT
} from '../src/index.mjs';

// ============================================================================
// DEFECT-IRONCLAD-001: Tenant Isolation on Transaction Store and Replay
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-001 - Transaction store scoped by tenantId prevents cross-tenant overwrite & replay leak', () => {
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

  // Replay must return Tenant A's transaction record, NOT Tenant B's
  assert.equal(replayed.tenantId, 'tenant_a', 'Replayed transaction must belong to tenant_a');
  assert.equal(replayed.entries[0].accountId, 'acc_a');
  assert.equal(replayed.entries[0].amount, 100);

  // Scoped lookup getTransaction(tenantId, id) must isolate per tenant
  assert.equal(typeof ledger.getTransaction, 'function', 'getTransaction must be exposed');
  const txA = ledger.getTransaction('tenant_a', 'tx_shared_01');
  const txB = ledger.getTransaction('tenant_b', 'tx_shared_01');
  assert.equal(txA.tenantId, 'tenant_a');
  assert.equal(txA.entries[0].amount, 100);
  assert.equal(txB.tenantId, 'tenant_b');
  assert.equal(txB.entries[0].amount, 250);
});

// ============================================================================
// DEFECT-IRONCLAD-002: Conflicting Payload Detection on Idempotency Replay
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-002 - Idempotency key replay with conflicting payload throws IdempotencyConflictError', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'exp', tenantId: 't1', type: 'expense' });
  ledger.createAccount({ id: 'rev', tenantId: 't1', type: 'revenue' });

  ledger.postTransaction({
    id: 'tx_orig',
    tenantId: 't1',
    idempotencyKey: 'key_reused',
    description: 'Original transaction',
    entries: [
      { accountId: 'cash', amount: 50, direction: 'credit' },
      { accountId: 'exp', amount: 50, direction: 'debit' }
    ]
  });

  // Replay with identical payload must succeed and return cached tx
  const successfulReplay = ledger.postTransaction({
    id: 'tx_orig',
    tenantId: 't1',
    idempotencyKey: 'key_reused',
    description: 'Original transaction',
    entries: [
      { accountId: 'cash', amount: 50, direction: 'credit' },
      { accountId: 'exp', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(successfulReplay.id, 'tx_orig');
  assert.equal(successfulReplay.entries[0].amount, 50);

  // Replay with DIFFERENT amount must throw IdempotencyConflictError (code: IDEMPOTENCY_CONFLICT)
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_orig',
        tenantId: 't1',
        idempotencyKey: 'key_reused',
        description: 'Original transaction',
        entries: [
          { accountId: 'cash', amount: 9999, direction: 'credit' },
          { accountId: 'exp', amount: 9999, direction: 'debit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );

  // Replay with DIFFERENT accounts must throw IdempotencyConflictError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_orig',
        tenantId: 't1',
        idempotencyKey: 'key_reused',
        entries: [
          { accountId: 'cash', amount: 50, direction: 'credit' },
          { accountId: 'rev', amount: 50, direction: 'debit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );

  // Replay with DIFFERENT description must throw IdempotencyConflictError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_orig',
        tenantId: 't1',
        idempotencyKey: 'key_reused',
        description: 'Altered description',
        entries: [
          { accountId: 'cash', amount: 50, direction: 'credit' },
          { accountId: 'exp', amount: 50, direction: 'debit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );
});

// ============================================================================
// DEFECT-IRONCLAD-003: Exact Double-Entry Balance (Removal of 0.0001 Tolerance Loophole)
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-003 - Rejects unbalanced transactions with diff == 0.0001, requiring exact 4-decimal equality', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 1000 });

  // Difference of 0.0001 must be strictly rejected
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_unbalanced_0001',
        tenantId: 't1',
        entries: [
          { accountId: 'a', amount: 1.0001, direction: 'debit' },
          { accountId: 'b', amount: 1.0000, direction: 'credit' }
        ]
      });
    },
    /Unbalanced transaction/
  );

  // Exact match at 4 decimals must pass
  const tx = ledger.postTransaction({
    id: 'tx_balanced_exact',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 1.0001, direction: 'debit' },
      { accountId: 'b', amount: 1.0001, direction: 'credit' }
    ]
  });
  assert.equal(tx.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'a').balance, 1.0001);
  assert.equal(ledger.getAccount('t1', 'b').balance, -1.0001);
});

// ============================================================================
// DEFECT-IRONCLAD-004: Validation of Maximum 4 Decimal Places Scale
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-004 - Reject entry amounts and credit limits exceeding 4 decimal places with INVALID_PRECISION', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // 5 decimal places in entry amount must throw INVALID_PRECISION
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_subcent_5dec',
        tenantId: 't1',
        entries: [
          { accountId: 'a', amount: 10.00004, direction: 'debit' },
          { accountId: 'b', amount: 10.00004, direction: 'credit' }
        ]
      });
    },
    (err) => (err instanceof TypeError || err instanceof RangeError) && err.code === 'INVALID_PRECISION'
  );

  // Credit limit exceeding 4 decimal places on account creation or update must throw INVALID_PRECISION
  assert.throws(
    () => {
      ledger.createAccount({ id: 'c', tenantId: 't1', type: 'asset', creditLimit: 100.00001 });
    },
    (err) => (err instanceof TypeError || err instanceof RangeError) && err.code === 'INVALID_PRECISION'
  );

  const acc = ledger.getAccount('t1', 'a');
  assert.throws(
    () => {
      acc.updatePolicy({ creditLimit: 50.12345 });
    },
    (err) => (err instanceof TypeError || err instanceof RangeError) && err.code === 'INVALID_PRECISION'
  );
});

// ============================================================================
// DEFECT-IRONCLAD-005: Robust Atomic Rollback on Mid-Execution Failure
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-005 - Mid-execution failure restores all account balances to prior snapshot state', () => {
  const ledger = new Ledger();
  const a = ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  const b = ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // Pre-seed account a with 10.0000 and b with 20.0000
  a.applyEntry(10, 'debit');
  b.applyEntry(20, 'debit');
  assert.equal(a.balance, 10);
  assert.equal(b.balance, 20);

  // Intercept _emitAuditEvent to fail during execution after account a has been mutated
  ledger._emitAuditEvent = () => {
    throw new Error('Simulated audit subsystem crash');
  };

  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_fail_mid_rollback',
      tenantId: 't1',
      entries: [
        { accountId: 'a', amount: 50, direction: 'credit' },
        { accountId: 'b', amount: 50, direction: 'debit' }
      ]
    });
  }, /Simulated audit subsystem crash/);

  // Both accounts must be restored to their snapshot balances
  assert.equal(a.balance, 10, 'Account a must be rolled back to pre-tx balance 10');
  assert.equal(b.balance, 20, 'Account b must be rolled back to pre-tx balance 20');
});

// ============================================================================
// DEFECT-IRONCLAD-006: Defensive Deep Clones on Initial Post and Idempotency Replay
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-006 - External mutations to returned transaction records do not mutate internal store or replays', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  const tx = ledger.postTransaction({
    id: 'tx_immutable_test',
    tenantId: 't1',
    idempotencyKey: 'idem_clone',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });

  // Mutate returned object and its entries
  tx.status = 'FORGED_STATUS';
  tx.entries[0].amount = 999999;
  tx.entries[0].accountId = 'hacked_account';

  // Internal transaction store lookup must remain pristine
  const stored = ledger.getTransaction ? ledger.getTransaction('t1', 'tx_immutable_test') : ledger.transactions.get('t1:tx_immutable_test');
  assert.equal(stored.status, 'POSTED');
  assert.equal(stored.entries[0].amount, 10);
  assert.equal(stored.entries[0].accountId, 'a');

  // Replay must also return a pristine copy that cannot be tampered with
  const replay = ledger.postTransaction({
    id: 'tx_immutable_test',
    tenantId: 't1',
    idempotencyKey: 'idem_clone',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });
  assert.equal(replay.status, 'POSTED');
  assert.equal(replay.entries[0].amount, 10);
  assert.equal(replay.entries[0].accountId, 'a');

  replay.status = 'REPLAY_MUTATED';
  const replay2 = ledger.postTransaction({
    id: 'tx_immutable_test',
    tenantId: 't1',
    idempotencyKey: 'idem_clone',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });
  assert.equal(replay2.status, 'POSTED');
});

// ============================================================================
// DEFECT-IRONCLAD-007: Delimiter Collision Prevention in Composite Keys
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-007 - Disallow unescaped colon delimiter in tenantId, accountId, idempotencyKey, and transactionId', () => {
  const ledger = new Ledger();

  // Reject colon in account id
  assert.throws(
    () => ledger.createAccount({ id: 'sub:1', tenantId: 'org', type: 'asset' }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );

  // Reject colon in tenantId
  assert.throws(
    () => ledger.createAccount({ id: 'acc1', tenantId: 'org:sub', type: 'asset' }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );

  ledger.createAccount({ id: 'acc1', tenantId: 'org', type: 'asset' });
  ledger.createAccount({ id: 'acc2', tenantId: 'org', type: 'asset' });

  // Reject colon in transaction id
  assert.throws(
    () => ledger.postTransaction({
      id: 'tx:1',
      tenantId: 'org',
      entries: [
        { accountId: 'acc1', amount: 10, direction: 'debit' },
        { accountId: 'acc2', amount: 10, direction: 'credit' }
      ]
    }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );

  // Reject colon in idempotencyKey
  assert.throws(
    () => ledger.postTransaction({
      id: 'tx1',
      tenantId: 'org',
      idempotencyKey: 'idem:key',
      entries: [
        { accountId: 'acc1', amount: 10, direction: 'debit' },
        { accountId: 'acc2', amount: 10, direction: 'credit' }
      ]
    }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );
});

// ============================================================================
// DEFECT-IRONCLAD-008: Correct Rejection Audit Telemetry When Overdraft is Disabled
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-008 - excessAmount is positive delta and remainingCredit is 0 when overdraft is disabled', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 1000, overdraftEnabled: false });
  ledger.createAccount({ id: 'exp', tenantId: 't1', type: 'expense' });

  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_disabled_rejection',
      tenantId: 't1',
      entries: [
        { accountId: 'cash', amount: 50, direction: 'credit' },
        { accountId: 'exp', amount: 50, direction: 'debit' }
      ]
    });
  }, /Insufficient funds/);

  const events = ledger.getAuditEvents('t1', 'cash');
  assert.equal(events.length, 1);
  const rejectEvent = events[0];

  assert.equal(rejectEvent.type, 'OVERDRAFT_LIMIT_BREACH_REJECTED');
  // excessAmount must be positive delta (50.0000), NOT -950
  assert.equal(rejectEvent.details.excessAmount, 50);
  // remainingCredit must be 0 when overdraft is disabled, NOT 1000
  assert.equal(rejectEvent.remainingCredit, 0);
});

// ============================================================================
// DEFECT-IRONCLAD-009: Debt Repayment Transactions Not Flagged as Overdraft Utilized
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-009 - Inbound repayment/deposit to overdrawn account does not tag overdraftUtilized: true', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'rev', tenantId: 't1', type: 'revenue' });

  // Draw account into overdraft: balance = -100
  cash.applyEntry(100, 'credit');
  assert.equal(cash.balance, -100);

  // Inbound repayment of 40 (balance goes from -100 to -60, deficit reduced)
  const repayTx = ledger.postTransaction({
    id: 'tx_repay_40',
    tenantId: 't1',
    entries: [
      { accountId: 'cash', amount: 40, direction: 'debit' },
      { accountId: 'rev', amount: 40, direction: 'credit' }
    ]
  });

  // Repayment must NOT be tagged with overdraftUtilized: true
  assert.equal(repayTx.overdraftUtilized, undefined, 'Repayment must not set overdraftUtilized');
  assert.equal(repayTx.overdraftAmount, undefined);
});

// ============================================================================
// DEFECT-IRONCLAD-010: Entry Order Dependency Eliminated via Net Aggregated Delta
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-010 - Net aggregated balance evaluation eliminates entry order dependency', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // In a single atomic transaction, crediting 150 and debiting 100 on account 'a' results in net -50.
  // With creditLimit 100, -50 is within limit. Regardless of order, this MUST succeed.
  const txOrder1 = ledger.postTransaction({
    id: 'tx_order_independent_1',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 150, direction: 'credit' },
      { accountId: 'a', amount: 100, direction: 'debit' },
      { accountId: 'b', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(txOrder1.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'a').balance, -50);

  // Reset accounts for Order 2
  const ledger2 = new Ledger();
  ledger2.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger2.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  const txOrder2 = ledger2.postTransaction({
    id: 'tx_order_independent_2',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 100, direction: 'debit' },
      { accountId: 'a', amount: 150, direction: 'credit' },
      { accountId: 'b', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(txOrder2.status, 'POSTED');
  assert.equal(ledger2.getAccount('t1', 'a').balance, -50);
});

// ============================================================================
// DEFECT-IRONCLAD-011: Multi-Currency Validation Across Accounts
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-011 - Multi-currency transaction without common denomination throws CurrencyMismatchError', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'usd_acc', tenantId: 't1', type: 'asset', currency: 'USD', creditLimit: 100 });
  ledger.createAccount({ id: 'eur_acc', tenantId: 't1', type: 'asset', currency: 'EUR', creditLimit: 100 });

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_cross_currency',
        tenantId: 't1',
        entries: [
          { accountId: 'usd_acc', amount: 100, direction: 'debit' },
          { accountId: 'eur_acc', amount: 100, direction: 'credit' }
        ]
      });
    },
    (err) => err.code === 'CURRENCY_MISMATCH' || err.name === 'CurrencyMismatchError' || /currency/i.test(err.message)
  );
});

// ============================================================================
// DEFECT-IRONCLAD-012: Enforce Transaction ID Uniqueness per Tenant & Expose getTransaction
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-012 - Reject duplicate transaction ID per tenant with DuplicateTransactionIdError', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  ledger.postTransaction({
    id: 'tx_unique_01',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });

  // Re-posting distinct transaction with same ID and no idempotency key must be rejected
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_unique_01',
        tenantId: 't1',
        entries: [
          { accountId: 'a', amount: 20, direction: 'debit' },
          { accountId: 'b', amount: 20, direction: 'credit' }
        ]
      });
    },
    (err) => err.code === 'TRANSACTION_ALREADY_EXISTS' || err.name === 'DuplicateTransactionIdError' || /already exists/i.test(err.message)
  );

  // Account 'a' balance must remain 10 (not 30)
  assert.equal(ledger.getAccount('t1', 'a').balance, 10);

  // getTransaction must return the transaction
  const retrieved = ledger.getTransaction('t1', 'tx_unique_01');
  assert.equal(retrieved.id, 'tx_unique_01');
  assert.equal(retrieved.entries[0].amount, 10);
});

// ============================================================================
// DEFECT-IRONCLAD-013: Validate entry.accountId and Contradictory entry.tenantId
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-013 - Validate entry.accountId is non-empty string and reject conflicting entry.tenantId', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc1', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'undefined', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // Missing or non-string accountId must throw TypeError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_missing_acc_id',
        tenantId: 't1',
        entries: [
          { amount: 50, direction: 'debit' },
          { accountId: 'acc1', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /accountId/i.test(err.message)
  );

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_empty_acc_id',
        tenantId: 't1',
        entries: [
          { accountId: '', amount: 50, direction: 'debit' },
          { accountId: 'acc1', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /accountId/i.test(err.message)
  );

  // Contradictory entry.tenantId must be rejected
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_tenant_mismatch',
        tenantId: 't1',
        entries: [
          { accountId: 'acc1', tenantId: 't2', amount: 50, direction: 'debit' },
          { accountId: 'acc1', amount: 50, direction: 'credit' }
        ]
      });
    },
    /Cross-tenant|tenant/i
  );
});

// ============================================================================
// DEFECT-IRONCLAD-014: Idempotency Key Reuse with Conflicting Transaction ID
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-014 - Idempotency key reuse with conflicting transaction ID throws IdempotencyConflictError', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 't14', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'capital', tenantId: 't14', type: 'equity' });

  // Post initial transaction with idempotency key
  const tx1 = ledger.postTransaction({
    id: 'tx_orig_14',
    tenantId: 't14',
    idempotencyKey: 'idem_key_014',
    description: 'Initial investment',
    entries: [
      { accountId: 'cash', amount: 150, direction: 'debit' },
      { accountId: 'capital', amount: 150, direction: 'credit' }
    ]
  });
  assert.equal(tx1.id, 'tx_orig_14');
  assert.equal(ledger.getAccount('t14', 'cash').balance, 150);

  // Exact replay with same id succeeds and returns cached tx
  const txReplay = ledger.postTransaction({
    id: 'tx_orig_14',
    tenantId: 't14',
    idempotencyKey: 'idem_key_014',
    description: 'Initial investment',
    entries: [
      { accountId: 'cash', amount: 150, direction: 'debit' },
      { accountId: 'capital', amount: 150, direction: 'credit' }
    ]
  });
  assert.equal(txReplay.id, 'tx_orig_14');
  assert.equal(ledger.getAccount('t14', 'cash').balance, 150);

  // Replay with identical entries/description but DIFFERENT transaction ID must throw IdempotencyConflictError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_conflict_14',
        tenantId: 't14',
        idempotencyKey: 'idem_key_014',
        description: 'Initial investment',
        entries: [
          { accountId: 'cash', amount: 150, direction: 'debit' },
          { accountId: 'capital', amount: 150, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError || err.code === 'IDEMPOTENCY_CONFLICT' || /idempotency key reused with conflicting transaction/i.test(err.message)
  );

  // Balances must not change and conflicting tx ID must not be registered
  assert.equal(ledger.getAccount('t14', 'cash').balance, 150);
  assert.equal(ledger.getTransaction('t14', 'tx_conflict_14'), null);
});

// ============================================================================
// DEFECT-IRONCLAD-015: Transaction and Index Atomicity on Cloning / State Failure
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-015 - Transaction and index atomicity after cloning error rolls back all 4 state stores', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc_a', tenantId: 't15', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'acc_b', tenantId: 't15', type: 'asset', creditLimit: 500 });

  // Baseline setup
  ledger.postTransaction({
    id: 'tx_baseline_15',
    tenantId: 't15',
    entries: [
      { accountId: 'acc_a', amount: 50, direction: 'debit' },
      { accountId: 'acc_b', amount: 50, direction: 'credit' }
    ]
  });

  const origAuditLen = ledger.auditEvents.length;
  const origTxCount = ledger.transactions.size;
  const origIdempCount = ledger.idempotencyIndex.size;
  assert.equal(ledger.getAccount('t15', 'acc_a').balance, 50);
  assert.equal(ledger.getAccount('t15', 'acc_b').balance, -50);

  // Force structuredClone error during transaction record finalization
  const origClone = globalThis.structuredClone;
  try {
    globalThis.structuredClone = (val) => {
      // If cloning txRecord inside postTransaction, throw simulated failure
      if (val && val.id === 'tx_fail_clone_15') {
        throw new Error('Simulated structuredClone failure');
      }
      return origClone(val);
    };

    assert.throws(
      () => {
        ledger.postTransaction({
          id: 'tx_fail_clone_15',
          tenantId: 't15',
          idempotencyKey: 'idem_key_015',
          entries: [
            { accountId: 'acc_a', amount: 25, direction: 'debit' },
            { accountId: 'acc_b', amount: 25, direction: 'credit' }
          ]
        });
      },
      /Simulated structuredClone failure/
    );
  } finally {
    globalThis.structuredClone = origClone;
  }

  // Verify all 4 state stores rolled back atomically:
  // 1. Account balances restored
  assert.equal(ledger.getAccount('t15', 'acc_a').balance, 50, 'Account A balance must rollback to 50');
  assert.equal(ledger.getAccount('t15', 'acc_b').balance, -50, 'Account B balance must rollback to -50');

  // 2. Audit events restored
  assert.equal(ledger.auditEvents.length, origAuditLen, 'Audit events length must rollback to prior snapshot length');

  // 3. Transactions map purged of failed transaction
  assert.equal(ledger.transactions.has('t15:tx_fail_clone_15'), false, 'Transactions map must not contain failed transaction key');
  assert.equal(ledger.getTransaction('t15', 'tx_fail_clone_15'), null);
  assert.equal(ledger.transactions.size, origTxCount);

  // 4. Idempotency index purged of failed key
  assert.equal(ledger.idempotencyIndex.has('t15:idem_key_015'), false, 'Idempotency index must not contain failed key');
  assert.equal(ledger.idempotencyIndex.size, origIdempCount);

  // Subsequent transaction with same ID and idempotency key succeeds cleanly
  const recoveredTx = ledger.postTransaction({
    id: 'tx_fail_clone_15',
    tenantId: 't15',
    idempotencyKey: 'idem_key_015',
    entries: [
      { accountId: 'acc_a', amount: 25, direction: 'debit' },
      { accountId: 'acc_b', amount: 25, direction: 'credit' }
    ]
  });
  assert.equal(recoveredTx.id, 'tx_fail_clone_15');
  assert.equal(ledger.getAccount('t15', 'acc_a').balance, 75);
  assert.equal(ledger.getAccount('t15', 'acc_b').balance, -75);
});

// ============================================================================
// DEFECT-IRONCLAD-016: Account Policy Modification Rollback on Audit Failure
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-016 - Account policy modification is atomically rolled back if audit emission fails', () => {
  const ledger = new Ledger();
  ledger.createAccount({
    id: 'acc_pol_16',
    tenantId: 't16',
    type: 'asset',
    creditLimit: 200,
    overdraftEnabled: true,
    overdraftAlertThreshold: 0.75
  });

  const account = ledger.getAccount('t16', 'acc_pol_16');
  const initialAuditLen = ledger.auditEvents.length;

  // Intercept _emitAuditEvent to fail on policy change
  const originalEmit = ledger._emitAuditEvent;
  ledger._emitAuditEvent = (event) => {
    if (event.type === 'OVERDRAFT_CONFIG_UPDATED') {
      throw new Error('Audit service unavailable');
    }
    return originalEmit.call(ledger, event);
  };

  assert.throws(
    () => {
      ledger.updateAccountPolicy('t16', 'acc_pol_16', {
        creditLimit: 800,
        overdraftEnabled: false,
        overdraftAlertThreshold: 0.95
      });
    },
    /Audit service unavailable/
  );

  // Verify atomic rollback of all account policy fields
  assert.equal(account.creditLimit, 200, 'creditLimit must be rolled back to 200');
  assert.equal(account.overdraftEnabled, true, 'overdraftEnabled must be rolled back to true');
  assert.equal(account.overdraftAlertThreshold, 0.75, 'overdraftAlertThreshold must be rolled back to 0.75');
  assert.equal(ledger.auditEvents.length, initialAuditLen, 'Audit events length must remain unchanged');

  // Restore audit emitter and verify subsequent update applies cleanly
  ledger._emitAuditEvent = originalEmit;
  const auditEvent = ledger.updateAccountPolicy('t16', 'acc_pol_16', {
    creditLimit: 500,
    overdraftAlertThreshold: 0.9
  });

  assert.equal(account.creditLimit, 500);
  assert.equal(account.overdraftAlertThreshold, 0.9);
  assert.equal(auditEvent.type, 'OVERDRAFT_CONFIG_UPDATED');
  assert.equal(auditEvent.details.newCreditLimit, 500);
  assert.equal(auditEvent.details.previousCreditLimit, 200);
});

// ============================================================================
// DEFECT-IRONCLAD-017: Monetary Safe Integer Boundary Enforcement
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-017 - Monetary safe integer boundary enforcement rejects amounts and limits exceeding MAX_SAFE_AMOUNT', () => {
  const ledger = new Ledger();

  assert.equal(MAX_SAFE_AMOUNT, Number.MAX_SAFE_INTEGER / 10000);
  assert.equal(MAX_SAFE_AMOUNT, 900719925474.0991);

  // Exact MAX_SAFE_AMOUNT succeeds for account creation
  const safeAccount = ledger.createAccount({
    id: 'safe_acc',
    tenantId: 't17',
    type: 'asset',
    creditLimit: MAX_SAFE_AMOUNT
  });
  assert.equal(safeAccount.creditLimit, MAX_SAFE_AMOUNT);

  // Account creation with creditLimit exceeding MAX_SAFE_AMOUNT throws InvalidPrecisionError
  assert.throws(
    () => {
      new Account({
        id: 'acc_unsafe',
        tenantId: 't17',
        type: 'asset',
        creditLimit: 900719925475
      });
    },
    (err) => err instanceof InvalidPrecisionError && /exceeds maximum safe integer monetary limit/i.test(err.message)
  );

  // updatePolicy with creditLimit exceeding MAX_SAFE_AMOUNT throws InvalidPrecisionError
  assert.throws(
    () => {
      safeAccount.updatePolicy({ creditLimit: MAX_SAFE_AMOUNT + 0.0001 });
    },
    (err) => err instanceof InvalidPrecisionError && /exceeds maximum safe integer monetary limit/i.test(err.message)
  );

  // Transaction posting with entry amount exceeding MAX_SAFE_AMOUNT throws InvalidPrecisionError
  ledger.createAccount({ id: 'contra', tenantId: 't17', type: 'equity' });
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_unsafe_amount',
        tenantId: 't17',
        entries: [
          { accountId: 'safe_acc', amount: 900719925475, direction: 'debit' },
          { accountId: 'contra', amount: 900719925475, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof InvalidPrecisionError && /exceeds maximum safe integer monetary limit/i.test(err.message)
  );

  // Transaction posting with valid MAX_SAFE_AMOUNT succeeds within 4-decimal precision
  const safeTx = ledger.postTransaction({
    id: 'tx_safe_boundary',
    tenantId: 't17',
    entries: [
      { accountId: 'safe_acc', amount: MAX_SAFE_AMOUNT, direction: 'debit' },
      { accountId: 'contra', amount: MAX_SAFE_AMOUNT, direction: 'credit' }
    ]
  });
  assert.equal(safeTx.status, 'POSTED');
  assert.equal(safeAccount.balance, MAX_SAFE_AMOUNT);

  // Adding further amount that pushes balance beyond MAX_SAFE_AMOUNT is rejected
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_overflow_balance',
        tenantId: 't17',
        entries: [
          { accountId: 'safe_acc', amount: 1.0000, direction: 'debit' },
          { accountId: 'contra', amount: 1.0000, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof InvalidPrecisionError && /exceeds maximum safe integer monetary limit/i.test(err.message)
  );
  // Prior balance intact
  assert.equal(safeAccount.balance, MAX_SAFE_AMOUNT);
});

// ============================================================================
// DEFECT-IRONCLAD-018: Multi-Entry Aggregate Monetary Conservation Loophole
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-018 - Multi-entry aggregate floating point summation accepts unbalanced transaction', () => {
  const ledger = new Ledger();
  const ast1 = ledger.createAccount({ id: 'ast1', tenantId: 't18', type: 'asset', currency: 'USD' });
  const ast2 = ledger.createAccount({ id: 'ast2', tenantId: 't18', type: 'asset', currency: 'USD' });
  const ast3 = ledger.createAccount({ id: 'ast3', tenantId: 't18', type: 'asset', currency: 'USD' });
  const rev1 = ledger.createAccount({ id: 'rev1', tenantId: 't18', type: 'revenue', currency: 'USD' });
  const rev2 = ledger.createAccount({ id: 'rev2', tenantId: 't18', type: 'revenue', currency: 'USD' });

  // Baseline balances are all strictly zero
  assert.equal(ast1.balance, 0);
  assert.equal(ast2.balance, 0);
  assert.equal(ast3.balance, 0);
  assert.equal(rev1.balance, 0);
  assert.equal(rev2.balance, 0);
  assert.equal(ledger.auditEvents.length, 0);

  // Five-entry transaction reproducing exact issue #13 payload
  // 3 debits: MAX_SAFE_AMOUNT, MAX_SAFE_AMOUNT, 0.0001
  // 2 credits: MAX_SAFE_AMOUNT, MAX_SAFE_AMOUNT
  // Net discrepancy: +0.0001 (+1 base unit)
  const txPayload = {
    id: 'tx_ironclad_018_repro',
    tenantId: 't18',
    idempotencyKey: 'idem_ironclad_018',
    description: 'Mathematically unbalanced transaction exceeding floating-point accumulator precision',
    entries: [
      { accountId: 'ast1', direction: 'debit', amount: MAX_SAFE_AMOUNT },
      { accountId: 'ast2', direction: 'debit', amount: MAX_SAFE_AMOUNT },
      { accountId: 'ast3', direction: 'debit', amount: 0.0001 },
      { accountId: 'rev1', direction: 'credit', amount: MAX_SAFE_AMOUNT },
      { accountId: 'rev2', direction: 'credit', amount: MAX_SAFE_AMOUNT }
    ]
  };

  // Assert that it now throws Error ("Unbalanced transaction")
  assert.throws(
    () => {
      ledger.postTransaction(txPayload);
    },
    (err) => err instanceof Error && /Unbalanced transaction/i.test(err.message)
  );

  // Assert complete zero-state rollback:
  // All 5 account balances strictly 0
  assert.equal(ast1.balance, 0, 'ast1 balance must remain strictly 0');
  assert.equal(ast2.balance, 0, 'ast2 balance must remain strictly 0');
  assert.equal(ast3.balance, 0, 'ast3 balance must remain strictly 0');
  assert.equal(rev1.balance, 0, 'rev1 balance must remain strictly 0');
  assert.equal(rev2.balance, 0, 'rev2 balance must remain strictly 0');

  // Records zero audit events
  assert.equal(ledger.auditEvents.length, 0, 'Zero audit events recorded');

  // Stores no transaction record
  assert.equal(ledger.getTransaction('t18', 'tx_ironclad_018_repro'), null, 'Transaction must not be stored');

  // Stores no idempotency record
  assert.equal(ledger.idempotencyIndex.has('t18:idem_ironclad_018'), false, 'Idempotency record must not be stored');

  // Verify that reusing idempotency key for subsequent valid transaction succeeds without conflict
  const subsequentValidTx = ledger.postTransaction({
    id: 'tx_ironclad_018_valid',
    tenantId: 't18',
    idempotencyKey: 'idem_ironclad_018',
    entries: [
      { accountId: 'ast1', direction: 'debit', amount: 50.0000 },
      { accountId: 'rev1', direction: 'credit', amount: 50.0000 }
    ]
  });
  assert.equal(subsequentValidTx.status, 'POSTED');
  assert.equal(ast1.balance, 50.0000);
  assert.equal(rev1.balance, 50.0000);
});

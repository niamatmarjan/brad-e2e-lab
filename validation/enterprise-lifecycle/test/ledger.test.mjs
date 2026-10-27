import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Ledger } from '../src/index.mjs';

test('Account model: initializes with validated properties and debit/credit normality', () => {
  const asset = new Account({ id: 'cash_01', tenantId: 'tenant_acme', type: 'asset', currency: 'USD' });
  assert.equal(asset.isDebitNormal(), true);
  assert.equal(asset.balance, 0);

  const liability = new Account({ id: 'payable_01', tenantId: 'tenant_acme', type: 'liability', currency: 'USD' });
  assert.equal(liability.isDebitNormal(), false);

  assert.throws(() => new Account({ id: '', tenantId: 'tenant_acme', type: 'asset' }), TypeError);
  assert.throws(() => new Account({ id: 'acc_01', tenantId: '', type: 'asset' }), TypeError);
  assert.throws(() => new Account({ id: 'acc_01', tenantId: 't1', type: 'invalid_type' }), TypeError);
});

test('Ledger: enforces double-entry zero-sum balance invariant', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 'acme', type: 'asset' });
  ledger.createAccount({ id: 'revenue', tenantId: 'acme', type: 'revenue' });

  // Unbalanced transaction must fail
  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_unbalanced',
      tenantId: 'acme',
      entries: [
        { accountId: 'cash', amount: 100, direction: 'debit' },
        { accountId: 'revenue', amount: 95, direction: 'credit' }
      ]
    });
  }, /Unbalanced transaction/);

  // Balanced transaction succeeds
  const tx = ledger.postTransaction({
    id: 'tx_01',
    tenantId: 'acme',
    entries: [
      { accountId: 'cash', amount: 100, direction: 'debit' },
      { accountId: 'revenue', amount: 100, direction: 'credit' }
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(ledger.getAccount('acme', 'cash').balance, 100);
  assert.equal(ledger.getAccount('acme', 'revenue').balance, 100);
});

test('Ledger: enforces idempotency keys preventing duplicate postings', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 'acme', type: 'asset' });
  ledger.createAccount({ id: 'capital', tenantId: 'acme', type: 'equity' });

  const tx1 = ledger.postTransaction({
    id: 'tx_idem_1',
    tenantId: 'acme',
    idempotencyKey: 'idem_key_001',
    entries: [
      { accountId: 'cash', amount: 50, direction: 'debit' },
      { accountId: 'capital', amount: 50, direction: 'credit' }
    ]
  });

  // Replay same idempotency key returns original transaction without double-debiting
  const tx2 = ledger.postTransaction({
    id: 'tx_idem_1',
    tenantId: 'acme',
    idempotencyKey: 'idem_key_001',
    entries: [
      { accountId: 'cash', amount: 50, direction: 'debit' },
      { accountId: 'capital', amount: 50, direction: 'credit' }
    ]
  });

  assert.equal(tx1.id, tx2.id);
  assert.equal(ledger.getAccount('acme', 'cash').balance, 50);

  // Replaying with a different transaction ID must throw IdempotencyConflictError (DEFECT-IRONCLAD-014)
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_idem_2',
        tenantId: 'acme',
        idempotencyKey: 'idem_key_001',
        entries: [
          { accountId: 'cash', amount: 50, direction: 'debit' },
          { accountId: 'capital', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );
});

test('Ledger: rejects transaction when balance is insufficient and creditLimit is 0', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 'acme', type: 'asset' });
  ledger.createAccount({ id: 'vendor_payable', tenantId: 'acme', type: 'liability' });

  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_overdraft',
      tenantId: 'acme',
      entries: [
        { accountId: 'vendor_payable', amount: 100, direction: 'debit' },
        { accountId: 'cash', amount: 100, direction: 'credit' }
      ]
    });
  }, /Insufficient funds/);
});

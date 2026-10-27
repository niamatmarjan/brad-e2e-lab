import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, MAX_SAFE_AMOUNT } from '../src/index.mjs';

// ============================================================================
// DEFECT-IRONCLAD-018: Multi-Entry Aggregate Monetary Conservation Loophole
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-018 - Multi-entry aggregate floating point summation accepts unbalanced transaction', () => {
  const ledger = new Ledger();
  const ast1 = ledger.createAccount({ id: 'ast1', tenantId: 't18', type: 'asset', currency: 'USD' });
  const ast2 = ledger.createAccount({ id: 'ast2', tenantId: 't18', type: 'asset', currency: 'USD' });
  const ast3 = ledger.createAccount({ id: 'ast3', tenantId: 't18', type: 'asset', currency: 'USD' });
  const rev1 = ledger.createAccount({ id: 'rev1', tenantId: 't18', type: 'revenue', currency: 'USD' });
  const rev2 = ledger.createAccount({ id: 'rev2', tenantId: 't18', type: 'revenue', currency: 'USD' });

  // Baseline balances
  const initialBalances = {
    ast1: ast1.balance,
    ast2: ast2.balance,
    ast3: ast3.balance,
    rev1: rev1.balance,
    rev2: rev2.balance
  };

  assert.equal(initialBalances.ast1, 0);
  assert.equal(initialBalances.ast2, 0);
  assert.equal(initialBalances.ast3, 0);
  assert.equal(initialBalances.rev1, 0);
  assert.equal(initialBalances.rev2, 0);

  // Five-entry transaction with 1 base unit (0.0001) discrepancy
  const txPayload = {
    id: 'tx_ironclad_018_repro',
    tenantId: 't18',
    description: 'Mathematically unbalanced transaction exceeding floating-point accumulator precision',
    entries: [
      { accountId: 'ast1', direction: 'debit', amount: MAX_SAFE_AMOUNT },
      { accountId: 'ast2', direction: 'debit', amount: MAX_SAFE_AMOUNT },
      { accountId: 'ast3', direction: 'debit', amount: 0.0001 },
      { accountId: 'rev1', direction: 'credit', amount: MAX_SAFE_AMOUNT },
      { accountId: 'rev2', direction: 'credit', amount: MAX_SAFE_AMOUNT }
    ]
  };

  // DEFECT BEHAVIOR ON UNPATCHED BASELINE:
  // Post transaction succeeds because Math.round(totalDebit * 10000) === Math.round(totalCredit * 10000)
  const tx = ledger.postTransaction(txPayload);

  // Defect assertions:
  assert.equal(tx.status, 'POSTED', 'Unpatched ledger improperly posted the unbalanced transaction');
  assert.equal(ast1.balance, MAX_SAFE_AMOUNT);
  assert.equal(ast2.balance, MAX_SAFE_AMOUNT);
  assert.equal(ast3.balance, 0.0001);
  assert.equal(rev1.balance, MAX_SAFE_AMOUNT);
  assert.equal(rev2.balance, MAX_SAFE_AMOUNT);

  const debitUnits = BigInt(Math.round(ast1.balance * 10000)) +
                     BigInt(Math.round(ast2.balance * 10000)) +
                     BigInt(Math.round(ast3.balance * 10000));
  const creditUnits = BigInt(Math.round(rev1.balance * 10000)) +
                      BigInt(Math.round(rev2.balance * 10000));

  assert.equal(debitUnits - creditUnits, 1n, 'Discrepancy is exactly 1 base monetary unit (0.0001)');
});

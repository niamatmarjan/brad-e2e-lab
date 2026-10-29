import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, toBaseUnits } from '../src/index.mjs';

// ============================================================================
// DEFECT-IRONCLAD-019: In-Memory Balance Float Round-Trip Precision Loss
// ============================================================================
test('REPRO: DEFECT-IRONCLAD-019 - Storing BigInt balance as JS Number silently drops 0.0001 unit', () => {
  const ledger = new Ledger();
  const a = ledger.createAccount({ id: 'a', tenantId: 't19', type: 'asset', currency: 'USD' });
  const b = ledger.createAccount({ id: 'b', tenantId: 't19', type: 'revenue', currency: 'USD' });
  const c = ledger.createAccount({ id: 'c', tenantId: 't19', type: 'revenue', currency: 'USD' });

  assert.equal(a.balance, 0);
  assert.equal(b.balance, 0);
  assert.equal(c.balance, 0);

  // Balanced transaction where account 'a' has two debits:
  // Leg 1: 900719925473.5992 (9007199254735992n base units)
  // Leg 2: 0.0001           (1n base unit)
  // Offsetting credits on accounts 'b' and 'c'.
  const tx = ledger.postTransaction({
    id: 'tx_balance_loss_repro',
    tenantId: 't19',
    description: 'Reproduce Issue 14: balance round-trip float precision loss',
    entries: [
      { accountId: 'a', direction: 'debit', amount: 900719925473.5992 },
      { accountId: 'a', direction: 'debit', amount: 0.0001 },
      { accountId: 'b', direction: 'credit', amount: 900719925473.5992 },
      { accountId: 'c', direction: 'credit', amount: 0.0001 }
    ]
  });

  assert.equal(tx.status, 'POSTED');

  // REMEDIATION VERIFICATION (DEFECT-IRONCLAD-019):
  // With exact BigInt base units storage and guarded backward-compatible representation,
  // a.balance returns "900719925473.5993" (exact string) without precision loss.
  // toBaseUnits(a.balance) recovers 9007199254735993n and net evaluates to 0n.
  const aUnits = toBaseUnits(a.balance);
  const bUnits = toBaseUnits(b.balance);
  const cUnits = toBaseUnits(c.balance);
  const net = aUnits - bUnits - cUnits;

  assert.equal(a.balance, '900719925473.5993');
  assert.equal(a.balanceUnits, 9007199254735993n);
  assert.equal(a.formattedBalance, '900719925473.5993');
  assert.equal(net, 0n, 'Confirms exact 4-decimal balance conservation with zero precision loss');
});

import { Account } from './account.mjs';

export class Ledger {
  constructor() {
    this.accounts = new Map();
    this.transactions = new Map();
    this.idempotencyIndex = new Map();
    this.auditEvents = [];
  }

  createAccount(spec) {
    const account = new Account(spec);
    const key = `${account.tenantId}:${account.id}`;
    if (this.accounts.has(key)) {
      throw new Error(`Account already exists: ${account.id} for tenant ${account.tenantId}`);
    }
    this.accounts.set(key, account);
    return account;
  }

  getAccount(tenantId, accountId) {
    const key = `${tenantId}:${accountId}`;
    return this.accounts.get(key) || null;
  }

  updateAccountPolicy(tenantId, accountId, policy = {}) {
    if (!tenantId || typeof tenantId !== 'string') throw new TypeError('tenantId required');
    if (!accountId || typeof accountId !== 'string') throw new TypeError('accountId required');
    const account = this.getAccount(tenantId, accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found for tenant ${tenantId}`);
    }
    const previousCreditLimit = account.creditLimit;
    account.updatePolicy(policy);
    return this._emitAuditEvent({
      tenantId,
      accountId: account.id,
      transactionId: `config_${Date.now()}`,
      type: 'OVERDRAFT_CONFIG_UPDATED',
      currentBalance: account.balance,
      creditLimit: account.creditLimit,
      details: {
        previousCreditLimit,
        newCreditLimit: account.creditLimit,
        overdraftEnabled: account.overdraftEnabled,
        overdraftAlertThreshold: account.overdraftAlertThreshold
      }
    });
  }

  updateAccount(tenantId, accountId, policy = {}) {
    return this.updateAccountPolicy(tenantId, accountId, policy);
  }

  getAuditEvents(tenantId, accountId = null) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new TypeError('tenantId required');
    }
    let events = this.auditEvents.filter(e => e.tenantId === tenantId);
    if (accountId) {
      events = events.filter(e => e.accountId === accountId);
    }
    // Return defensive clone
    return events.map(e => JSON.parse(JSON.stringify(e)));
  }

  _emitAuditEvent({ tenantId, accountId, transactionId, type, currentBalance, creditLimit, details = {} }) {
    const overdraftUtilized = currentBalance < 0 ? Math.round(Math.abs(currentBalance) * 10000) / 10000 : 0;
    const remainingCredit = Math.round(Math.max(0, creditLimit - overdraftUtilized) * 10000) / 10000;
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      tenantId,
      accountId,
      transactionId,
      type,
      timestamp: Date.now(),
      currentBalance,
      creditLimit,
      overdraftUtilized,
      remainingCredit,
      details: JSON.parse(JSON.stringify(details))
    };
    this.auditEvents.push(event);
    return JSON.parse(JSON.stringify(event));
  }

  postTransaction({ id, tenantId, idempotencyKey, timestamp = Date.now(), description = '', entries = [] }) {
    if (!id || typeof id !== 'string') throw new TypeError('Transaction id required');
    if (!tenantId || typeof tenantId !== 'string') throw new TypeError('tenantId required');
    if (!Array.isArray(entries) || entries.length < 2) {
      throw new Error('Transaction must contain at least 2 entries');
    }

    // 1. Check idempotency
    if (idempotencyKey) {
      const existingTxId = this.idempotencyIndex.get(`${tenantId}:${idempotencyKey}`);
      if (existingTxId) {
        return this.transactions.get(existingTxId);
      }
    }

    // 2. Verify double-entry zero sum: debits == credits
    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of entries) {
      if (typeof entry.amount !== 'number' || entry.amount <= 0 || !Number.isFinite(entry.amount)) {
        throw new TypeError('Entry amount must be positive finite number');
      }
      if (entry.direction === 'debit') totalDebit += entry.amount;
      else if (entry.direction === 'credit') totalCredit += entry.amount;
      else throw new TypeError('Invalid direction, must be debit or credit');
    }

    const diff = Math.abs(Math.round((totalDebit - totalCredit) * 10000) / 10000);
    if (diff > 0.0001) {
      throw new Error(`Unbalanced transaction: debits (${totalDebit}) != credits (${totalCredit})`);
    }

    // 3. Verify all accounts exist and belong to tenant
    const resolvedAccounts = [];
    for (const entry of entries) {
      const acc = this.getAccount(tenantId, entry.accountId);
      if (!acc) {
        throw new Error(`Account ${entry.accountId} not found for tenant ${tenantId}`);
      }
      resolvedAccounts.push({ account: acc, entry });
    }

    // 4. Pre-flight Balance & Overdraft Checks (Atomic Evaluation)
    const simulatedBalances = new Map();
    for (const { account, entry } of resolvedAccounts) {
      const currentSimBal = simulatedBalances.has(account.id)
        ? simulatedBalances.get(account.id)
        : account.balance;

      let nextSimBal = currentSimBal;
      if (account.isDebitNormal()) {
        nextSimBal = entry.direction === 'debit' ? currentSimBal + entry.amount : currentSimBal - entry.amount;
      } else {
        nextSimBal = entry.direction === 'credit' ? currentSimBal + entry.amount : currentSimBal - entry.amount;
      }
      nextSimBal = Math.round(nextSimBal * 10000) / 10000;
      simulatedBalances.set(account.id, nextSimBal);

      const willDecrease = (account.isDebitNormal() && entry.direction === 'credit') ||
                           (!account.isDebitNormal() && entry.direction === 'debit');
      if (willDecrease) {
        const creditLimit = account.creditLimit || 0;
        const overdraftAllowed = account.overdraftEnabled && nextSimBal >= -creditLimit;

        if (nextSimBal < 0 && !overdraftAllowed) {
          // Record limit breach rejection audit event
          this._emitAuditEvent({
            tenantId,
            accountId: account.id,
            transactionId: id,
            type: 'OVERDRAFT_LIMIT_BREACH_REJECTED',
            currentBalance: account.balance,
            creditLimit,
            details: {
              requestedAmount: entry.amount,
              potentialBalance: nextSimBal,
              excessAmount: Math.round((Math.abs(nextSimBal) - creditLimit) * 10000) / 10000
            }
          });

          // Throw structured Insufficient funds error without modifying any account state
          const err = new Error(
            `Insufficient funds: account ${account.id} balance is ${account.balance}, creditLimit is ${creditLimit}, requested ${entry.amount}`
          );
          err.name = 'InsufficientFundsError';
          err.code = 'INSUFFICIENT_FUNDS';
          err.tenantId = tenantId;
          err.accountId = account.id;
          err.currentBalance = account.balance;
          err.creditLimit = creditLimit;
          err.requestedAmount = entry.amount;
          throw err;
        }
      }
    }

    // 5. Apply entries and record transitions
    let txOverdraftUtilized = false;
    let maxOverdraftAmount = 0;
    let minRemainingCredit = Infinity;

    for (const { account, entry } of resolvedAccounts) {
      const priorBalance = account.balance;
      account.applyEntry(entry.amount, entry.direction);
      const newBalance = account.balance;

      // Overdraft telemetry tracking
      if (newBalance < 0) {
        txOverdraftUtilized = true;
        const currentOverdraft = Math.abs(newBalance);
        if (currentOverdraft > maxOverdraftAmount) maxOverdraftAmount = currentOverdraft;
        const remCredit = account.getRemainingCredit();
        if (remCredit < minRemainingCredit) minRemainingCredit = remCredit;

        if (priorBalance >= 0 || newBalance < priorBalance) {
          // Transition: NORMAL -> OVERDRAFT or Deepened Overdraft
          this._emitAuditEvent({
            tenantId,
            accountId: account.id,
            transactionId: id,
            type: 'OVERDRAFT_UTILIZED',
            currentBalance: newBalance,
            creditLimit: account.creditLimit,
            details: {
              priorBalance,
              delta: Math.round((newBalance - priorBalance) * 10000) / 10000,
              utilizationRatio: account.getOverdraftUtilizationRatio()
            }
          });

          // Threshold check
          const utilRatio = account.getOverdraftUtilizationRatio();
          if (utilRatio >= account.overdraftAlertThreshold) {
            this._emitAuditEvent({
              tenantId,
              accountId: account.id,
              transactionId: id,
              type: 'OVERDRAFT_THRESHOLD_EXCEEDED',
              currentBalance: newBalance,
              creditLimit: account.creditLimit,
              details: {
                utilizationRatio: utilRatio,
                alertThreshold: account.overdraftAlertThreshold,
                warning: `Account credit utilization has reached ${(utilRatio * 100).toFixed(1)}%`
              }
            });
          }
        } else if (newBalance > priorBalance) {
          // Transition: Partial Overdraft Repayment
          this._emitAuditEvent({
            tenantId,
            accountId: account.id,
            transactionId: id,
            type: 'OVERDRAFT_REDUCED',
            currentBalance: newBalance,
            creditLimit: account.creditLimit,
            details: {
              priorBalance,
              repaidPortion: Math.round((newBalance - priorBalance) * 10000) / 10000
            }
          });
        }
      } else if (priorBalance < 0 && newBalance >= 0) {
        // Transition: OVERDRAFT -> NORMAL (Full Clearance)
        this._emitAuditEvent({
          tenantId,
          accountId: account.id,
          transactionId: id,
          type: 'OVERDRAFT_CLEARED',
          currentBalance: newBalance,
          creditLimit: account.creditLimit,
          details: {
            priorBalance,
            clearedDeficit: Math.abs(priorBalance),
            creditDeposit: entry.amount
          }
        });
      }
    }

    const txRecord = {
      id,
      tenantId,
      idempotencyKey: idempotencyKey || null,
      timestamp,
      description,
      entries: entries.map(e => ({ ...e })),
      status: 'POSTED',
      ...(txOverdraftUtilized && {
        overdraftUtilized: true,
        overdraftAmount: maxOverdraftAmount,
        remainingCredit: minRemainingCredit
      })
    };

    this.transactions.set(id, txRecord);
    if (idempotencyKey) {
      this.idempotencyIndex.set(`${tenantId}:${idempotencyKey}`, id);
    }

    return txRecord;
  }
}

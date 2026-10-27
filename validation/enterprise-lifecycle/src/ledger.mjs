import {
  Account,
  InvalidPrecisionError,
  MAX_SAFE_AMOUNT,
  MAX_SAFE_UNITS,
  toBaseUnits,
  fromBaseUnits,
  validatePrecision,
  isExactFloat,
  parseDecimalToBaseUnits,
  baseUnitsToDecimalString
} from './account.mjs';

export {
  InvalidPrecisionError,
  MAX_SAFE_AMOUNT,
  MAX_SAFE_UNITS,
  toBaseUnits,
  fromBaseUnits,
  isExactFloat,
  parseDecimalToBaseUnits,
  baseUnitsToDecimalString
};

export class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency key reused with conflicting transaction payload') {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(message = 'All accounts in transaction must share identical currency') {
    super(message);
    this.name = 'CurrencyMismatchError';
    this.code = 'CURRENCY_MISMATCH';
  }
}

export class DuplicateTransactionIdError extends Error {
  constructor(message = 'Transaction ID already exists for tenant') {
    super(message);
    this.name = 'DuplicateTransactionIdError';
    this.code = 'TRANSACTION_ALREADY_EXISTS';
  }
}

export class InsufficientFundsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InsufficientFundsError';
    this.code = 'INSUFFICIENT_FUNDS';
  }
}

function validateDelimiter(val, name) {
  if (typeof val === 'string' && val.includes(':')) {
    throw new TypeError(`${name} must not contain delimiter ":"`);
  }
}

function payloadsMatch(storedPayload, incoming) {
  const storedId = storedPayload.id ?? storedPayload.txId;
  if (incoming.id !== storedId) {
    return false;
  }
  if ((incoming.description || '') !== (storedPayload.description || '')) {
    return false;
  }
  if (!Array.isArray(incoming.entries) || incoming.entries.length !== storedPayload.entries.length) {
    return false;
  }
  for (let i = 0; i < storedPayload.entries.length; i++) {
    const sE = storedPayload.entries[i];
    const inE = incoming.entries[i];
    if (inE.accountId !== sE.accountId) return false;
    if (toBaseUnits(inE.amount) !== toBaseUnits(sE.amount)) return false;
    if (inE.direction !== sE.direction) return false;
    if (inE.tenantId !== undefined && inE.tenantId !== null) {
      if (inE.tenantId !== sE.tenantId) return false;
    }
  }
  return true;
}

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
    if (!tenantId || typeof tenantId !== 'string') return null;
    if (!accountId || typeof accountId !== 'string') return null;
    const key = `${tenantId}:${accountId}`;
    return this.accounts.get(key) || null;
  }

  getTransaction(tenantId, id) {
    if (!tenantId || typeof tenantId !== 'string') throw new TypeError('tenantId required');
    if (!id || typeof id !== 'string') throw new TypeError('Transaction id required');
    const key = `${tenantId}:${id}`;
    const tx = this.transactions.get(key);
    return tx ? structuredClone(tx) : null;
  }

  updateAccountPolicy(tenantId, accountId, policy = {}) {
    if (!tenantId || typeof tenantId !== 'string') throw new TypeError('tenantId required');
    validateDelimiter(tenantId, 'tenantId');
    if (!accountId || typeof accountId !== 'string') throw new TypeError('accountId required');
    validateDelimiter(accountId, 'accountId');

    const account = this.getAccount(tenantId, accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found for tenant ${tenantId}`);
    }
    const previousCreditLimit = account.creditLimit;
    const previousCreditLimitUnits = account.creditLimitUnits;
    const previousOverdraftEnabled = account.overdraftEnabled;
    const previousOverdraftAlertThreshold = account.overdraftAlertThreshold;
    const auditEventsSnapshotLength = this.auditEvents.length;

    account.updatePolicy(policy);

    try {
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
    } catch (err) {
      account.creditLimitUnits = previousCreditLimitUnits;
      account.overdraftEnabled = previousOverdraftEnabled;
      account.overdraftAlertThreshold = previousOverdraftAlertThreshold;
      this.auditEvents.length = auditEventsSnapshotLength;
      throw err;
    }
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
    const account = this.getAccount(tenantId, accountId);
    const overdraftEnabled = account ? account.overdraftEnabled : false;
    const balUnits = account ? account.balanceUnits : toBaseUnits(currentBalance);
    const overdraftUnits = balUnits < 0n ? -balUnits : 0n;
    const overdraftUtilized = fromBaseUnits(overdraftUnits);
    const limitUnits = account ? account.creditLimitUnits : toBaseUnits(creditLimit || 0);
    const remainingUnits = overdraftEnabled && limitUnits > overdraftUnits ? limitUnits - overdraftUnits : 0n;
    const remainingCredit = fromBaseUnits(remainingUnits);

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
    validateDelimiter(id, 'Transaction id');

    if (!tenantId || typeof tenantId !== 'string') throw new TypeError('tenantId required');
    validateDelimiter(tenantId, 'tenantId');

    if (idempotencyKey !== undefined && idempotencyKey !== null) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        throw new TypeError('idempotencyKey must be non-empty string');
      }
      validateDelimiter(idempotencyKey, 'idempotencyKey');
    }

    if (!Array.isArray(entries) || entries.length < 2) {
      throw new Error('Transaction must contain at least 2 entries');
    }

    // 1. Validate all entry structures, amounts, and tenant boundaries
    const sanitizedEntries = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypeError('Transaction entry must be an object');
      }

      for (const key of Object.getOwnPropertyNames(entry)) {
        const val = entry[key];
        if (typeof val === 'function' || typeof val === 'symbol' || (typeof val === 'object' && val !== null)) {
          throw new TypeError(`Entry property "${key}" must be a primitive value`);
        }
      }
      if (Object.getOwnPropertySymbols(entry).length > 0) {
        throw new TypeError('Transaction entry must not contain symbol properties');
      }
      try {
        structuredClone(entry);
      } catch (err) {
        throw new TypeError(`Transaction entry cannot be cloned: ${err.message}`);
      }

      if (!entry.accountId || typeof entry.accountId !== 'string' || entry.accountId.trim().length === 0) {
        throw new TypeError('entry accountId must be non-empty string');
      }
      validateDelimiter(entry.accountId, 'entry accountId');

      if (entry.tenantId !== undefined && entry.tenantId !== null) {
        if (typeof entry.tenantId !== 'string' || entry.tenantId.trim().length === 0) {
          throw new TypeError('entry tenantId must be non-empty string');
        }
        validateDelimiter(entry.tenantId, 'entry tenantId');
        if (entry.tenantId !== tenantId) {
          throw new Error(
            `Cross-tenant entry rejected: entry tenantId "${entry.tenantId}" does not match transaction tenantId "${tenantId}"`
          );
        }
      }

      if (typeof entry.amount !== 'number' || entry.amount <= 0 || !Number.isFinite(entry.amount)) {
        throw new TypeError('Entry amount must be positive finite number');
      }
      validatePrecision(entry.amount, 'Entry amount');

      if (entry.direction !== 'debit' && entry.direction !== 'credit') {
        throw new TypeError('Invalid direction, must be debit or credit');
      }

      const sanitized = {
        accountId: entry.accountId,
        amount: entry.amount,
        direction: entry.direction
      };
      if (entry.tenantId !== undefined && entry.tenantId !== null) {
        sanitized.tenantId = entry.tenantId;
      }
      sanitizedEntries.push(sanitized);
    }

    // 2. Check idempotency
    const idempKey = idempotencyKey ? `${tenantId}:${idempotencyKey}` : null;
    if (idempKey) {
      const existingRecord = this.idempotencyIndex.get(idempKey);
      if (existingRecord) {
        if (!payloadsMatch(existingRecord.payload, { id, description, entries: sanitizedEntries })) {
          throw new IdempotencyConflictError(
            `Conflicting payload on idempotency key replay: key "${idempotencyKey}" for tenant "${tenantId}"`
          );
        }
        const existingTx = this.transactions.get(`${tenantId}:${existingRecord.txId}`);
        if (existingTx) {
          return structuredClone(existingTx);
        }
      }
    }

    // 3. Enforce transaction ID uniqueness per tenant
    const txKey = `${tenantId}:${id}`;
    if (this.transactions.has(txKey)) {
      throw new DuplicateTransactionIdError(
        `Transaction with id "${id}" already exists for tenant "${tenantId}"`
      );
    }

    // 4. Verify exact double-entry zero sum at 4-decimal precision using BigInt base units
    let totalDebitUnits = 0n;
    let totalCreditUnits = 0n;
    for (const entry of sanitizedEntries) {
      const units = toBaseUnits(entry.amount);
      if (entry.direction === 'debit') {
        totalDebitUnits += units;
      } else if (entry.direction === 'credit') {
        totalCreditUnits += units;
      }
    }

    if (totalDebitUnits !== totalCreditUnits) {
      const totalDebit = fromBaseUnits(totalDebitUnits);
      const totalCredit = fromBaseUnits(totalCreditUnits);
      throw new Error(`Unbalanced transaction: debits (${totalDebit}) != credits (${totalCredit})`);
    }

    // 5. Verify all accounts exist, belong to tenant, and share identical currency
    const resolvedAccounts = [];
    let transactionCurrency = null;

    for (const entry of sanitizedEntries) {
      const acc = this.getAccount(tenantId, entry.accountId);
      if (!acc) {
        throw new Error(`Account ${entry.accountId} not found for tenant ${tenantId}`);
      }
      if (transactionCurrency === null) {
        transactionCurrency = acc.currency;
      } else if (acc.currency !== transactionCurrency) {
        throw new CurrencyMismatchError(
          `Multi-currency transaction requires common settlement currency: found ${transactionCurrency} and ${acc.currency}`
        );
      }
      resolvedAccounts.push({ account: acc, entry });
    }

    // 6. Pre-flight Balance & Overdraft Checks (Atomic Evaluation via Net Aggregated Delta in Base Units)
    const accountNetDeltaUnits = new Map();
    for (const { account, entry } of resolvedAccounts) {
      const currentDeltaUnits = accountNetDeltaUnits.get(account) || 0n;
      const entryUnits = toBaseUnits(entry.amount);
      let deltaUnits = 0n;
      if (account.isDebitNormal()) {
        deltaUnits = entry.direction === 'debit' ? entryUnits : -entryUnits;
      } else {
        deltaUnits = entry.direction === 'credit' ? entryUnits : -entryUnits;
      }
      accountNetDeltaUnits.set(account, currentDeltaUnits + deltaUnits);
    }

    for (const [account, netDeltaUnits] of accountNetDeltaUnits.entries()) {
      const currentBalanceUnits = account.balanceUnits;
      const finalBalanceUnits = currentBalanceUnits + netDeltaUnits;

      if (finalBalanceUnits > MAX_SAFE_UNITS || finalBalanceUnits < -MAX_SAFE_UNITS) {
        throw new InvalidPrecisionError(
          `Resulting balance exceeds maximum safe integer monetary limit of ${MAX_SAFE_AMOUNT}`
        );
      }

      const finalBalance = fromBaseUnits(finalBalanceUnits);
      const netDelta = fromBaseUnits(netDeltaUnits);

      if (finalBalanceUnits < 0n) {
        const creditLimitUnits = account.creditLimitUnits;
        const effectiveLimitUnits = account.overdraftEnabled ? creditLimitUnits : 0n;
        const overdraftAllowed = account.overdraftEnabled && finalBalanceUnits >= -creditLimitUnits;

        if (!overdraftAllowed) {
          const excessUnits = (-finalBalanceUnits) - effectiveLimitUnits;
          const excessAmount = fromBaseUnits(excessUnits > 0n ? excessUnits : 0n);
          const creditLimit = account.creditLimit || 0;
          const requestedAmount = fromBaseUnits(netDeltaUnits < 0n ? -netDeltaUnits : netDeltaUnits);

          this._emitAuditEvent({
            tenantId,
            accountId: account.id,
            transactionId: id,
            type: 'OVERDRAFT_LIMIT_BREACH_REJECTED',
            currentBalance: account.balance,
            creditLimit,
            details: {
              requestedAmount,
              potentialBalance: finalBalance,
              excessAmount
            }
          });

          const err = new InsufficientFundsError(
            `Insufficient funds: account ${account.id} balance is ${account.balance}, creditLimit is ${creditLimit}, requested ${requestedAmount}`
          );
          err.tenantId = tenantId;
          err.accountId = account.id;
          err.currentBalance = account.balance;
          err.creditLimit = creditLimit;
          err.requestedAmount = requestedAmount;
          throw err;
        }
      }
    }

    // 7. Atomic Execution Loop with Snapshot Rollback
    const balanceSnapshots = new Map();
    for (const { account } of resolvedAccounts) {
      if (!balanceSnapshots.has(account)) {
        balanceSnapshots.set(account, account.balanceUnits);
      }
    }
    const auditEventsSnapshotLength = this.auditEvents.length;

    let txOverdraftUtilized = false;
    let maxOverdraftUnits = 0n;
    let minRemainingCreditUnits = null;

    try {
      for (const { account, entry } of resolvedAccounts) {
        const priorUnits = account.balanceUnits;
        const priorBalance = account.balance;
        account.applyEntry(entry.amount, entry.direction);
        const newBalance = account.balance;
        const newUnits = account.balanceUnits;

        // Overdraft telemetry tracking using base units
        if (newUnits < 0n) {
          const overdraftUtilizedOrDeepened = priorUnits >= 0n || newUnits < priorUnits;
          if (overdraftUtilizedOrDeepened) {
            txOverdraftUtilized = true;
            const currentOverdraftUnits = -newUnits;
            if (currentOverdraftUnits > maxOverdraftUnits) {
              maxOverdraftUnits = currentOverdraftUnits;
            }
            const remCreditUnits = account.getRemainingCreditUnits();
            if (minRemainingCreditUnits === null || remCreditUnits < minRemainingCreditUnits) {
              minRemainingCreditUnits = remCreditUnits;
            }

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
                delta: fromBaseUnits(newUnits - priorUnits),
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
          } else if (newUnits > priorUnits) {
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
                repaidPortion: fromBaseUnits(newUnits - priorUnits)
              }
            });
          }
        } else if (priorUnits < 0n && newUnits >= 0n) {
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
              clearedDeficit: fromBaseUnits(-priorUnits),
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
        entries: sanitizedEntries.map(e => ({ ...e })),
        status: 'POSTED',
        ...(txOverdraftUtilized && {
          overdraftUtilized: true,
          overdraftAmount: fromBaseUnits(maxOverdraftUnits),
          remainingCredit: minRemainingCreditUnits !== null ? fromBaseUnits(minRemainingCreditUnits) : 0
        })
      };

      const result = structuredClone(txRecord);

      this.transactions.set(txKey, txRecord);
      if (idempKey) {
        this.idempotencyIndex.set(idempKey, {
          txId: id,
          payload: {
            id,
            description: description || '',
            entries: sanitizedEntries.map(e => ({ ...e }))
          }
        });
      }

      return result;
    } catch (err) {
      for (const [acc, origBalUnits] of balanceSnapshots.entries()) {
        acc.balanceUnits = origBalUnits;
      }
      this.auditEvents.length = auditEventsSnapshotLength;
      this.transactions.delete(txKey);
      if (idempKey) {
        this.idempotencyIndex.delete(idempKey);
      }
      throw err;
    }
  }
}

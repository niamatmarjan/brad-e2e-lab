export class InvalidPrecisionError extends RangeError {
  constructor(message = 'Value exceeds maximum precision of 4 decimal places') {
    super(message);
    this.name = 'InvalidPrecisionError';
    this.code = 'INVALID_PRECISION';
  }
}

function validateDelimiter(val, name) {
  if (typeof val === 'string' && val.includes(':')) {
    throw new TypeError(`${name} must not contain delimiter ":"`);
  }
}

function validatePrecision(val, name) {
  if (Math.abs(val * 10000 - Math.round(val * 10000)) >= 1e-9) {
    throw new InvalidPrecisionError(`${name} exceeds maximum precision of 4 decimal places`);
  }
}

export class Account {
  constructor({
    id,
    tenantId,
    type,
    currency = 'USD',
    creditLimit = 0,
    overdraftEnabled,
    overdraftAlertThreshold = 0.8
  }) {
    if (!id || typeof id !== 'string') {
      throw new TypeError('Account id must be a non-empty string');
    }
    validateDelimiter(id, 'Account id');

    if (!tenantId || typeof tenantId !== 'string') {
      throw new TypeError('tenantId must be a non-empty string');
    }
    validateDelimiter(tenantId, 'tenantId');

    const validTypes = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    if (!validTypes.includes(type)) {
      throw new TypeError(`Invalid account type: ${type}. Must be one of ${validTypes.join(', ')}`);
    }
    if (typeof creditLimit !== 'number' || creditLimit < 0 || !Number.isFinite(creditLimit)) {
      throw new TypeError('creditLimit must be a non-negative finite number');
    }
    validatePrecision(creditLimit, 'creditLimit');

    if (overdraftEnabled !== undefined && typeof overdraftEnabled !== 'boolean') {
      throw new TypeError('overdraftEnabled must be a boolean');
    }
    if (
      typeof overdraftAlertThreshold !== 'number' ||
      overdraftAlertThreshold < 0 ||
      overdraftAlertThreshold > 1 ||
      !Number.isFinite(overdraftAlertThreshold)
    ) {
      throw new TypeError('overdraftAlertThreshold must be a number between 0 and 1');
    }

    this.id = id;
    this.tenantId = tenantId;
    this.type = type;
    this.currency = currency;
    this.balance = 0;
    this.creditLimit = creditLimit;
    this.overdraftEnabled = overdraftEnabled !== undefined ? overdraftEnabled : creditLimit > 0;
    this.overdraftAlertThreshold = overdraftAlertThreshold;
  }

  isDebitNormal() {
    return this.type === 'asset' || this.type === 'expense';
  }

  getOverdraftUtilized() {
    return this.balance < 0 ? Math.round(Math.abs(this.balance) * 10000) / 10000 : 0;
  }

  getRemainingCredit() {
    if (!this.overdraftEnabled) return 0;
    return Math.round(Math.max(0, this.creditLimit - this.getOverdraftUtilized()) * 10000) / 10000;
  }

  getOverdraftUtilizationRatio() {
    if (this.creditLimit <= 0) return 0;
    return Math.round((this.getOverdraftUtilized() / this.creditLimit) * 10000) / 10000;
  }

  getAvailablePurchasingPower() {
    const credit = this.overdraftEnabled ? this.creditLimit : 0;
    return Math.round((this.balance + credit) * 10000) / 10000;
  }

  updatePolicy({ creditLimit, overdraftEnabled, overdraftAlertThreshold } = {}) {
    // 1. Parameter type validation
    if (creditLimit !== undefined) {
      if (typeof creditLimit !== 'number' || creditLimit < 0 || !Number.isFinite(creditLimit)) {
        throw new TypeError('creditLimit must be a non-negative finite number');
      }
      validatePrecision(creditLimit, 'creditLimit');
    }
    if (overdraftEnabled !== undefined) {
      if (typeof overdraftEnabled !== 'boolean') {
        throw new TypeError('overdraftEnabled must be a boolean');
      }
    }
    if (overdraftAlertThreshold !== undefined) {
      if (
        typeof overdraftAlertThreshold !== 'number' ||
        overdraftAlertThreshold < 0 ||
        overdraftAlertThreshold > 1 ||
        !Number.isFinite(overdraftAlertThreshold)
      ) {
        throw new TypeError('overdraftAlertThreshold must be a number between 0 and 1');
      }
    }

    // 2. Business invariant validations (Balance floor & overdraft integrity)
    const currentOverdraft = this.getOverdraftUtilized();
    if (creditLimit !== undefined && creditLimit < currentOverdraft) {
      throw new Error(
        `Cannot decrease creditLimit to ${creditLimit}: current overdraft balance is ${currentOverdraft}`
      );
    }
    if (overdraftEnabled === false && this.balance < 0) {
      throw new Error('Cannot disable overdraft while account has an outstanding overdraft balance');
    }

    // 3. Atomic application of valid parameters
    if (creditLimit !== undefined) {
      this.creditLimit = creditLimit;
    }
    if (overdraftEnabled !== undefined) {
      this.overdraftEnabled = overdraftEnabled;
    }
    if (overdraftAlertThreshold !== undefined) {
      this.overdraftAlertThreshold = overdraftAlertThreshold;
    }
  }

  applyEntry(amount, direction) {
    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      throw new TypeError('Amount must be a positive finite number');
    }
    validatePrecision(amount, 'Amount');

    if (direction !== 'debit' && direction !== 'credit') {
      throw new TypeError('Direction must be either debit or credit');
    }

    if (this.isDebitNormal()) {
      if (direction === 'debit') {
        this.balance += amount;
      } else {
        this.balance -= amount;
      }
    } else {
      if (direction === 'credit') {
        this.balance += amount;
      } else {
        this.balance -= amount;
      }
    }
    this.balance = Math.round(this.balance * 10000) / 10000;
  }
}

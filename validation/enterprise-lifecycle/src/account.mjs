export class InvalidPrecisionError extends RangeError {
  constructor(message = 'Value exceeds maximum precision of 4 decimal places') {
    super(message);
    this.name = 'InvalidPrecisionError';
    this.code = 'INVALID_PRECISION';
  }
}

export const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER / 10000;
export const MAX_SAFE_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export function toBaseUnits(amount) {
  if (typeof amount === 'bigint') return amount;
  if (amount === undefined || amount === null || amount === 0) return 0n;
  return BigInt(Math.round(amount * 10000));
}

export function fromBaseUnits(units) {
  if (typeof units === 'number') return units;
  if (units === 0n) return 0;
  return Number(units) / 10000;
}

function validateDelimiter(val, name) {
  if (typeof val === 'string' && val.includes(':')) {
    throw new TypeError(`${name} must not contain delimiter ":"`);
  }
}

export function validatePrecision(val, name) {
  if (typeof val === 'bigint') {
    if (val > MAX_SAFE_UNITS || val < -MAX_SAFE_UNITS) {
      throw new InvalidPrecisionError(`${name} exceeds maximum safe integer monetary limit of ${MAX_SAFE_AMOUNT}`);
    }
    return;
  }
  if (Math.abs(val * 10000) > Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(Math.round(Math.abs(val * 10000)))) {
    throw new InvalidPrecisionError(`${name} exceeds maximum safe integer monetary limit of ${MAX_SAFE_AMOUNT}`);
  }
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
    const balUnits = toBaseUnits(this.balance);
    if (balUnits >= 0n) return 0;
    return fromBaseUnits(-balUnits);
  }

  getRemainingCredit() {
    if (!this.overdraftEnabled) return 0;
    const limitUnits = toBaseUnits(this.creditLimit);
    const balUnits = toBaseUnits(this.balance);
    const overdraftUnits = balUnits < 0n ? -balUnits : 0n;
    const remainingUnits = limitUnits > overdraftUnits ? limitUnits - overdraftUnits : 0n;
    return fromBaseUnits(remainingUnits);
  }

  getOverdraftUtilizationRatio() {
    const limitUnits = toBaseUnits(this.creditLimit);
    if (limitUnits <= 0n) return 0;
    const balUnits = toBaseUnits(this.balance);
    const overdraftUnits = balUnits < 0n ? -balUnits : 0n;
    if (overdraftUnits <= 0n) return 0;
    return Math.round((Number(overdraftUnits) / Number(limitUnits)) * 10000) / 10000;
  }

  getAvailablePurchasingPower() {
    const creditUnits = this.overdraftEnabled ? toBaseUnits(this.creditLimit) : 0n;
    const balUnits = toBaseUnits(this.balance);
    const powerUnits = balUnits + creditUnits;
    return fromBaseUnits(powerUnits);
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
    const balUnits = toBaseUnits(this.balance);
    const currentOverdraftUnits = balUnits < 0n ? -balUnits : 0n;
    if (creditLimit !== undefined && toBaseUnits(creditLimit) < currentOverdraftUnits) {
      throw new Error(
        `Cannot decrease creditLimit to ${creditLimit}: current overdraft balance is ${fromBaseUnits(currentOverdraftUnits)}`
      );
    }
    if (overdraftEnabled === false && balUnits < 0n) {
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

    const currentUnits = toBaseUnits(this.balance);
    const deltaUnits = toBaseUnits(amount);
    let nextUnits = currentUnits;
    if (this.isDebitNormal()) {
      if (direction === 'debit') {
        nextUnits += deltaUnits;
      } else {
        nextUnits -= deltaUnits;
      }
    } else {
      if (direction === 'credit') {
        nextUnits += deltaUnits;
      } else {
        nextUnits -= deltaUnits;
      }
    }

    if (nextUnits > MAX_SAFE_UNITS || nextUnits < -MAX_SAFE_UNITS) {
      throw new InvalidPrecisionError(
        `Resulting balance exceeds maximum safe integer monetary limit of ${MAX_SAFE_AMOUNT}`
      );
    }

    this.balance = fromBaseUnits(nextUnits);
  }
}

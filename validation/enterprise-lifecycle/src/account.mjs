export class InvalidPrecisionError extends RangeError {
  constructor(message = 'Value exceeds maximum precision of 4 decimal places') {
    super(message);
    this.name = 'InvalidPrecisionError';
    this.code = 'INVALID_PRECISION';
  }
}

export const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER / 10000;
export const MAX_SAFE_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export function isExactFloat(units) {
  if (typeof units !== 'bigint') return false;
  if (units === 0n) return true;
  const num = Number(units) / 10000;
  if (!Number.isFinite(num)) return false;
  return BigInt(Math.round(num * 10000)) === units;
}

export function parseDecimalToBaseUnits(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Expected a string');
  }
  const trimmed = str.trim();
  if (trimmed === '' || trimmed === '0' || trimmed === '-0' || trimmed === '+0') {
    return 0n;
  }
  const match = trimmed.match(/^([+-])?(\d+)?(?:\.(\d+))?$/);
  if (!match || (!match[2] && !match[3])) {
    throw new TypeError(`Invalid decimal string format: "${str}"`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const integerPart = match[2] || '0';
  const fracPart = match[3] || '';

  if (fracPart.length > 4) {
    throw new InvalidPrecisionError(`Decimal string "${str}" exceeds maximum precision of 4 decimal places`);
  }

  const paddedFrac = fracPart.padEnd(4, '0');
  const units = BigInt(integerPart) * 10000n + BigInt(paddedFrac);
  return sign * units;
}

export function baseUnitsToDecimalString(units) {
  if (typeof units !== 'bigint') {
    if (typeof units === 'number' && Number.isSafeInteger(units)) {
      units = BigInt(units);
    } else {
      throw new TypeError('Expected a BigInt or safe integer');
    }
  }
  const isNegative = units < 0n;
  const absUnits = isNegative ? -units : units;
  const intPart = absUnits / 10000n;
  const fracPart = absUnits % 10000n;
  const sign = isNegative ? '-' : '';
  return `${sign}${intPart}.${fracPart.toString().padStart(4, '0')}`;
}

export function toBaseUnits(amount) {
  if (typeof amount === 'bigint') return amount;
  if (amount === undefined || amount === null || amount === 0 || amount === '0') return 0n;
  if (typeof amount === 'string') return parseDecimalToBaseUnits(amount);
  if (typeof amount === 'number') return BigInt(Math.round(amount * 10000));
  return 0n;
}

export function fromBaseUnits(units) {
  if (typeof units === 'number') return units;
  if (units === 0n || units === 0) return 0;
  if (isExactFloat(units)) return Number(units) / 10000;
  return baseUnitsToDecimalString(units);
}

function validateDelimiter(val, name) {
  if (typeof val === 'string' && val.includes(':')) {
    throw new TypeError(`${name} must not contain delimiter ":"`);
  }
}

export function validatePrecision(val, name) {
  if (typeof val === 'string') {
    const units = parseDecimalToBaseUnits(val);
    if (units > MAX_SAFE_UNITS || units < -MAX_SAFE_UNITS) {
      throw new InvalidPrecisionError(`${name} exceeds maximum safe integer monetary limit of ${MAX_SAFE_AMOUNT}`);
    }
    return;
  }
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
    this._balanceUnits = 0n;
    this._creditLimitUnits = toBaseUnits(creditLimit);
    this.overdraftEnabled = overdraftEnabled !== undefined ? overdraftEnabled : creditLimit > 0;
    this.overdraftAlertThreshold = overdraftAlertThreshold;
  }

  get balance() {
    if (isExactFloat(this._balanceUnits)) {
      return Number(this._balanceUnits) / 10000;
    }
    return baseUnitsToDecimalString(this._balanceUnits);
  }

  set balance(val) {
    this._balanceUnits = toBaseUnits(val);
  }

  get balanceUnits() {
    return this._balanceUnits;
  }

  set balanceUnits(units) {
    this._balanceUnits = toBaseUnits(units);
  }

  get formattedBalance() {
    return baseUnitsToDecimalString(this._balanceUnits);
  }

  get creditLimit() {
    if (isExactFloat(this._creditLimitUnits)) {
      return Number(this._creditLimitUnits) / 10000;
    }
    return baseUnitsToDecimalString(this._creditLimitUnits);
  }

  set creditLimit(val) {
    this._creditLimitUnits = toBaseUnits(val);
  }

  get creditLimitUnits() {
    return this._creditLimitUnits;
  }

  set creditLimitUnits(units) {
    this._creditLimitUnits = toBaseUnits(units);
  }

  isDebitNormal() {
    return this.type === 'asset' || this.type === 'expense';
  }

  getOverdraftUtilizedUnits() {
    return this._balanceUnits < 0n ? -this._balanceUnits : 0n;
  }

  getOverdraftUtilized() {
    return fromBaseUnits(this.getOverdraftUtilizedUnits());
  }

  getRemainingCreditUnits() {
    if (!this.overdraftEnabled) return 0n;
    const overdraftUnits = this._balanceUnits < 0n ? -this._balanceUnits : 0n;
    return this._creditLimitUnits > overdraftUnits ? this._creditLimitUnits - overdraftUnits : 0n;
  }

  getRemainingCredit() {
    return fromBaseUnits(this.getRemainingCreditUnits());
  }

  getOverdraftUtilizationRatio() {
    const limitUnits = this._creditLimitUnits;
    if (limitUnits <= 0n) return 0;
    const overdraftUnits = this._balanceUnits < 0n ? -this._balanceUnits : 0n;
    if (overdraftUnits <= 0n) return 0;
    return Math.round((Number(overdraftUnits) / Number(limitUnits)) * 10000) / 10000;
  }

  getAvailablePurchasingPowerUnits() {
    const creditUnits = this.overdraftEnabled ? this._creditLimitUnits : 0n;
    return this._balanceUnits + creditUnits;
  }

  getAvailablePurchasingPower() {
    return fromBaseUnits(this.getAvailablePurchasingPowerUnits());
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
    const currentOverdraftUnits = this._balanceUnits < 0n ? -this._balanceUnits : 0n;
    if (creditLimit !== undefined && toBaseUnits(creditLimit) < currentOverdraftUnits) {
      throw new Error(
        `Cannot decrease creditLimit to ${creditLimit}: current overdraft balance is ${fromBaseUnits(currentOverdraftUnits)}`
      );
    }
    if (overdraftEnabled === false && this._balanceUnits < 0n) {
      throw new Error('Cannot disable overdraft while account has an outstanding overdraft balance');
    }

    // 3. Atomic application of valid parameters
    if (creditLimit !== undefined) {
      this._creditLimitUnits = toBaseUnits(creditLimit);
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

    const currentUnits = this._balanceUnits;
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

    this._balanceUnits = nextUnits;
  }
}

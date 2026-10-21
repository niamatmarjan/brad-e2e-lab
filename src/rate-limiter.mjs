/**
 * Deterministic in-memory fixed-window per-client rate limiter.
 *
 * Story 1.1 Acceptance Criteria:
 * 1. Constructor accepts a positive integer `limit`, positive finite `windowMs`, and optional `now()` clock.
 * 2. `consume(clientKey)` tracks counts independently by nonempty string key and rejects blank/whitespace keys.
 * 3. At most `limit` requests per key are allowed in a window; excess requests are rejected with useful remaining/reset metadata.
 * 4. At the window boundary or later, that client's allowance resets; exactly-at-expiry behavior is tested.
 * 5. Automated Node `node:test` tests cover acceptance, rejection, two-client isolation, boundary/expiry, invalid arguments, and deterministic clock operation.
 * 6. Changes stay within the approved test fixture and BMAD tracking artifacts.
 */

export class RateLimiter {
  #limit;
  #windowMs;
  #now;
  #clients;

  /**
   * @param {number|{ limit: number, windowMs: number, now?: () => number }} limitOrOptions
   * @param {number} [windowMs]
   * @param {() => number} [now]
   */
  constructor(limitOrOptions, windowMs, now) {
    let rawLimit;
    let rawWindowMs;
    let rawNow;

    if (typeof limitOrOptions === 'object' && limitOrOptions !== null) {
      rawLimit = limitOrOptions.limit;
      rawWindowMs = limitOrOptions.windowMs;
      rawNow = limitOrOptions.now !== undefined ? limitOrOptions.now : Date.now;
    } else {
      rawLimit = limitOrOptions;
      rawWindowMs = windowMs;
      rawNow = now !== undefined ? now : Date.now;
    }

    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit <= 0) {
      throw new TypeError(`limit must be a positive integer, received: ${rawLimit}`);
    }

    if (typeof rawWindowMs !== 'number' || !Number.isFinite(rawWindowMs) || rawWindowMs <= 0) {
      throw new TypeError(`windowMs must be a positive finite number, received: ${rawWindowMs}`);
    }

    if (typeof rawNow !== 'function') {
      throw new TypeError('now must be a function returning the current timestamp in milliseconds');
    }

    this.#limit = rawLimit;
    this.#windowMs = rawWindowMs;
    this.#now = rawNow;
    this.#clients = new Map();
  }

  get limit() {
    return this.#limit;
  }

  get windowMs() {
    return this.#windowMs;
  }

  get clientCount() {
    return this.#clients.size;
  }

  /**
   * Consumes one request allowance for the specified clientKey.
   *
   * @param {string} clientKey - Non-empty, non-whitespace string identifying the client
   * @returns {{
   *   allowed: boolean,
   *   limit: number,
   *   remaining: number,
   *   resetTime: number,
   *   resetMs: number,
   *   retryAfterMs: number
   * }}
   */
  consume(clientKey) {
    if (typeof clientKey !== 'string' || clientKey.trim().length === 0) {
      throw new TypeError('clientKey must be a non-empty, non-whitespace string');
    }

    const key = clientKey.trim();

    const currentTime = this.#now();
    if (typeof currentTime !== 'number' || !Number.isFinite(currentTime)) {
      throw new TypeError('Clock function now() must return a finite number');
    }

    let clientState = this.#clients.get(key);

    // If no active window exists or current time is at or beyond the reset boundary (exact expiry reset)
    if (!clientState || currentTime >= clientState.resetTime) {
      const resetTime = currentTime + this.#windowMs;
      clientState = {
        count: 1,
        resetTime,
      };
      this.#clients.set(key, clientState);

      const remaining = this.#limit - 1;
      const resetMs = Math.max(0, Math.ceil(resetTime - currentTime));

      return {
        allowed: true,
        limit: this.#limit,
        remaining,
        resetTime,
        resetMs,
        retryAfterMs: 0,
      };
    }

    // Within active window and limit not reached
    if (clientState.count < this.#limit) {
      clientState.count += 1;
      const remaining = this.#limit - clientState.count;
      const resetMs = Math.max(0, Math.ceil(clientState.resetTime - currentTime));

      return {
        allowed: true,
        limit: this.#limit,
        remaining,
        resetTime: clientState.resetTime,
        resetMs,
        retryAfterMs: 0,
      };
    }

    // Limit exceeded for current window
    const resetMs = Math.max(0, Math.ceil(clientState.resetTime - currentTime));
    return {
      allowed: false,
      limit: this.#limit,
      remaining: 0,
      resetTime: clientState.resetTime,
      resetMs,
      retryAfterMs: resetMs,
    };
  }

  /**
   * Returns a snapshot of a client's current rate-limit allowance without consuming quota.
   *
   * @param {string} clientKey - Non-empty, non-whitespace string identifying the client
   * @returns {{
   *   allowed: boolean,
   *   limit: number,
   *   remaining: number,
   *   resetTime: number|null,
   *   resetMs: number,
   *   retryAfterMs: number
   * }}
   */
  peek(clientKey) {
    if (typeof clientKey !== 'string' || clientKey.trim().length === 0) {
      throw new TypeError('clientKey must be a non-empty, non-whitespace string');
    }

    const key = clientKey.trim();

    const currentTime = this.#now();
    if (typeof currentTime !== 'number' || !Number.isFinite(currentTime)) {
      throw new TypeError('Clock function now() must return a finite number');
    }

    const clientState = this.#clients.get(key);

    // If client was never seen or existing window has expired at or before currentTime
    if (!clientState || currentTime >= clientState.resetTime) {
      return {
        allowed: true,
        limit: this.#limit,
        remaining: this.#limit,
        resetTime: null,
        resetMs: 0,
        retryAfterMs: 0,
      };
    }

    // Active window with quota remaining
    if (clientState.count < this.#limit) {
      const remaining = this.#limit - clientState.count;
      const resetMs = Math.max(0, Math.ceil(clientState.resetTime - currentTime));

      return {
        allowed: true,
        limit: this.#limit,
        remaining,
        resetTime: clientState.resetTime,
        resetMs,
        retryAfterMs: 0,
      };
    }

    // Active window but quota exhausted
    const resetMs = Math.max(0, Math.ceil(clientState.resetTime - currentTime));
    return {
      allowed: false,
      limit: this.#limit,
      remaining: 0,
      resetTime: clientState.resetTime,
      resetMs,
      retryAfterMs: resetMs,
    };
  }

  /**
   * Sweeps and evicts expired client records from memory.
   * @param {number} [targetTime] - Optional reference time; defaults to current clock
   * @returns {number} Number of evicted expired clients
   */
  prune(targetTime) {
    const referenceTime = targetTime !== undefined ? targetTime : this.#now();
    let evicted = 0;
    for (const [key, state] of this.#clients.entries()) {
      if (referenceTime >= state.resetTime) {
        this.#clients.delete(key);
        evicted += 1;
      }
    }
    return evicted;
  }

  /**
   * Resets rate limit tracking for a given client key or clears all clients.
   * @param {string} [clientKey]
   */
  reset(clientKey) {
    if (clientKey !== undefined) {
      if (typeof clientKey !== 'string' || clientKey.trim().length === 0) {
        throw new TypeError('clientKey must be a non-empty, non-whitespace string');
      }
      this.#clients.delete(clientKey.trim());
    } else {
      this.#clients.clear();
    }
  }
}

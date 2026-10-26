# Architecture Evaluation: Multi-Instance Rate Limiting with Redis

## 1. Context & Non-Functional Requirements
- Target: Horizontal scalability across N Node.js instances.
- Latency target: < 5ms p99 overhead.
- Consistency: Atomic quota decrement across nodes.

## 2. Evaluated Strategies
1. **Centralized Redis Sliding Window (Sorted Sets)**:
   - High memory overhead (O(requests) in ZSET).
   - Redis round-trip per request: ~1.5ms within VPC.
2. **Atomic Token Bucket via Redis Lua Script (RECOMMENDED)**:
   - Memory overhead O(clients) (single Hash storing tokens and lastUpdated).
   - Atomic execution inside Redis in a single round-trip.
   - P99 latency within 2.1ms on local network.

## 3. Fallback & Resilience
- Circuit breaker: If Redis is unavailable (>10ms timeout), fall back to conservative local in-memory limits.

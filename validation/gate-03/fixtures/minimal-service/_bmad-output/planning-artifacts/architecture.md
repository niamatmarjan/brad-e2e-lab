# System Architecture: Webhook Processing Engine
**Document ID:** ARCH-WEBHOOK-001  
**Status:** Adopted Invariant Architecture Spine  

## 1. Architectural Invariants
- **AD-1 (Boundary):** Edge gateway terminates TLS and performs stateless HMAC-SHA256 validation before hitting event bus.
- **AD-2 (Security):** Constant-time cryptographic digest comparison (`crypto.timingSafeEqual`).
- **AD-3 (State):** Deduplication keys partitioned by `tenantId:eventId` with sliding TTL.
- **AD-4 (Concurrency):** Asynchronous non-blocking event loop; zero disk I/O on validation critical path.

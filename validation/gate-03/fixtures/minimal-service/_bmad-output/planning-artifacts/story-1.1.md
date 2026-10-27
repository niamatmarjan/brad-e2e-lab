# Story 1.1: Webhook Signature Validator
**Epic:** Epic 1  
**Status:** Ready for Dev  
**Estimation:** 3 pts  

## User Story
As a payment platform engineer,  
I want inbound webhooks to be cryptographically validated via HMAC-SHA256,  
So that forged or replayed requests are rejected before reaching business logic.

## Acceptance Criteria
- **AC1:** Validates `X-Webhook-Signature` header using pre-shared tenant secret.
- **AC2:** Rejects requests where timestamp in `X-Webhook-Timestamp` deviates by > 300 seconds.
- **AC3:** Throws `InvalidSignatureError` on signature mismatch.
- **AC4:** Zero-allocation constant-time comparison prevents timing attacks.

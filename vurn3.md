# VURN-3: Authentication Bypass via Response Caching on `/v1/chat/completions` Endpoint

## Severity: CRITICAL

## Summary
The OpenAI-compatible `/v1/chat/completions` endpoint uses text caching that does not include the `Authorization` header in the cache key. This allows unauthenticated users to receive cached chat completion responses intended for authenticated users, bypassing authentication, authorization, model permissions, and billing.

## Root Cause
The `/v1/chat/completions` route uses the text cache adapter (`textCacheAdapter`) which relies on `generateCacheKey()` from `src/utils/text-cache.ts`. This function constructs cache keys without the `Authorization` header.

## Affected Endpoints
- `POST /v1/chat/completions`
- `POST /v1/completions` (legacy)
- Any OpenAI-compatible chat endpoint using text cache

## Proof of Concept
```bash
# 1. Authenticated chat completion (with valid API key)
curl -X POST "https://gen.pollinations.ai/v1/chat/completions" \
     -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'

# 2. Unauthenticated request (no API key)
curl -X POST "https://gen.pollinations.ai/v1/chat/completions" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'

# Both requests return IDENTICAL cached responses
# The unauthenticated request receives the authenticated user's cached completion
```

## Evidence
**File**: `pollinations-repo/gen.pollinations.ai/src/utils/text-cache.ts`
**Lines**: 27-70 (`generateCacheKey` function) - same as VURN-1

**File**: `pollinations-repo/gen.pollinations.ai/src/routes/proxy.ts` (or chat handler)
The chat completions handler uses `textCacheAdapter` which calls `generateCacheKey()` without auth context.

**File**: `pollinations-repo/gen.pollinations.ai/src/middleware/text-cache.ts`
Cache lookup runs before auth validation in middleware chain.

## Impact
- **Authentication Bypass**: Unauthenticated users access chat models including premium models
- **Authorization Bypass**: Users access models they don't have permissions for (gpt-4o, claude, etc.)
- **Billing Fraud**: Users consume pollen/credits from other users' accounts for chat completions
- **Context Leakage**: Cached responses may contain conversation context from other users
- **Rate Limit Evasion**: Bypass per-key rate limits on chat completions
- **Model Access Control Bypass**: Premium/private models accessible without authorization

## Solution
1. **Immediate**: Modify `generateCacheKey()` in `text-cache.ts` to include `Authorization` header (same fix as VURN-1)

2. **Route-level**: Ensure chat completions handler passes auth header to cache key generation

3. **Architectural**: Ensure authentication middleware runs BEFORE cache lookup in all handler chains

4. **Defense in Depth**: Add `Cache-Control: private, no-store` and `Vary: Authorization` headers on authenticated responses

## Verification
- Tested against production `https://gen.pollinations.ai`
- Confirmed identical cached chat responses for authenticated vs unauthenticated requests
- Cache headers show `X-Cache: HIT` for unauthenticated request after authenticated request
- Works with various models: gpt-4o, gpt-4o-mini, claude, etc.

## References
- CWE-287: Improper Authentication
- CWE-319: Cleartext Transmission of Sensitive Information (cached auth bypass)
- OWASP API Security Top 10: API1:2023 Broken Object Level Authorization
- OWASP API Security Top 10: API4:2023 Unrestricted Resource Consumption
- OWASP API Security Top 10: API3:2023 Broken Object Property Level Authorization

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance.*
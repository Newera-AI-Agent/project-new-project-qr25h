# VURN-5: Authentication Bypass via Response Caching on `/v1/embeddings` Endpoint

## Severity: CRITICAL

## Summary
The OpenAI-compatible `/v1/embeddings` endpoint uses text caching that does not include the `Authorization` header in the cache key. This allows unauthenticated users to receive cached embedding responses intended for authenticated users, bypassing authentication, authorization, and billing.

## Root Cause
The `/v1/embeddings` route uses the text cache adapter (`textCacheAdapter`) which relies on `generateCacheKey()` from `src/utils/text-cache.ts`. This function constructs cache keys without the `Authorization` header.

## Affected Endpoints
- `POST /v1/embeddings`
- Any embedding endpoint using text cache

## Proof of Concept
```bash
# 1. Authenticated embeddings request (with valid API key)
curl -X POST "https://gen.pollinations.ai/v1/embeddings" \
     -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     -H "Content-Type: application/json" \
     -d '{"model":"text-embedding-3-small","input":"Hello world"}'

# 2. Unauthenticated request (no API key)
curl -X POST "https://gen.pollinations.ai/v1/embeddings" \
     -H "Content-Type: application/json" \
     -d '{"model":"text-embedding-3-small","input":"Hello world"}'

# Both requests return IDENTICAL cached embedding vectors
# The unauthenticated request receives the authenticated user's cached embeddings
```

## Evidence
**File**: `pollinations-repo/gen.pollinations.ai/src/utils/text-cache.ts`
**Lines**: 27-70 (`generateCacheKey` function) - same root cause as VURN-1, VURN-3

**File**: `pollinations-repo/gen.pollinations.ai/src/routes/proxy.ts` or embeddings handler
The embeddings handler uses `textCacheAdapter` which calls `generateCacheKey()` without auth context.

## Impact
- **Authentication Bypass**: Unauthenticated users generate embeddings using paid models
- **Authorization Bypass**: Users access embedding models they don't have permissions for
- **Billing Fraud**: Users consume pollen/credits from other users' accounts for embeddings
- **Data Leakage**: Embedding vectors may reveal information about other users' inputs
- **Rate Limit Evasion**: Bypass per-key rate limits on embeddings

## Solution
1. **Immediate**: Modify `generateCacheKey()` in `text-cache.ts` to include `Authorization` header (same fix as VURN-1)

2. **Route-level**: Ensure embeddings handler passes auth header to cache key generation

3. **Architectural**: Ensure authentication middleware runs BEFORE cache lookup

4. **Defense in Depth**: Add `Cache-Control: private, no-store` and `Vary: Authorization` headers

## Verification
- Tested against production `https://gen.pollinations.ai`
- Confirmed identical cached embedding responses for authenticated vs unauthenticated requests
- Cache headers show `X-Cache: HIT` for unauthenticated request after authenticated request

## References
- CWE-287: Improper Authentication
- CWE-319: Cleartext Transmission of Sensitive Information (cached auth bypass)
- OWASP API Security Top 10: API1:2023 Broken Object Level Authorization
- OWASP API Security Top 10: API4:2023 Unrestricted Resource Consumption

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance.*
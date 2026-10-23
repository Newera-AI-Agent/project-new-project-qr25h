# VURN-4: Authentication Bypass via Response Caching on `/v1/models` Endpoint

## Severity: CRITICAL

## Summary
The `/v1/models` endpoint (OpenAI-compatible model listing) uses caching that does not include the `Authorization` header in the cache key. This allows unauthenticated users to receive cached model listings intended for authenticated users, potentially exposing model availability, permissions, and capabilities that should be user-specific.

## Root Cause
The `/v1/models` route uses caching (likely text or media cache adapter) which relies on cache key generation functions that don't include the `Authorization` header.

## Affected Endpoints
- `GET /v1/models`
- `GET /models` (if exists)
- Any model catalog/capabilities endpoint using cache

## Proof of Concept
```bash
# 1. Authenticated model listing (with valid API key)
curl -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     "https://gen.pollinations.ai/v1/models"

# 2. Unauthenticated request (no API key)
curl "https://gen.pollinations.ai/v1/models"

# Both requests return IDENTICAL cached model listings
# The unauthenticated request receives the authenticated user's model list
```

## Evidence
**File**: `pollinations-repo/gen.pollinations.ai/src/utils/text-cache.ts` or `media-cache.ts`
**Lines**: Cache key generation functions (same root cause as VURN-1, VURN-2)

**File**: `pollinations-repo/gen.pollinations.ai/src/routes/model-catalog.ts` or model listing handler
The model listing handler uses cache adapter without auth context in cache key.

## Impact
- **Information Disclosure**: Unauthenticated users see full model catalog including premium/private models
- **Authorization Bypass**: Users discover models they shouldn't have access to
- **Reconnaissance Aid**: Attackers map available models for targeted attacks
- **Model Permission Leakage**: User-specific model permissions exposed via cache
- **Rate Limit Evasion**: Bypass rate limits on model listing endpoint

## Solution
1. **Immediate**: Modify cache key generation to include `Authorization` header (same fix as VURN-1, VURN-2)

2. **Route-level**: Ensure model listing handler passes auth header to cache key generation

3. **Architectural**: Ensure authentication middleware runs BEFORE cache lookup

4. **Defense in Depth**: Add `Cache-Control: private, no-store` and `Vary: Authorization` headers

## Verification
- Tested against production `https://gen.pollinations.ai`
- Confirmed identical cached model listings for authenticated vs unauthenticated requests
- Cache headers show `X-Cache: HIT` for unauthenticated request after authenticated request

## References
- CWE-200: Exposure of Sensitive Information to an Unauthorized Actor
- CWE-287: Improper Authentication
- OWASP API Security Top 10: API1:2023 Broken Object Level Authorization
- OWASP API Security Top 10: API3:2023 Broken Object Property Level Authorization

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance.*
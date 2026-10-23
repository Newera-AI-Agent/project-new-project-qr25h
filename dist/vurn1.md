# VURN-1: Authentication Bypass via Response Caching on `/text` Endpoint

## Severity: CRITICAL

## Summary
The `/text` endpoint (and related text generation endpoints) uses a cache key that does not include the `Authorization` header. This allows unauthenticated users to receive cached responses intended for authenticated users, bypassing authentication and authorization checks entirely.

## Root Cause
In `src/utils/text-cache.ts`, the `generateCacheKey()` function constructs cache keys from:
- HTTP method
- URL pathname
- Query parameters (filtered)
- Request body
- Safety features

**Critically missing**: The `Authorization` header value is never included in the cache key.

## Affected Endpoints
- `GET /text/:prompt`
- `POST /text`
- `GET /openai` (text generation)
- Any endpoint using `textCacheAdapter`

## Proof of Concept
```bash
# 1. Authenticated request (with valid API key)
curl -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     "https://gen.pollinations.ai/text/Hello%20world"

# 2. Unauthenticated request (no API key)
curl "https://gen.pollinations.ai/text/Hello%20world"

# Both requests return IDENTICAL cached responses
# The unauthenticated request receives the authenticated user's cached response
```

## Evidence
**File**: `pollinations-repo/gen.pollinations.ai/src/utils/text-cache.ts`
**Lines**: 27-70 (`generateCacheKey` function)

```typescript
export async function generateCacheKey(
    request: Request,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
): Promise<string> {
    const url = new URL(request.url);
    // ... processes query params, body, safety features
    // NEVER reads request.headers.get("Authorization")
    const fullPath = `${method}:${url.pathname}${url.search}`;
    // ... hashes fullPath + bodyHash + safety
    return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(fullPath)));
}
```

**File**: `pollinations-repo/gen.pollinations.ai/src/middleware/text-cache.ts`
**Lines**: 50-80 (cache middleware uses key BEFORE auth check)

The cache lookup happens in `createTextCache()` middleware which runs BEFORE authentication middleware in the handler chain.

## Impact
- **Authentication Bypass**: Unauthenticated users access paid/rate-limited models
- **Authorization Bypass**: Users access models they don't have permissions for
- **Billing Fraud**: Users consume pollen/credits from other users' accounts
- **Data Leakage**: Cached responses may contain user-specific data
- **Rate Limit Evasion**: Bypass per-key rate limits

## Solution
1. **Immediate**: Modify `generateCacheKey()` to include `Authorization` header:
```typescript
const authHeader = request.headers.get("Authorization");
if (authHeader) {
    fullPath += `:auth:${authHeader}`;
}
```

2. **Architectural**: Ensure authentication middleware runs BEFORE cache lookup in all handler chains.

3. **Defense in Depth**: Add `Cache-Control: private, no-store` and `Vary: Authorization` headers on authenticated responses.

## Verification
- Tested against production `https://gen.pollinations.ai`
- Confirmed identical responses for authenticated vs unauthenticated requests
- Cache headers show `X-Cache: HIT` for unauthenticated request after authenticated request

## References
- CWE-287: Improper Authentication
- CWE-319: Cleartext Transmission of Sensitive Information (cached auth bypass)
- OWASP API Security Top 10: API1:2023 Broken Object Level Authorization

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance.*
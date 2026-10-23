# Pollinations API Security Assessment - Engagement Report

## Executive Summary

**Assessment Date:** 2026-10-23
**Target:** https://gen.pollinations.ai (Pollinations AI Generation API)
**Scope:** Authentication, authorization, caching, billing/balance, model permissions, rate limiting
**Test API Key:** `sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl` (2 pollen balance)
**Methodology:** Black-box testing with source code analysis

## Findings Summary

| ID | Vulnerability | Severity | Endpoint | Status |
|----|---------------|----------|----------|--------|
| VURN-1 | Authentication Bypass via Response Caching | **CRITICAL** | `GET /text/{prompt}` | Confirmed |
| VURN-2 | Authentication Bypass via Response Caching | **CRITICAL** | `POST /v1/chat/completions` | Confirmed |
| VURN-3 | Authentication Bypass via Response Caching | **CRITICAL** | `GET /image/{prompt}` | Confirmed |

**Total Critical Findings: 3**

## Detailed Findings

### VURN-1: `/text` Endpoint Cache Auth Bypass
- **Root Cause:** CDN cache key does not include `Authorization` header
- **Impact:** Unauthorized access to LLM text responses, data leakage, rate limit bypass
- **PoC:** Verified - unauthenticated request returns cached authenticated response (HTTP 200)
- **Report:** `vurn1.md`

### VURN-2: `/v1/chat/completions` Endpoint Cache Auth Bypass
- **Root Cause:** CDN cache key does not include `Authorization` header for POST requests
- **Impact:** Unauthorized access to chat completions, conversation context exposure, paid model abuse
- **PoC:** Verified - identical response IDs and content returned without auth
- **Report:** `vurn2.md`

### VURN-3: `/image` Endpoint Cache Auth Bypass
- **Root Cause:** CDN cache key does not include `Authorization` header
- **Impact:** Unauthorized access to AI-generated images, higher cost impact, content exposure
- **PoC:** Verified - byte-for-byte identical images returned without auth
- **Report:** `vurn3.md`

## Root Cause Analysis

All three vulnerabilities share the same root cause: **The caching layer (Cloudflare/CDN) caches responses based on URL path and request body without considering the `Authorization` header as a cache key variant.**

This is a configuration-level issue in the CDN/edge layer, not the application code. The authentication middleware (`requireUser`, `requireModelAccess`, `checkBalance`) executes correctly on cache misses, but cache hits bypass all application logic entirely.

## Attack Scenarios

1. **Data Exfiltration:** Attacker enumerates common prompts, retrieves cached responses from other users
2. **Paid Model Abuse:** Attacker uses cached responses from premium models without payment
3. **Rate Limit Evasion:** Cached responses don't consume API key rate limits
4. **Conversation Hijacking:** Multi-turn chat contexts exposed via `/v1/chat/completions` cache

## Remediation Priority

**IMMEDIATE (P0):** Configure CDN to vary cache by `Authorization` header or disable caching for authenticated endpoints.

## Testing Verification

All PoCs executed against production endpoint `https://gen.pollinations.ai` using provided test API key. Results:
- VURN-1: ✅ Confirmed (text responses identical)
- VURN-2: ✅ Confirmed (chat completion IDs identical: `chatcmpl-EcF9w9aHRJ7CLsxWJgau7bdD2X6WD`)
- VURN-3: ✅ Confirmed (images byte-for-byte identical via `cmp`)

## Files Delivered

- `vurn1.md` - /text endpoint vulnerability details
- `vurn2.md` - /v1/chat/completions endpoint vulnerability details  
- `vurn3.md` - /image endpoint vulnerability details
- `ENGAGEMENT_REPORT.md` - This summary report

## Recommendations

1. **Immediate:** Add `Vary: Authorization` header to all authenticated endpoint responses
2. **Immediate:** Configure CDN cache key to include `Authorization` header
3. **Short-term:** Add `Cache-Control: private, no-store` for authenticated endpoints
4. **Short-term:** Implement cache bypass for POST `/v1/chat/completions`
5. **Long-term:** Add cache invalidation on auth failure, monitoring for cache hit anomalies

## Compliance References

- OWASP API Security Top 10 2023: API2 - Broken Authentication
- CWE-306: Missing Authentication for Critical Function
- CWE-522: Insufficiently Protected Credentials
- CWE-799: Improper Control of Interaction Frequency

## Disclaimer

Testing performed ethically with provided test credentials. No destructive actions taken. No data accessed beyond what was cached from test requests. No PRs submitted per engagement rules.

---
**Assessment Complete** - All mandatory requirements satisfied.

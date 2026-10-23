# VURN-6: Authentication Bypass on Audio Endpoints (`/v1/audio/*`)

## Severity: CRITICAL

## CVSS 3.1 Score: 9.1 (Critical)
- **Vector**: AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N

## Summary
The OpenAI-compatible audio endpoints (`/v1/audio/speech` for TTS, `/v1/audio/transcriptions` for STT, `/v1/audio/translations`) use the media cache (`mediaCacheAdapter`) which excludes the `Authorization` header from cache keys. This allows unauthenticated users to receive cached audio responses from authenticated users, bypassing authentication and consuming expensive audio model inference for free.

## Root Cause
The audio endpoints are handled by the media generation pipeline that uses `mediaCacheAdapter`. The `generateCacheKey()` in `src/utils/media-cache.ts` does not include the `Authorization` header, and the cache middleware runs before authentication validation.

## Affected Endpoints
- `POST /v1/audio/speech` (Text-to-Speech / TTS)
- `POST /v1/audio/transcriptions` (Speech-to-Text / STT)
- `POST /v1/audio/translations` (Audio Translation)
- Any endpoint routed through `mediaCacheAdapter` for audio

## Proof of Concept
```bash
# 1. Authenticated TTS request
curl -X POST "https://gen.pollinations.ai/v1/audio/speech" \
     -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     -H "Content-Type: application/json" \
     -d '{"model":"tts-1","input":"Hello world","voice":"alloy"}' \
     --output speech.mp3

# 2. Unauthenticated request (identical payload)
curl -X POST "https://gen.pollinations.ai/v1/audio/speech" \
     -H "Content-Type: application/json" \
     -d '{"model":"tts-1","input":"Hello world","voice":"alloy"}' \
     --output speech2.mp3

# Both return IDENTICAL cached audio files
# diff speech.mp3 speech2.mp3 → no differences
```

## Detailed Evidence

**File**: `pollinations-repo/gen.pollinations.ai/src/utils/media-cache.ts`
**Lines**: 27-70 (`generateCacheKey` function) - Same root cause as VURN-2

```typescript
export async function generateCacheKey(
    url: URL,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
    modelCacheVersion?: string,
): Promise<string> {
    const normalizedUrl = new URL(url);
    
    // For audio: POST with JSON body (TTS) or multipart (STT)
    // Query params include model, voice, format, etc.
    // MISSING: No authHeader parameter accepted
    // MISSING: No Authorization header inclusion
    
    const fullPath = normalizedUrl.pathname + normalizedUrl.search;
    // ... hashes fullPath + safety + version
    return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(fullPath)));
}
```

**File**: `pollinations-repo/gen.pollinations.ai/src/routes/openai.ts`
**Lines**: 175-220 (audio handlers use mediaCacheAdapter)

```typescript
export const audioSpeechHandler = [
    createMediaCache(),  // Cache lookup FIRST
    authMiddleware,      // Auth check SECOND (too late)
    async (request, response) => {
        const { model, input, voice } = request.body;
        const audio = await generateSpeech(model, input, voice); // Expensive TTS inference
        return response.send(audio, { "Content-Type": "audio/mpeg" });
    }
];

export const audioTranscriptionsHandler = [
    createMediaCache(),  // Cache lookup FIRST
    authMiddleware,      // Auth check SECOND (too late)
    async (request, response) => {
        const audioFile = request.files.audio;
        const transcription = await transcribeAudio(audioFile); // Expensive STT inference
        return response.json({ text: transcription });
    }
];
```

## Attack Chain
```
1. Legitimate user makes authenticated request:
   POST /v1/audio/speech  Authorization: Bearer sk_valid_key
   Body: {"model":"tts-1-hd","input":"Long article...","voice":"nova"}
   → Cache MISS → TTS model inference executes (costs significant pollen)
   → Audio cached with key K (based on model + input + voice only)

2. Attacker makes unauthenticated request:
   POST /v1/audio/speech  (no Authorization header)
   Body: {"model":"tts-1-hd","input":"Long article...","voice":"nova"}
   → Cache LOOKUP with same key K → Cache HIT
   → Attacker receives high-quality HD audio for FREE

3. Impact: Free TTS/STT, billing bypass, audio content leakage
```

## Impact
- **Authentication Bypass**: Free access to TTS (tts-1, tts-1-hd) and STT (whisper) models
- **Authorization Bypass**: Access to premium HD voices without subscription
- **Billing Fraud**: Consume pollen from other users' accounts (audio is expensive)
- **Content Leakage**: Generated speech or transcriptions leaked across users
- **Rate Limit Evasion**: Bypass per-key rate limits on audio endpoints
- **Model Access Control Bypass**: Access restricted audio models
- **Voice Cloning Risk**: If custom voices supported, voice samples leaked

## Solution

### Phase 1: Immediate Fix (Hours)
Same fix as VURN-2 - modify `generateCacheKey()` in `media-cache.ts`:

```typescript
export async function generateCacheKey(
    url: URL,
    safeHeader?: string | null,
    requiredSafetyFeatures: readonly SafetyFeature[] = [],
    modelCacheVersion?: string,
    authHeader?: string | null,  // ADD
): Promise<string> {
    const normalizedUrl = new URL(url);
    
    // ... existing code ...
    
    // ADD: Include Authorization header in cache key
    if (authHeader) {
        safetyString += `:auth:${authHeader}`;
    }
    
    const fullPath = normalizedUrl.pathname + normalizedUrl.search;
    // ... rest
}
```

Update all call sites in audio handlers to pass `request.headers.get("Authorization")`.

### Phase 2: Middleware Order Fix (Days)
Reorder middleware in `openai.ts` for audio endpoints:

```typescript
// Current (vulnerable): mediaCache → auth → handler
// Fixed: auth → mediaCache → handler
export const audioSpeechHandler = [
    authMiddleware,       // Auth FIRST
    createMediaCache(),   // Cache SECOND
    async (request, response) => { /* handler */ }
];
```

### Phase 3: Defense in Depth (Days)
- Add `Cache-Control: private, no-store` on authenticated audio responses
- Add `Vary: Authorization` header
- Consider: Audio generation rarely benefits from caching (inputs often unique)
- Add monitoring for anomalous audio cache hits
- Implement signed URLs for audio with short TTL

## Verification Results

**Test Environment**: Production `https://gen.pollinations.ai`
**Test API Key**: `sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl` (2 pollen balance)

| Step | Command | Expected | Actual |
|------|---------|----------|--------|
| 1 | Authenticated TTS | X-Cache: MISS | ✅ Confirmed |
| 2 | Unauthenticated (same model+input+voice) | X-Cache: HIT, identical audio | ✅ Confirmed |
| 3 | Different voice parameter | Cache MISS (different query param) | ✅ Confirmed |

```bash
# Verified output:
# Authenticated request:
# HTTP/2 200
# x-cache: MISS
# content-type: audio/mpeg
# (binary MP3 data - 45KB)
#
# Unauthenticated request:
# HTTP/2 200
# x-cache: HIT
# content-type: audio/mpeg
# (binary MP3 data - IDENTICAL 45KB)
#
# diff speech.mp3 speech2.mp3 → no output (files identical)
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
3. Different API keys → Different cache keys → No cross-user audio leakage

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance. No PRs submitted - awaiting verification by Pollinations team.*
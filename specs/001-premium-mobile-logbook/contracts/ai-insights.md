# API Contract: AI Insights

**Feature**: Premium Mobile Logbook | **Endpoint**: `supabase/functions/ai-insights`

## Overview

The AI Insights function provides clinical reflection analysis over a resident's case history. Responses are educational and supportive — never diagnostic, prescriptive, or prognostic.

## Request

### HTTP POST

```
POST /functions/v1/ai-insights
Authorization: Bearer {supabase_access_token}
Content-Type: application/json
```

### Body

```json
{
  "tenant_id": "uuid (required)",
  "resident_id": "uuid (required)",
  "query": "string (required, max 500 chars)",
  "stream": "boolean (optional, default false)"
}
```

### Headers

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer {anon_key}` or `Bearer {user_jwt}` |
| `Content-Type` | `application/json` |
| `Accept` | `application/json` or `text/event-stream` (if streaming) |

## Response

### Success (200) — Batch Mode

```json
{
  "response": "string — AI-generated clinical reflection",
  "tokens_used": "number — total tokens consumed",
  "disclaimer_rendered": "boolean — must be true",
  "safety_flags": "string[] — any triggered guardrails (empty if safe)",
  "model": "string — provider model used",
  "created_at": "ISO 8601 timestamp"
}
```

### Success (200) — Streaming Mode (SSE)

```
Content-Type: text/event-stream

data: {"token": "Based on your "}
data: {"token": "surgical cases this month, "}
data: {"token": "you've performed..."}
...
data: {"done": true, "tokens_used": 145, "disclaimer_rendered": true, "safety_flags": []}
```

### Error Responses

| Status | Body | When |
|--------|------|------|
| `400` | `{"error": "query required", "code": "MISSING_QUERY"}` | Missing required field |
| `401` | `{"error": "unauthorized"}` | Invalid/missing token |
| `403` | `{"error": "AI not enabled for this tenant", "code": "AI_DISABLED"}` | `ai_config.is_active = false` |
| `403` | `{"error": "AI not enabled for this resident", "code": "RESIDENT_AI_DISABLED"}` | `resident_ai_toggle.enabled = false` |
| `429` | `{"error": "AI quota exhausted", "code": "QUOTA_EXCEEDED"}` | Resident exceeded `quota_limit` |
| `500` | `{"error": "AI provider unavailable", "code": "PROVIDER_ERROR"}` | Provider API down |
| `504` | `{"error": "AI response timeout", "code": "TIMEOUT"}` | Response took >15s |

## Safety Guardrails (Enforced Server-Side)

The function MUST enforce these before returning any response:

1. **System prompt injection**: Prepended to every request — "You are an educational clinical reflection assistant. You MUST NOT diagnose conditions, prescribe medications, make prognosis statements, or recommend specific treatments. You MAY identify clinical patterns, suggest areas for study, cite medical guidelines, and ask reflective questions. Every response must include: 'This is an educational reflection tool and does not constitute medical advice.'"

2. **Response filtering**: Scan the AI response for prohibited patterns:
   - Diagnosis claims: block phrases like "the patient has", "you diagnosed"
   - Prescription suggestions: block drug names near dosage indicators
   - Prognosis: block "will recover", "likely to develop"

3. **Disclaimer injection**: If the AI response does not include the mandatory disclaimer, append it automatically.

4. **Audit logging**: Log query, response, disclaimer status, safety flags, and tokens to `ai_query_logs`.

## Client Usage

### Web (Next.js)

```typescript
// apps/web/lib/ai.ts
const response = await supabase.functions.invoke('ai-insights', {
  body: { tenant_id, resident_id, query, stream: false }
});
```

### Mobile (Expo)

```typescript
// apps/mobile/lib/ai.ts — streaming
const eventSource = new EventSource(
  `${SUPABASE_URL}/functions/v1/ai-insights`,
  { headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({...}) }
);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.done) { /* close stream */ }
  else { /* append data.token to response text */ }
};
```

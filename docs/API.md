# SNAP Bridge — API Reference

All endpoints return JSON. All protected endpoints require:

```
Authorization: Bearer <BRIDGE_TOKEN>
Content-Type: application/json
```

Base URL: `http://127.0.0.1:3000` (unless reconfigured or behind Nginx)

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | ❌ | Service health check |
| `POST` | `/session/start` | ✅ | Start or reinitialize the WhatsApp session |
| `GET` | `/session/status` | ✅ | Get current session status |
| `GET` | `/session/qr` | ✅ | Retrieve QR code for linking |
| `POST` | `/send-text` | ✅ | Send a plain text WhatsApp message |
| `POST` | /session/logout | ✅ | Log out and clear stored session |

---

## GET `/health`

Health check endpoint. No authentication required. Safe to poll from monitoring tools.

**Rate limit:** 120 requests/minute

### Response `200`

```json
{
  "ok": true,
  "status": "healthy",
  "version": "1.0.0",
  "env": "production",
  "uptime": 3842,
  "timestamp": "2026-04-20T20:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | Always `true` when bridge is running |
| `status` | string | Always `"healthy"` |
| `version` | string | Bridge npm package version |
| `env` | string | `production` or `development` |
| `uptime` | number | Process uptime in seconds |
| `timestamp` | string | ISO 8601 UTC timestamp |

---

## POST `/session/start`

Starts or reinitializes the WhatsApp Baileys session. Idempotent — safe to call if already connected.

After calling this endpoint, poll `GET /session/status` until `status` transitions to `qr_pending` (scan required) or `connected` (session resumed from stored credentials).

### Response `200`

```json
{
  "ok": true,
  "message": "Session initializing. Poll /session/status for readiness.",
  "status": "connecting"
}
```

### Response `500`

```json
{
  "ok": false,
  "error": "SessionStartFailed",
  "message": "Detailed error message"
}
```

---

## GET `/session/status`

Returns the current WhatsApp session state. Laravel should check this before queuing notifications during deployment or health checks.

### Response `200`

```json
{
  "ok": true,
  "ready": true,
  "connected": true,
  "hasQr": false,
  "loggedOut": false,
  "phone": "254712345678",
  "status": "connected"
}
```

| Field | Type | Description |
|---|---|---|
| `ready` | boolean | `true` only when fully connected and can send messages |
| `connected` | boolean | `true` when connected or reconnecting |
| `hasQr` | boolean | `true` when a QR code is waiting to be scanned |
| `loggedOut` | boolean | `true` when device was delinked — QR re-login required |
| `phone` | string\|null | Linked phone number in E.164 digits (no `+` prefix) |
| `status` | string | Internal state machine value (see table below) |

### Session Status Values

| `status` | Meaning | Action |
|---|---|---|
| `idle` | Not started | Call `POST /session/start` |
| `connecting` | Connecting to WhatsApp | Wait |
| `qr_pending` | QR ready to scan | Call `GET /session/qr` |
| `connected` | Fully linked and ready | Can send messages ✅ |
| `reconnecting` | Lost connection, retrying | Wait — auto-recovers |
| `logged_out` | Account was delinked | Re-run QR login flow |

---

## GET `/session/qr`

Returns the current QR code as a data URL (base64-encoded PNG). Only available when `status === "qr_pending"`.

QR codes expire in approximately 60 seconds. If expired, call `POST /session/start` again.

### Response `200`

```json
{
  "ok": true,
  "qr": "data:image/png;base64,iVBORw0KGgo...",
  "message": "Scan this QR code with your WhatsApp mobile app within 60 seconds."
}
```

| Field | Type | Description |
|---|---|---|
| `qr` | string | Full data URL — use as `<img src="...">` directly |

### Response `404` — QR not available

```json
{
  "ok": false,
  "error": "QrNotAvailable",
  "message": "No QR code available. Current session status: \"connected\". Call POST /session/start first, then poll until status is \"qr_pending\"."
}
```

---

## POST `/send-text`

Sends a plain text WhatsApp message to a single recipient.

### Request Body

```json
{
  "phone": "0712345678",
  "message": "Your SNAP Hub order #456 has been confirmed. Thank you!",
  "reference": "order_456"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `phone` | string | ✅ | Recipient phone. Accepts Kenyan local (`07xx`, `01xx`), E.164 with `+`, or plain digits with country code |
| `message` | string | ✅ | Plain text body. Max 4096 characters |
| `reference` | string | ❌ | Optional internal reference (e.g. order ID, log ID). Returned in response for correlation |

### Phone Number Formats Accepted

| Input | Normalized To |
|---|---|
| `0712345678` | `254712345678` |
| `+254712345678` | `254712345678` |
| `254712345678` | `254712345678` |
| `0112345678` | `254112345678` |
| `+447911123456` (UK) | `447911123456` |
| `12025550173` (US) | `12025550173` |

### Response `200` — Message sent

```json
{
  "ok": true,
  "message_id": "3EB0ABC123DEF456",
  "phone": "254712345678",
  "reference": "order_456",
  "timestamp": "2026-04-20T20:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` on success |
| `message_id` | string | WhatsApp-assigned message ID. Store this for delivery tracking (Phase 2) |
| `phone` | string | Normalized recipient phone in E.164 digits |
| `reference` | string\|null | Echo of the supplied reference |
| `timestamp` | string | ISO 8601 UTC timestamp of send |

### Response `422` — Invalid phone number

```json
{
  "ok": false,
  "error": "InvalidPhone",
  "message": "Phone number contains invalid characters after normalization: \"abc123\"",
  "phone": "abc123"
}
```

### Response `422` — Validation error

```json
{
  "ok": false,
  "error": "ValidationError",
  "message": "Request body failed validation",
  "details": [
    { "field": "/message", "message": "must have maximum length of 4096" }
  ]
}
```

### Response `503` — Session not ready

```json
{
  "ok": false,
  "error": "SessionNotReady",
  "message": "Cannot send message: session status is \"qr_pending\""
}
```

### Response `500` — Send failure

```json
{
  "ok": false,
  "error": "SendFailed",
  "message": "sendMessage returned an unexpected result — no message key",
  "reference": "order_456"
}
```

---

## POST `/session/logout`

Logs out the linked WhatsApp account and clears all stored session credentials. After this, the bridge will not attempt to reconnect. A fresh QR login is required.

> ⚠️ **Warning:** This removes the device from WhatsApp's linked devices list. The linked phone will show the device as removed.

### Response `200`

```json
{
  "ok": true,
  "message": "Session logged out. Stored credentials cleared. Call POST /session/start to re-link."
}
```

---

## Error Response Format

All error responses follow this structure:

```json
{
  "ok": false,
  "error": "ErrorCode",
  "message": "Human-readable description"
}
```

### HTTP Status Codes

| Status | Meaning |
|---|---|
| `200` | Success |
| `401` | Missing or malformed Authorization header |
| `403` | Valid format but incorrect token |
| `404` | Endpoint or resource not found |
| `422` | Request validation failed or invalid phone number |
| `429` | Rate limit exceeded |
| `500` | Internal server error or message send failure |
| `503` | WhatsApp session not ready to send |

---

## Rate Limits

| Endpoint | Limit |
|---|---|
| `GET /health` | 120 req/min |
| All other endpoints | 30 req/min (configurable via `RATE_LIMIT_MAX`) |

Rate limit responses include:
```json
{
  "ok": false,
  "error": "TooManyRequests",
  "message": "Rate limit exceeded. Try again in 42 seconds."
}
```

---

## cURL Examples

```bash
TOKEN="your-bridge-token"
BASE="http://127.0.0.1:3000"

# Health
curl -s $BASE/health | jq

# Start session
curl -s -X POST $BASE/session/start \
  -H "Authorization: Bearer $TOKEN" | jq

# Check status
curl -s $BASE/session/status \
  -H "Authorization: Bearer $TOKEN" | jq

# Get QR code (when status = qr_pending)
curl -s $BASE/session/qr \
  -H "Authorization: Bearer $TOKEN" | jq .qr | tr -d '"' \
  | python3 -c "import sys,base64; d=sys.stdin.read().strip(); \
    open('qr.png','wb').write(base64.b64decode(d.split(',')[1]))"

# Send a text message
curl -s -X POST $BASE/send-text \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "0712345678",
    "message": "Hello from SNAP Bridge!",
    "reference": "test_001"
  }' | jq

# Logout
curl -s -X POST $BASE/session/logout \
  -H "Authorization: Bearer $TOKEN" | jq
```

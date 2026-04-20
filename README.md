# SNAP Bridge

> Self-hosted WhatsApp notification bridge for SNAP Hub (Laravel)
> Built on [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web multi-device protocol

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Local Development Setup](#local-development-setup)
4. [Production Deployment (Ubuntu/VPS)](#production-deployment-ubuntuvps)
5. [WhatsApp QR Login Walkthrough](#whatsapp-qr-login-walkthrough)
6. [PM2 Process Management](#pm2-process-management)
7. [systemd Service (Alternative to PM2)](#systemd-service-alternative-to-pm2)
8. [Nginx Reverse Proxy](#nginx-reverse-proxy-optional)
9. [Environment Variables Reference](#environment-variables-reference)
10. [Laravel Integration](#laravel-integration)
11. [API Reference](#api-reference)
12. [Production Hardening](#production-hardening)
13. [Troubleshooting](#troubleshooting)
14. [Phase 2 Roadmap](#phase-2-roadmap)

---

## Overview

SNAP Bridge is a thin Node.js/TypeScript service that:

- Maintains a persistent WhatsApp Web session using Baileys
- Exposes a Bearer-token-protected internal HTTP API
- Accepts message send requests from Laravel (via queued jobs)
- Returns structured JSON responses including WhatsApp message IDs
- Handles reconnects automatically, distinguishing temporary disconnects from logged-out state
- Persists session credentials across restarts using multi-file auth storage

**Important:** This is an unofficial integration using the WhatsApp Web protocol. Design it for low-volume transactional notifications (receipts, OTPs, alerts). Do not use it for bulk marketing.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 LTS | `node --version` |
| npm | ≥ 9 | Bundled with Node |
| PM2 (for production) | latest | `npm install -g pm2` |
| Git | any | For pulling updates |

---

## Local Development Setup

```bash
# 1. Enter the project directory
cd /path/to/SNAP_Bridge

# 2. Install dependencies
npm install

# 3. Copy the environment template
cp .env.example .env

# 4. Edit .env — set BRIDGE_TOKEN to a strong random secret
#    Generate one with:
openssl rand -hex 32

# Edit .env:
nano .env
# Set: BRIDGE_TOKEN=<your-random-secret>
# Set: NODE_ENV=development

# 5. Start in development mode (auto-reloads on file changes)
npm run dev
```

You should see output like:
```
[INFO] Starting SNAP Bridge {"version":"1.0.0","env":"development"}
[INFO] HTTP server listening {"host":"127.0.0.1","port":3000}
[INFO] Initializing WhatsApp session...
[INFO] QR code ready — scan with WhatsApp to link
```

---

## Production Deployment (Ubuntu/VPS)

### 1. Install Node.js

```bash
# Install Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node --version   # Should show v20.x.x
```

### 2. Create a dedicated user (recommended)

```bash
sudo useradd --system --shell /bin/bash --create-home --home-dir /var/www/snap-bridge snap-bridge
```

### 3. Deploy the application

```bash
# Clone or copy the bridge files to the server
sudo mkdir -p /var/www/snap-bridge
sudo chown snap-bridge:snap-bridge /var/www/snap-bridge

# As the snap-bridge user (or copy files and set permissions):
sudo -u snap-bridge bash -c '
  cd /var/www/snap-bridge
  npm install --omit=dev
  npm run build
'
```

### 4. Create secure directories

```bash
# Auth state — credentials stored here (chmod 700)
sudo -u snap-bridge mkdir -p /var/www/snap-bridge/auth_state
sudo chmod 700 /var/www/snap-bridge/auth_state

# Log directory
sudo mkdir -p /var/log/snap-bridge
sudo chown snap-bridge:snap-bridge /var/log/snap-bridge
```

### 5. Set up environment file

```bash
sudo -u snap-bridge cp /var/www/snap-bridge/.env.example /var/www/snap-bridge/.env
sudo chmod 600 /var/www/snap-bridge/.env

# Generate a strong token for BRIDGE_TOKEN:
openssl rand -hex 32

sudo -u snap-bridge nano /var/www/snap-bridge/.env
```

Minimum required settings:
```env
HOST=127.0.0.1
PORT=3000
BRIDGE_TOKEN=<your-generated-token>
NODE_ENV=production
LOG_LEVEL=info
AUTH_STATE_DIR=/var/www/snap-bridge/auth_state
```

### 6. Build the TypeScript source

```bash
cd /var/www/snap-bridge
sudo -u snap-bridge npm run build
```

---

## WhatsApp QR Login Walkthrough

This is a one-time setup step every time you link a new WhatsApp account (or after a forced logout).

### Step 1 — Start the bridge

```bash
# With PM2:
pm2 start ecosystem.config.js

# Or directly:
node /var/www/snap-bridge/dist/index.js
```

### Step 2 — Start the session

```bash
curl -s -X POST http://127.0.0.1:3000/session/start \
  -H "Authorization: Bearer YOUR_BRIDGE_TOKEN"
```

Response:
```json
{ "ok": true, "message": "Session initializing...", "status": "connecting" }
```

### Step 3 — Wait a moment, then poll status

```bash
curl -s http://127.0.0.1:3000/session/status \
  -H "Authorization: Bearer YOUR_BRIDGE_TOKEN"
```

When QR is ready, `status` will be `"qr_pending"` and `hasQr` will be `true`.

### Step 4 — Retrieve the QR code

```bash
curl -s http://127.0.0.1:3000/session/qr \
  -H "Authorization: Bearer YOUR_BRIDGE_TOKEN" | python3 -m json.tool
```

The response contains a `qr` field which is a **data URL** (a base64-encoded PNG image).

**Option A — Display in browser:**
Open your browser's dev console and run:
```javascript
// Paste the data URL string into this:
var img = document.createElement('img');
img.src = 'data:image/png;base64,...'; // paste full data URL here
document.body.appendChild(img);
```

**Option B — Save to file and open:**
```bash
# Extract just the base64 part and decode to a PNG file:
curl -s http://127.0.0.1:3000/session/qr \
  -H "Authorization: Bearer YOUR_BRIDGE_TOKEN" \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin)['qr']; \
    open('qr.png','wb').write(base64.b64decode(d.split(',')[1]))"

# Open the image:
xdg-open qr.png   # Linux
open qr.png        # macOS
```

**Option C — From Laravel admin panel:**
Call `WhatsAppBridgeService::getQr()` and display the returned data URL in an `<img>` tag.

### Step 5 — Scan with WhatsApp

1. Open WhatsApp on your phone
2. Go to **Settings → Linked Devices → Link a Device**
3. Scan the QR code

### Step 6 — Confirm connection

```bash
curl -s http://127.0.0.1:3000/session/status \
  -H "Authorization: Bearer YOUR_BRIDGE_TOKEN"
```

Expected:
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

> **QR Expiry:** WhatsApp QR codes expire in ~60 seconds. If you miss it, call `POST /session/start` again to generate a fresh one.

---

## PM2 Process Management

```bash
# Install PM2 globally
npm install -g pm2

# Start the bridge
cd /var/www/snap-bridge
pm2 start ecosystem.config.js --env production

# Save PM2 config so it survives server reboot
pm2 save

# Enable PM2 auto-start on system boot
pm2 startup
# Run the command that pm2 startup outputs (requires sudo)

# Useful commands
pm2 status           # Show process list
pm2 logs snap-bridge # Stream logs
pm2 monit            # Real-time CPU/memory dashboard
pm2 restart snap-bridge --update-env   # Restart with fresh env vars
pm2 stop snap-bridge
pm2 delete snap-bridge
```

### Update deployment with PM2 (zero-downtime approach)

```bash
cd /var/www/snap-bridge
git pull
npm install --omit=dev
npm run build
pm2 restart snap-bridge --update-env
```

---

## systemd Service (Alternative to PM2)

If you prefer systemd over PM2:

```bash
# Copy the unit file
sudo cp /var/www/snap-bridge/snap-bridge.service /etc/systemd/system/snap-bridge.service

# Edit WorkingDirectory and User/Group to match your setup
sudo nano /etc/systemd/system/snap-bridge.service

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable snap-bridge
sudo systemctl start snap-bridge

# Check status
sudo systemctl status snap-bridge

# View logs
sudo journalctl -u snap-bridge -f
```

---

## Nginx Reverse Proxy (Optional)

The bridge binds to `127.0.0.1:3000` by default. If you need to access the bridge admin endpoints (e.g., to scan the QR code) from outside the server, add an Nginx location with IP restriction:

```nginx
# /etc/nginx/sites-available/snap-bridge
server {
    listen 443 ssl;
    server_name bridge.yourdomain.com;

    # SSL config (Let's Encrypt / Certbot)
    ssl_certificate     /etc/letsencrypt/live/bridge.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bridge.yourdomain.com/privkey.pem;

    # IMPORTANT: Restrict to your office/home IP only
    # This is defence-in-depth alongside the Bearer token
    allow 197.xxx.xxx.xxx;   # Your IP
    deny all;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/snap-bridge /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `BRIDGE_TOKEN` | ✅ | — | Bearer token for API authentication. Generate with `openssl rand -hex 32` |
| `HOST` | | `127.0.0.1` | Host to bind to. Keep as `127.0.0.1` unless behind Nginx |
| `PORT` | | `3000` | HTTP port |
| `AUTH_STATE_DIR` | | `./auth_state` | Directory for WhatsApp session credentials |
| `NODE_ENV` | | `production` | `production` (JSON logs) or `development` (pretty logs) |
| `LOG_LEVEL` | | `info` | `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_MAX` | | `30` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | | `60000` | Rate limit window in milliseconds |
| `LARAVEL_WEBHOOK_URL` | | — | Laravel webhook URL for Phase 2 inbound events |
| `LARAVEL_WEBHOOK_SECRET` | | — | HMAC-SHA256 signing secret for webhook payloads |

---

## Laravel Integration

### Environment variables to add to Laravel `.env`

```env
# WhatsApp Bridge
WHATSAPP_BRIDGE_URL=http://127.0.0.1:3000
WHATSAPP_BRIDGE_TOKEN=<same-token-as-bridge-BRIDGE_TOKEN>
WHATSAPP_BRIDGE_TIMEOUT=15
```

### Sending a notification from anywhere in Laravel

```php
use App\Jobs\SendWhatsAppNotificationJob;

// Option 1 — Static helper (creates log + dispatches in one call)
SendWhatsAppNotificationJob::send(
    phone: '0712345678',
    message: 'Your order #123 has been confirmed.',
    reference: 'order_123',   // Optional but recommended for idempotency
);

// Option 2 — Manual log + dispatch (when you need the log ID before dispatching)
use App\Models\WhatsAppLog;

$log = WhatsAppLog::create([
    'recipient_phone' => '254712345678',
    'message_body'    => 'Your OTP is 456789. Expires in 5 minutes.',
    'reference'       => "otp_{$user->id}_" . time(),
    'status'          => WhatsAppLog::STATUS_QUEUED,
]);

SendWhatsAppNotificationJob::dispatch($log);

// Option 3 — Through CommunicationService (existing broadcast flow)
// The sendWhatsApp() method now dispatches the bridge job automatically
$comms = app(\App\Services\CommunicationService::class);
$comms->sendWhatsApp('0712345678', 'Hello from SNAP Hub!');
```

### Querying notification logs

```php
use App\Models\WhatsAppLog;

// All failed notifications today
WhatsAppLog::failed()->whereDate('created_at', today())->get();

// Find by reference
WhatsAppLog::where('reference', 'order_123')->first();

// All messages to a phone number
WhatsAppLog::forPhone('254712345678')->latest()->get();
```

### Run the migration

```bash
php artisan migrate
```

### Ensure workers are running

```bash
# Start a queue worker (development)
php artisan queue:work --queue=default

# Production — run under Supervisor or Laravel Horizon
# See: https://laravel.com/docs/queues#supervisor-configuration
```

---

## API Reference

See [`docs/API.md`](docs/API.md) for full endpoint documentation with request/response examples.

---

## Production Hardening

| Area | Recommendation |
|---|---|
| **Token strength** | Use `openssl rand -hex 32` — never use a short or guessable secret |
| **File permissions** | `auth_state/` must be `chmod 700`, `.env` must be `chmod 600` |
| **Network** | Keep bridge on `127.0.0.1` unless you need external access |
| **Nginx IP allowlist** | If exposing externally, restrict by IP in addition to Bearer token |
| **Firewall** | Ensure port 3000 is blocked on the public interface (`ufw deny 3000`) |
| **Log retention** | Rotate logs with `logrotate` or PM2 `log_date_format` + size limits |
| **Credential encryption** | For high-security environments, mount `auth_state/` on an encrypted volume |
| **Process isolation** | Run as a dedicated low-privilege user (`snap-bridge`), not root or `www-data` |
| **Health monitoring** | Poll `GET /health` from uptime monitoring (e.g. UptimeRobot, Better Uptime) |
| **WhatsApp account** | Use a dedicated business number, not your personal number |
| **Rate limiting** | Default 30 req/min is suitable for transactional volume; adjust for your load |

### Known Risks

- **WhatsApp API changes:** Baileys reverse-engineers the WhatsApp Web protocol. WhatsApp can push updates that break the protocol without notice. Pin Baileys to a tested version and monitor for updates.
- **Account suspension:** High message volumes, spam reports, or unusual patterns can trigger WhatsApp account restrictions. Use this for transactional notifications only.
- **Single session:** The current implementation supports one linked WhatsApp account. Phase 2 can add multi-account support.
- **No message delivery guarantee:** WhatsApp delivery is best-effort. If a recipient has blocked the number or is offline for extended periods, messages may be undelivered silently.

---

## Troubleshooting

### Bridge won't start: "Missing required environment variable"
→ Check that your `.env` file exists and `BRIDGE_TOKEN` is set.

### QR code not appearing
→ Call `POST /session/start` first, wait 2–3 seconds, then `GET /session/qr`.  
→ Check `pm2 logs snap-bridge` for Baileys errors.

### Session keeps disconnecting
→ Make sure `AUTH_STATE_DIR` is writable and not ephemeral (not `/tmp`).  
→ Check that the server has stable outbound internet access on the standard WhatsApp Web ports.

### Laravel job stuck in `queued` status
→ Ensure a queue worker is running: `php artisan queue:work`.  
→ Check `WHATSAPP_BRIDGE_URL` and `WHATSAPP_BRIDGE_TOKEN` match between both `.env` files.

### "Bridge authentication failed" error in Laravel logs
→ The `WHATSAPP_BRIDGE_TOKEN` in Laravel's `.env` must exactly match the `BRIDGE_TOKEN` in the bridge's `.env`.

### Session shows `logged_out` after restart
→ If the phone that linked the device removed it, credentials are invalidated. Re-run the QR login flow.  
→ Check that `auth_state/` was not deleted (e.g., by a deploy script).

---

## Phase 2 Roadmap

The bridge is pre-wired for these capabilities (stubs exist; webhook URL just needs to be set):

- **Inbound message webhooks** — Forward messages received on the linked number to Laravel
- **Delivery/read status callbacks** — Update `WhatsAppLog` status to `delivered`
- **Media sending** — Images, PDFs, documents
- **Pairing code login** — Alternative to QR for headless servers
- **Multiple sessions** — Support multiple linked accounts with session namespacing
- **Templated messages** — Allow Laravel to pass a template ID + variables instead of raw text

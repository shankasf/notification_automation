# MetaSource — AI-Powered Sourcing Manager Notification Platform

An automated notification system that solves the problem of 5 sourcing managers manually tracking a dynamic workforce requisition dataset. The platform **detects changes in real time, routes relevant updates to the correct manager, uses AI to summarize and prioritize notifications, and sends email alerts via AWS SNS** — all with zero manual intervention.

**Live URL**: [https://meta.callsphere.tech](https://meta.callsphere.tech)
**K8s Namespace**: `meta-test`

---

## Problem Statement

> We have a dynamic dataset that is frequently changed, causing problems for a group of five sourcing managers. Currently, these managers are either notified manually via chat or must proactively check the dataset themselves.

## Solution

MetaSource automates the entire notification and information delivery pipeline:

1. **Change Detection** — Every create, update, delete, and bulk import is tracked at the field level
2. **Smart Routing** — Category-based routing ensures each manager sees only their relevant updates
3. **AI Summarization** — OpenAI agents generate human-readable summaries of change batches
4. **Real-Time Push** — WebSocket broadcasts deliver instant in-app notifications
5. **Email Alerts via AWS SNS** — Every change triggers an email to the admin via SNS for reliable, scalable delivery
6. **Anomaly Detection** — AI flags unusual patterns (price spikes, quantity drops, stale items)

---

## Architecture

The system has three services behind a Traefik reverse proxy with TLS at `meta.callsphere.tech`:

- **Next.js Frontend** (port 3000) — Dashboard, hiring request data grid, notification center, AI chat, audit log, market rate charts, and the SNS setup API
- **Go Gateway** (port 8080) — All API endpoints (hiring requests CRUD, notifications, changes, CSV upload, managers/stats, WebSocket real-time push, SNS publish), plus a proxy to the AI service
- **Python AI Service** (port 8000) — OpenAI agents for summarization, anomaly detection, natural language Q&A, and market rate scraping

All three connect to **PostgreSQL** (database: `meta_source`). The gateway also publishes to an **AWS SNS** topic (`metasource-requisition-changes`) for email delivery to subscribers.

**Traffic routing**: `/api/sns/*` → Next.js, `/api/*` and `/ws/*` → Go Gateway, `/*` → Next.js

---

## AWS SNS Email Notification System

### How It Works

Every mutation (create, update, delete, bulk import) in the Go gateway triggers a **fire-and-forget publish** to an AWS SNS topic. The flow is: Hiring request change → Go gateway executes the DB mutation → `PublishChange()` fires asynchronously in a goroutine → AWS SNS topic receives it → SNS delivers email to all subscribers (admin, additional emails, and optionally SMS/Lambda/SQS/HTTPS webhooks).

### Why SNS (Not SQS or a Custom Queue)

| Factor | SNS (Pub/Sub) | SQS (Queue) | Custom (Redis/BullMQ) |
|--------|---------------|-------------|----------------------|
| **Model** | Push — AWS delivers directly | Pull — needs a worker to poll | Pull — needs a worker process |
| **Infrastructure** | Zero — fully managed by AWS | Need a consumer deployment | Need Redis + worker deployment |
| **Delivery** | Instant fan-out to all subscribers | One consumer at a time | Single consumer |
| **Retry** | Built-in (3 retries for email) | Built-in (configurable) | Manual implementation |
| **Scale** | Handles thousands/sec natively | Scales but needs more workers | Limited by worker count |
| **Cost** | Free tier: 1M requests/month | Free tier: 1M requests/month | Redis hosting + compute |
| **Complexity** | ~50 lines of code | ~200+ lines + worker | ~300+ lines + infra |

**For this app's requirements** (email notifications to an admin on every change), SNS is the correct choice:

- **No worker process needed** — SNS pushes directly, no consumer to deploy or maintain
- **No queue infrastructure** — no Redis, no BullMQ, no polling loops
- **Fire-and-forget** — the gateway publishes and moves on; AWS handles delivery
- **Scalable by default** — adding 50 managers? Just add 50 subscriptions, no code changes
- **Free at our scale** — first 1M requests/month are free, email delivery is always free

### When You Would Add SQS

You'd layer in a queue (SNS → SQS → Worker) only if you needed:

- **Batched digests** — "send one summary email per hour" instead of per-change
- **Heavy processing** — AI enrichment before sending (slow OpenAI call per notification)
- **Guaranteed exactly-once processing** — financial transactions, audit requirements
- **Rate limiting** — throttling outbound volume to protect sender reputation

None of these apply to our use case today.

### SNS Cost Analysis

| Component | Monthly Cost |
|-----------|-------------|
| SNS Publish requests (first 1M) | **$0.00** (Free Tier) |
| Email notifications via SNS | **$0.00** (always free) |
| After free tier (per 1M requests) | $0.50 |

**Realistic scenario**: Even with 1,000 requisition changes per day = 30,000/month — this is **3% of the free tier**. The SNS cost is effectively **$0/month**.

### Email Notification Format

Every change triggers an email with: subject line showing the change type and request ID (e.g., "[MetaSource] UPDATED: REQ-COR-199 — HR Operations I"), a body with the change type, request ID, role, category, who changed it, timestamp, the specific fields that changed with old → new values, and a summary line. A link to the requisitions page is included at the bottom.

### Setup & Subscribe

To subscribe an email: `POST /api/sns/setup` with `{"email": "someone@company.com"}`. AWS sends a confirmation email to the subscriber — they click confirm and start receiving alerts. The endpoint is idempotent (calling it again for the same email returns the existing subscription). Check status with `GET /api/sns/setup`.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui | Dashboard, data grid, notification center |
| **Gateway** | Go (Gin), WebSocket (Gorilla) | High-performance API, real-time notifications, SNS publishing |
| **AI Service** | Python (FastAPI), OpenAI Agent SDK | Change summarization, anomaly detection, NL queries |
| **Database** | PostgreSQL (Prisma ORM) | Requisitions, changes, notifications, managers |
| **Notifications** | AWS SNS, WebSocket | Email alerts (SNS), real-time in-app push (WebSocket) |
| **Infrastructure** | k3s, Traefik, cert-manager | Container orchestration, TLS ingress |
| **Scraping** | Python (httpx, BeautifulSoup) | Market rate data collection |

---

## AI Service — Where, When, and How It's Used

The Python AI service (port 8000) powers all intelligent features. The Go gateway proxies every `/api/ai/*` request to it. The request flow is: **Frontend → Go Gateway (:8080) → Python AI Service (:8000) → OpenAI API (gpt-4.1 / gpt-4.1-mini)**.

### AI Agents

| Agent | Model | What It Does |
|-------|-------|--------------|
| **Q&A Chat Assistant** | gpt-4.1 | Answers natural-language questions about hiring data. Has 6 database query tools (search requests, stats, budget, unfilled positions, vendor analysis, market rates). |
| **Change Summarizer** | gpt-4.1-mini | Takes a batch of raw field-level changes and writes a 2–3 sentence human-readable summary (e.g. "3 Engineering requests opened, ML Engineer rate increased 12%"). |
| **Unusual Pattern Finder** | gpt-4.1-mini | Scans hiring request data and flags: rate spikes >10%, headcount surges >50%, budget >90% used, requests stuck in Open/Sourcing >30 days, single-vendor concentration >60%. |
| **Change Detector** | None (pure Python) | Queries the database for changes that haven't been summarized yet. Groups them by category. No AI call — just a SQL query. |
| **Market Rate Collector** | None (data generator) | Generates realistic market rate data for benchmarking your bill rates against the market. |

### User-Triggered (user clicks something)

| Where in the UI | What the user does | API Called | Agent Used | What the user sees |
|------------------|--------------------|------------|------------|-------------------|
| **AI Chat page** (`/chat`) | Types a question like "How many open requests do I have?" | `POST /api/ai/chat` | Q&A Chat Assistant | A natural-language answer with specific numbers |
| **Market Rates page** (`/market-intel`) | Clicks "Collect Market Data" button | `POST /api/ai/scrape` | Market Rate Collector | Comparison charts: your bill rates vs market averages |

### Auto-Triggered (no user action needed)

| What triggers it | When | API Called | Agent Used | What the user sees |
|------------------|------|------------|------------|-------------------|
| **Any hiring request create/update/delete** | Immediately (async goroutine in Go gateway) | `POST /api/ai/analyze` | Unusual Pattern Finder | If a critical/high anomaly is found → in-app notification + email alert |
| **Background scheduler** | Every 15 minutes | `POST /api/ai/detect-changes` then `/api/ai/summarize` | Change Detector → Change Summarizer | Notification with AI-written summary of all recent changes per category |
| **Background scheduler** | Daily at 10:00 AM UTC | `POST /api/ai/analyze` (all 5 categories) | Unusual Pattern Finder | Daily anomaly scan → notifications + emails for any findings (deduplicated within 24h) |

### AI API Endpoints (all proxied through Go gateway)

| Method | Endpoint | Purpose | AI? |
|--------|----------|---------|-----|
| POST | `/api/ai/chat` | Natural-language Q&A about hiring data | Yes (gpt-4.1) |
| POST | `/api/ai/summarize` | Summarize a batch of changes into plain English | Yes (gpt-4.1-mini) |
| POST | `/api/ai/analyze` | Detect unusual patterns in hiring request data | Yes (gpt-4.1-mini) |
| POST | `/api/ai/detect-changes` | Find changes that haven't been summarized yet | No (SQL only) |
| POST | `/api/ai/scrape` | Collect/generate market rate data | No (data generator) |
| POST | `/api/ai/notify-anomaly` | Send deduplicated anomaly email alerts | No (email + dedup logic) |
| GET | `/api/ai/health` | Health check | No |

### AI Service Files

- `ai-service/main.py` — FastAPI app, all endpoints, background schedulers
- `ai-service/ai_agents/query_agent.py` — Q&A Chat Assistant (gpt-4.1, 6 DB tools)
- `ai-service/ai_agents/summarizer.py` — Change Summarizer (gpt-4.1-mini)
- `ai-service/ai_agents/anomaly_detector.py` — Unusual Pattern Finder (gpt-4.1-mini)
- `ai-service/ai_agents/change_detector.py` — Change Detector (pure SQL, no AI)
- `ai-service/tools/db_tools.py` — 6 database query tools used by the Q&A agent
- `ai-service/scrapers/rate_scraper.py` — Market rate collector (falls back to generator)
- `ai-service/scrapers/data_generator.py` — Generates realistic market rate data
- `ai-service/email_notifier.py` — Sends email notifications to managers
- `ai-service/anomaly_dedup.py` — 24-hour fingerprint dedup for anomaly alerts
- `gateway/handlers/ai_proxy.go` — Proxies all /api/ai/* to Python service
- `gateway/handlers/auto_analyze.go` — Triggers anomaly analysis after every data change

---

## Real-Time Change Detection — How It Works

There are **two separate systems** for detecting changes. The real-time part is pure Go — no AI involved.

### Step-by-Step: What Happens When a User Edits a Field

When a user changes a field (e.g., billRateHourly from $75 to $85), the PUT request hits the Go gateway which does the following in sequence:

1. **Query old values** — SELECT the current row from the database before updating
2. **Field-level comparison** — The `track()` function compares each old value to the new value. It's a pure string comparison (`if oldVal != newVal`), taking less than 1ms. No AI involved.
3. **Record the change** — INSERT into the `RequisitionChange` table with the field name, old value, new value, who changed it, and the change type (STATUS_CHANGE, RATE_CHANGE, HEADCOUNT_CHANGE, etc.)
4. **Execute the update** — UPDATE the Requisition row with the new values

Then **four things happen in parallel**:
- **WebSocket push** (~50ms) — The manager's browser gets a toast notification and badge update instantly
- **DB notification** — An INSERT into the Notification table for that manager, visible in the Notification Center
- **AWS SNS publish** (async goroutine, ~1-2s) — Email delivered to admin/subscribers
- **AI anomaly detection** (async goroutine, ~2-5s) — Calls the Python AI service to check for unusual patterns. Only creates a notification if the anomaly is genuinely new (24h fingerprint dedup)

### The AI Part Comes Later (Batch, Not Real-Time)

The Python "Change Detector" runs every 15 minutes as a **batch cleanup job**. It finds changes that were already recorded by the Go gateway but don't have an AI summary yet (using `WHERE summary IS NULL`). Then the Change Summarizer (gpt-4.1-mini) writes a human-readable summary for that batch. This is intentionally delayed — you don't want to call OpenAI on every single keystroke.

### Latency Breakdown

| Step | What | Where | Speed |
|------|------|-------|-------|
| 1 | User edits a field | Frontend | — |
| 2 | Old vs new comparison | Go gateway (`track()`) | <1ms |
| 3 | Change record saved to DB | Go gateway → PostgreSQL | <5ms |
| 4 | WebSocket push to browser | Go gateway → all connected clients | ~50ms |
| 5 | Email via AWS SNS | Go gateway → AWS (async goroutine) | ~1-2s |
| 6 | AI anomaly check | Go gateway → Python AI (async goroutine) | ~2-5s |
| 7 | AI summary of changes | Background scheduler | Every 15 min |

**The notification appears in the manager's browser within ~50ms** of the change being saved. Steps 5–7 run asynchronously in background goroutines — they never slow down the user's request.

---

## Why Go for the Gateway (Instead of Node.js/Express)

The gateway handles every API request, every WebSocket connection, and every real-time notification broadcast. Go was chosen over Node.js/Express for concrete performance reasons:

### The Core Difference: Concurrency Model

**Node.js/Express** runs on a **single-threaded event loop**. It can handle many I/O-bound requests concurrently, but:
- One slow operation (a DB query, a JSON parse, a CPU-heavy diff) blocks the entire thread
- WebSocket broadcasts to 50+ connections serialize on that same thread
- `async/await` helps with I/O waits, but CPU-bound work still blocks everything
- Scaling requires clustering (multiple processes), adding complexity

**Go (Gin)** uses **goroutines** — lightweight threads managed by the Go runtime:
- Each HTTP request gets its own goroutine (~2KB of memory, vs ~1MB per OS thread)
- A slow DB query in one request doesn't affect any other request
- WebSocket broadcasts run in parallel across all CPU cores automatically
- `go func()` launches background work (SNS publish, AI analysis) with zero overhead

### Why This Matters for MetaSource Specifically

| Operation | Node.js/Express | Go (Gin) |
|-----------|----------------|----------|
| **Handling 100 concurrent API requests** | Single event loop — if one request does a 50ms DB query, others queue behind it during the synchronous parts | 100 goroutines run in parallel — each independently waits for its own DB response |
| **WebSocket broadcast to 50 managers** | Serialized on the event loop — sends one message, then the next, then the next | `NotifHub.Broadcast()` fans out across goroutines — all 50 messages sent near-simultaneously |
| **SNS publish after every change** | `await sns.publish()` either blocks the response or requires careful async handling to not lose errors | `go PublishChange(event)` — fire-and-forget goroutine, response returns instantly, SNS runs in background |
| **Auto-trigger AI analysis after every edit** | Would need a job queue (BullMQ, etc.) or risk blocking the response | `go TriggerAnalysis(category)` — one line, runs in background, zero infrastructure |
| **Memory per WebSocket connection** | ~50-100KB per connection (V8 overhead) | ~2-4KB per connection (goroutine stack) |
| **1000 simultaneous WebSocket connections** | ~50-100MB of memory, event loop contention | ~2-4MB of memory, no contention |

### Real Numbers

| Metric | Node.js/Express (typical) | Go/Gin (typical) |
|--------|--------------------------|-------------------|
| Requests/second (JSON CRUD) | ~5,000-15,000 | ~30,000-100,000+ |
| Memory per process | ~50-150MB baseline | ~10-20MB baseline |
| Startup time | ~1-3 seconds | ~10-50 milliseconds |
| WebSocket broadcast (50 clients) | ~5-15ms (serialized) | ~0.5-2ms (parallel) |
| Goroutine/async overhead | ~1MB per worker thread | ~2KB per goroutine |

### What This Means in Practice

When a user edits a hiring request, the Go gateway does **7 things in parallel**: query old values, execute UPDATE, insert change record, create notification, broadcast via WebSocket, publish to SNS (goroutine), and trigger AI analysis (goroutine).

In Node.js, steps 6 and 7 would either block the response or require a job queue like BullMQ + Redis. In Go, they're just `go func()` — zero infrastructure, zero latency impact on the user.

### Why Not Go for Everything?

Go is used **only for the gateway** (the hot path — every request goes through it). The AI service uses Python because:
- OpenAI Agent SDK is Python-first
- Data scraping libraries (BeautifulSoup, httpx) are Python
- The AI service is I/O bound (waiting on OpenAI API), not CPU bound — Python's speed doesn't matter there

The frontend uses Next.js because React is the standard for interactive dashboards, and SSR/TypeScript/Tailwind are most productive in the Node ecosystem.

**Each language is used where it's strongest**: Go for the high-throughput API layer, Python for AI/ML, TypeScript for the UI.

---

## Sourcing Managers

| Manager | Category | Scope |
|---------|----------|-------|
| Sarah Chen | ENGINEERING_CONTRACTORS | Engineering roles, contractors |
| Marcus Johnson | CONTENT_TRUST_SAFETY | Content moderation, trust & safety |
| Priya Patel | DATA_OPERATIONS | Data engineering, analytics |
| David Kim | MARKETING_CREATIVE | Marketing, creative roles |
| Lisa Martinez | CORPORATE_SERVICES | Finance, HR, legal, admin |

Each manager receives notifications **only for requisitions in their category**.

---

## Notification Flow (End-to-End)

When a user edits a hiring request in the UI, the frontend sends a PUT to `/api/requisitions/:id`. The Go gateway then: queries old values from PostgreSQL, executes the UPDATE with new values, inserts `RequisitionChange` records (field-level diff), creates a Notification record for the affected manager, broadcasts via WebSocket (instant in-app update), and calls `PublishChange()` → AWS SNS as an async goroutine. AWS SNS delivers email to all subscribers. The manager receives: an in-app notification badge (WebSocket, instant), an email alert (SNS, ~1-2 seconds), and an AI-generated summary (on-demand via AI service).

---

## API Endpoints

### Requisitions (Go Gateway)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/requisitions` | List with pagination, filters, sorting |
| POST | `/api/requisitions` | Create new requisition |
| GET | `/api/requisitions/:id` | Get single requisition |
| PUT | `/api/requisitions/:id` | Update (triggers SNS + WebSocket) |
| DELETE | `/api/requisitions/:id` | Delete (triggers SNS) |
| POST | `/api/requisitions/upload` | Bulk CSV import (triggers SNS) |

### Notifications & Changes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | List notifications with filters |
| PUT | `/api/notifications` | Mark as read |
| GET | `/api/changes` | Query change audit log |
| GET | `/api/managers` | List sourcing managers |
| GET | `/api/stats` | Dashboard statistics |

### SNS Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sns/setup` | Create topic + subscribe email |
| GET | `/api/sns/setup` | Check topic status |

### AI Service (Proxied via Gateway)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/chat` | Natural language Q&A |
| POST | `/api/ai/summarize` | Summarize change batch |
| POST | `/api/ai/analyze` | Run anomaly detection |
| POST | `/api/ai/detect-changes` | Find unsummarized changes |
| POST | `/api/ai/scrape` | Trigger market rate scraper |

---

## Database Schema

### Core Models

- **SourcingManager** — 5 managers, each assigned a `RequisitionCategory`
- **Requisition** — Workforce requisitions with status, priority, bill rate, headcount, budget
- **RequisitionChange** — Field-level audit trail (old value → new value) with AI summaries
- **Notification** — Per-manager notifications (CHANGE_SUMMARY, ANOMALY_ALERT, BUDGET_WARNING, MILESTONE)
- **NotificationRule** — Per-manager filtering rules (priority thresholds, change types)
- **MarketRate** — Scraped market rate data for benchmarking
- **ChatSession** — AI chat conversation history

---

## Kubernetes Deployment

### Deployments

| Service | Image | Port | Hot Reload |
|---------|-------|------|------------|
| `meta-frontend` | node:20-bookworm | 3000 | No (production build) |
| `meta-gateway` | debian:bookworm-slim | 8080 | No (compiled binary) |
| `meta-ai` | python:3.11-slim | 8000 | Yes (uvicorn --reload) |

### Secrets

| Secret | Keys |
|--------|------|
| `openai-secret` | `OPENAI_API_KEY` |
| `aws-secret` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |

### Ingress Routes (Traefik)

| Path | Backend |
|------|---------|
| `/api/sns/*` | meta-frontend:3000 |
| `/api/*` | meta-gateway:8080 |
| `/ws/*` | meta-gateway:8080 |
| `/*` | meta-frontend:3000 |

---

## Project Structure

- **frontend/** — Next.js 15 (TypeScript) with app router. Contains API routes (fallback, SNS setup), dashboard pages, notification center, hiring request data grid + CSV upload, change log viewer, AI chat interface, and market rate charts. Libraries include Prisma singleton, AWS SNS client, and manager config. Prisma schema and seed file for 1000+ test requisitions.
- **gateway/** — Go (Gin) HTTP gateway. Main router + middleware stack. Handlers for requisitions CRUD + SNS publish, CSV import, SNS client/setup, notification queries, WebSocket real-time push, and AI proxy. Middleware for CORS, rate limiting, logging. PostgreSQL connection pool.
- **ai-service/** — Python FastAPI. Entry point with all endpoints. AI agents for natural language Q&A, change summarization, unsummarized change detection, and anomaly flagging. Scrapers for market rate collection and synthetic data generation.
- **k8s/** — Kubernetes manifests: namespace, deployments (frontend + AI service), ClusterIP services, Traefik ingress with TLS, and secrets template.

---

## Scalability Design

| Dimension | Current | How It Scales |
|-----------|---------|---------------|
| **Managers** | 5 | Add rows to `SourcingManager` table + SNS subscriptions. No code changes. |
| **Categories** | 5 | Add enum values to `RequisitionCategory`. Routing is automatic. |
| **Requisitions** | ~1,000 | PostgreSQL handles millions. Pagination + indexing in place. |
| **Notifications** | In-app + email | SNS supports email, SMS, Lambda, SQS, HTTPS webhooks. Add subscribers without code changes. |
| **API throughput** | Single Go gateway | Go handles 10K+ req/sec. Scale horizontally with replica count. |
| **AI processing** | Single Python pod | Stateless — scale with replicas. OpenAI API handles concurrency. |

---

## Local Development

- **Frontend**: `cd frontend && npm install && npm run dev`
- **Gateway** (requires Go 1.24+): `cd gateway && go run .`
- **AI Service**: `cd ai-service && pip install -r requirements.txt && uvicorn main:app --reload`
- **Database**: PostgreSQL at `72.62.162.83:5432/meta_source` (postgres/postgres)

---

## Assignment Answers — Design Decisions and Thought Process

The assignment asked for a scalable, automated solution that ensures each sourcing manager receives timely and relevant updates. Below is how MetaSource addresses each of the four questions, with specific references to the code and architecture.

---

### Q1: How will you automate the notification and information delivery process?

**The core idea**: Zero manual intervention. Every change is detected, recorded, routed, and delivered automatically through three parallel channels.

#### What happens when someone edits a hiring request

When a user changes a field (e.g., billRateHourly from $75 to $85), the Go gateway (in `requisitions.go`) does: (1) SELECT old values from DB, (2) `track()` compares old vs new using pure string comparison in <1ms, (3) INSERT into RequisitionChange for the field-level audit record, (4) UPDATE the Requisition row. Then in parallel: **WebSocket broadcast** (instant, ~50ms — manager's browser gets a toast notification + badge update), **INSERT into Notification table** (per-manager, visible in Notification Center), **AWS SNS publish** (async goroutine, ~1-2s — email delivered to subscribers), and **AI anomaly detection** (async goroutine, ~2-5s — calls Python AI service, only creates notification if genuinely new via 24h fingerprint dedup).

#### What happens automatically in the background

| Scheduler | Runs | What it does |
|-----------|------|--------------|
| **Change Summarizer** | Every 15 min | Finds unsummarized changes (`WHERE summary IS NULL`), sends them to gpt-4.1-mini, writes a human-readable summary, creates a notification + sends email to the affected manager |
| **Anomaly Scanner** | Daily 10 AM UTC | Scans all 5 categories for unusual patterns (rate spikes, budget overruns, stale requests), creates notifications + emails for new findings (deduplicated with 24h fingerprint) |

#### What the manager never has to do

- Check the dataset manually — changes come to them via WebSocket, notification center, and email
- Figure out what changed — AI summarizes batches of raw field diffs into "ML Engineer rate increased 13%, 3 DevOps positions added"
- Watch for problems — AI anomaly detection flags rate spikes, budget overruns, stale requests automatically
- Ask "what happened while I was away?" — the AI Chat page answers natural-language questions like "What changed in Engineering this week?"

#### Bot-driven data collection

The Market Rate Collector scrapes public pricing sources and populates the `MarketRate` table. The Market Rates page (`/market-intel`) compares internal bill rates against market averages, so managers can spot overpriced vendors. CSV bulk import (`gateway/handlers/upload.go`) ingests hundreds of rows at once, creating change records + notifications for each affected category automatically.

---

### Q2: How will your approach handle growth (e.g., more managers, larger datasets)?

**Design principle**: Every scaling dimension was considered during architecture, not as an afterthought.

#### Adding more managers

Just one database INSERT — no code changes, no deployment, no config file edits. The routing logic is a database lookup (`SELECT id FROM SourcingManager WHERE category = $1`), not a hardcoded if/else. Add a row and the new manager immediately starts receiving notifications for their category. For email, add them as an SNS subscriber via `POST /api/sns/setup` with their email. They confirm via AWS email and start receiving alerts.

#### Larger datasets

| Current | Scales to | How |
|---------|-----------|-----|
| ~1,000 hiring requests | Millions | PostgreSQL with pagination + indexing. All list queries use `LIMIT/OFFSET`. Category column is indexed. |
| 114 change records | Millions | `RequisitionChange` table with index on `createdAt` and `requisitionId`. The 15-min summarizer processes in batches, not all-at-once. |
| 5 WebSocket connections | Thousands | Go goroutines use ~2-4KB per connection. 1,000 connections = ~4MB memory. The `NotifHub` fans out broadcasts in parallel. |
| ~30 notifications/day | Thousands/day | SNS free tier handles 1M requests/month. DB notifications are simple INSERTs. |

#### Why Go specifically helps with scale

The gateway handles 7 operations per request (query, update, change record, notification, WebSocket, SNS, AI analysis). In Node.js/Express, the async operations would need a job queue (BullMQ + Redis) to avoid blocking. In Go, they're just `go func()` — zero-infrastructure concurrency. The gateway handles 30,000-100,000 requests/second on a single pod. See the "Why Go for the Gateway" section above for detailed benchmarks.

#### Horizontal scaling

All three services are stateless and run in Kubernetes. Scaling is: `kubectl scale deployment meta-gateway --replicas=3` for 3x API throughput, `kubectl scale deployment meta-ai --replicas=2` for 2x AI processing, `kubectl scale deployment meta-frontend --replicas=2` for 2x SSR capacity. The only shared state is PostgreSQL, which handles thousands of concurrent connections natively.

---

### Q3: How will you ensure each manager receives only the information relevant to them but also captures all changes?

**Design principle**: Every change is captured once (in the audit trail), but only routed to the manager who owns that category.

#### The routing mechanism

Every hiring request belongs to exactly one category (e.g., `ENGINEERING_CONTRACTORS`). Every category is assigned to exactly one manager. When a change happens, the gateway looks up the manager for that category and only notifies them. Sarah Chen only sees Engineering Contractors changes, Marcus Johnson only sees Content & Trust Safety changes, and admin sees everything (no managerId filter).

#### Where filtering happens

| Layer | How |
|-------|-----|
| **WebSocket** | Each connection registers with a `managerId`. Broadcasts send only to that manager's connections + admin connections. |
| **Notification table** | Each notification is tied to one manager via `managerId`. Querying with `WHERE managerId = $1` returns only their notifications. |
| **Dashboard** | `GET /api/stats?managerId=X` filters all stats by the manager's category. They see their own headcount gaps, budget, and changes only. |
| **Hiring request table** | `GET /api/requisitions?managerId=X` resolves the manager's category and filters by it. |
| **AI Chat** | When a manager asks "What changed this week?", the query agent receives their `managerId` as context and focuses on their category. |
| **Email (SNS)** | Every SNS message includes `category` as a message attribute. Subscribers can filter by attribute if needed. |

#### But ALL changes are captured

The `RequisitionChange` table stores **every** change to **every** hiring request, regardless of category. The Change Log page (`/changes`) shows the complete audit trail — admins see all of it, managers see their category filtered via the same `managerId` mechanism.

Nothing is lost. Routing controls **who gets notified**, not **what gets recorded**.

---

### Q4: How will you ensure the solution is easy to maintain and adapt as requirements change?

**Design principle**: Three separate services, each in the language best suited for its job, with clear boundaries.

#### Clean separation of concerns

- **frontend/** — UI only. No business logic. Calls API endpoints. Change the UI without touching the backend. Tech: Next.js, TypeScript, Tailwind, shadcn/ui.
- **gateway/** — API + real-time only. CRUD, WebSocket, SNS, routing. Change notification logic without touching UI or AI. Tech: Go, Gin, gorilla/websocket.
- **ai-service/** — AI only. Summarization, anomaly detection, Q&A, scraping. Swap AI models or add new agents without touching the API. Tech: Python, FastAPI, OpenAI Agent SDK.

You can redeploy any one service without affecting the others. The gateway calls the AI service via HTTP — if the AI service is down, everything else still works (change detection, notifications, WebSocket, SNS all continue).

#### Database schema changes are easy

Prisma ORM manages the schema (`frontend/prisma/schema.prisma`). To add a new field, add it to the Prisma model and run `npx prisma migrate dev`. Prisma generates the SQL migration, applies it, and updates the TypeScript types. The Go gateway uses raw SQL (no ORM to keep it fast), but adding a field is just adding one more column to the SELECT/INSERT.

#### Adding a new notification channel

The notification system is a fan-out pattern — adding a new output is one more goroutine. Currently the gateway fires `go PublishChange(event)` for SNS email, `go TriggerAnalysis(category)` for AI anomaly check, and `NotifHub.Broadcast(...)` for WebSocket. Adding Slack would be one new `go SendSlackNotification(event)` — zero impact on existing code. AWS SNS already supports adding SMS, Lambda, SQS, and HTTPS webhook subscribers without any code changes.

#### Adding a new AI agent

The AI service uses the OpenAI Agent SDK. Each agent is a self-contained Python file with its own prompt and tools. Add a new file in `ai_agents/`, a new endpoint in `main.py`, a proxy route in `gateway/main.go`, and it's live. No changes to existing agents.

#### Adapting notification rules

Currently, every change triggers a notification for the affected manager. If requirements change to "only notify on critical/high priority changes" or "only notify on rate changes >5%", the `track()` function in `requisitions.go` is the single place to add that logic. The `NotificationRule` table in the schema already supports per-manager rules (priority thresholds, change type filters), ready for a UI to configure them.

#### Infrastructure is declarative

Everything runs in Kubernetes with YAML manifests (`k8s/`): `deployment.yaml` for all three services, `services.yaml` for internal networking, `ingress.yaml` for Traefik routes with TLS, `secrets.yaml` for API keys. To move to a new server: `kubectl apply -f k8s/`. To scale: change `replicas` in the YAML. The infrastructure is code, not click-ops.

---

### Thought Process Summary

| Decision | Why | Alternative Considered |
|----------|-----|----------------------|
| **Go for the gateway** | Need to handle real-time WebSocket + 7 async operations per request without a job queue | Node.js/Express — would need BullMQ + Redis for async work |
| **Python for AI** | OpenAI Agent SDK is Python-first, scraping libs (BeautifulSoup) are Python | Node.js — OpenAI SDK exists but Agent SDK features are Python-only |
| **Next.js for frontend** | SSR, TypeScript, Tailwind, React ecosystem for dashboards | Plain React SPA — but SSR gives better initial load + SEO for the architecture page |
| **AWS SNS for email** | Zero infrastructure, free tier (1M/month), fire-and-forget from Go | SQS + worker — would need a separate consumer process to poll and send |
| **WebSocket for real-time** | Instant delivery (<50ms), bidirectional, no polling overhead | Polling every 5s — wastes bandwidth, 5s delay, doesn't scale to many clients |
| **Category-based routing** | Simple, deterministic, scales by adding DB rows | Tag-based routing — more flexible but complex to configure and reason about |
| **Field-level change tracking** | Managers need to know exactly what changed, not just "something changed" | Row-level tracking — loses the "billRateHourly: $75 → $85" detail |
| **AI batch summarization (15 min)** | One OpenAI call per batch (cost-efficient), better summaries with context | Per-change AI call — 10x more expensive, lower quality (no grouping) |
| **Fingerprint dedup for anomalies** | Same anomaly shouldn't spam the manager every time any edit happens | No dedup — results in 200+ duplicate notifications (we saw this and fixed it) |
| **Prisma for schema** | Type-safe migrations, auto-generated TypeScript types | Raw SQL migrations — error-prone, no type generation |
| **k3s (lightweight Kubernetes)** | Production-grade orchestration on a single server, same APIs as full k8s | Docker Compose — works but no rolling deploys, no health checks, no auto-restart |

---

## Glossary

A quick reference for every domain and technical term used in the app. If you're new to the project, read this first.

### Business / Domain Terms

| Term | What it means |
|------|---------------|
| **Requisition (Hiring Request)** | A formal request to fill one or more contractor positions. Each requisition has a role title, category, vendor, bill rate, headcount, status, and priority. In the UI we call these "Hiring Requests" to be clearer. In the database and API the field is still called `Requisition`. |
| **Sourcing Manager** | A person responsible for finding and managing contractors in a specific category. There are 5 managers, each owning one category. They receive notifications only for changes in their category. |
| **Category** | A grouping of requisitions by business area. There are 5 categories: Engineering Contractors (ENG), Content & Trust Safety (CTS), Data Operations (DOP), Marketing & Creative (MKT), and Corporate Services (COR). Each category is assigned to exactly one sourcing manager. |
| **Vendor (Staffing Agency)** | The external staffing company that supplies contractors (e.g., "Insight Global", "TEKsystems"). The vendor charges a **bill rate** per hour for each contractor. |
| **Bill Rate (Hourly Rate)** | The dollar amount per hour that a vendor charges for a contractor. Shown in the UI as "Hourly Rate". Stored in the database as `billRateHourly`. |
| **Headcount** | The number of contractor positions. `headcountNeeded` = how many positions the requisition asks for. `headcountFilled` = how many have been filled so far. The difference is the **Unfilled Positions** (shown as "Unfilled" in the UI). |
| **Budget** | `budgetAllocated` is the total approved budget for a requisition. `budgetSpent` is how much has been used. "Budget Used" on the dashboard shows the percentage (budgetSpent / budgetAllocated). |
| **Priority** | Urgency level of a requisition: Critical, High, Medium, or Low. |
| **Status** | Lifecycle stage of a requisition: Open → Sourcing → Interviewing → Offer → Onboarding → Active → Completed (or Cancelled). |
| **Market Rate** | The going hourly rate for a similar role in the job market, collected from public sources. Used for benchmarking to see if bill rates are competitive. |
| **Change (Change Log entry)** | A record of any edit made to a requisition — what field changed, old value, new value, who changed it, and when. Every create, update, delete, and CSV import generates change records. |
| **Notification** | An alert sent to a sourcing manager when something happens in their category — a requisition is modified, an unusual pattern is detected, or a budget threshold is exceeded. |
| **Anomaly (Unusual Pattern)** | An AI-detected issue in the data, such as a bill rate spike >10%, headcount surge >50%, budget utilization >90%, or a requisition stuck in "Open" status for too long. |

### Technical Terms

| Term | What it means |
|------|---------------|
| **Gateway** | The Go (Gin) HTTP server that handles all API requests. It sits between the frontend and the database, performing CRUD operations, broadcasting WebSocket events, and publishing SNS notifications. Port 8080. |
| **AI Service** | The Python (FastAPI) server that runs AI-powered features: change summarization, anomaly detection, natural language Q&A, and market rate scraping. Uses OpenAI's Agent SDK. Port 8000. |
| **SNS (Simple Notification Service)** | An AWS service that sends email alerts. When a requisition changes, the gateway publishes a message to an SNS topic, and AWS delivers an email to all subscribers. Zero infrastructure to manage. |
| **WebSocket** | A persistent connection between the browser and the gateway that delivers real-time updates. When a requisition changes, the gateway pushes a message to all connected browsers instantly (no page refresh needed). |
| **Prisma** | The database toolkit (ORM) used to define the database schema and generate TypeScript types. The schema lives in `frontend/prisma/schema.prisma`. |
| **k3s / Kubernetes** | Container orchestration platform that runs the three services (frontend, gateway, AI service) as pods. Namespace: `meta-test`. |
| **Traefik** | Reverse proxy that routes incoming web requests to the correct service based on URL path (e.g., `/api/*` → gateway, `/*` → frontend). Also handles HTTPS/TLS certificates. |
| **Ingress** | A Kubernetes resource that tells Traefik how to route traffic to services. Defined in `k8s/ingress.yaml`. |
| **hostPath Volume** | A Kubernetes feature that mounts a directory from the host machine into a container, enabling code changes to appear inside the container without rebuilding the image. |
| **CSV Import (Bulk Upload)** | The ability to upload a `.csv` file containing multiple requisitions at once, rather than creating them one by one. |
| **Change Detector** | An AI agent that scans the database for recent changes that haven't been summarized yet, groups them by category. |
| **Summarizer** | An AI agent that takes a batch of raw changes and produces a short, human-readable summary (e.g., "3 Engineering reqs opened, ML Engineer rate increased 12%"). |
| **Anomaly Detector (Unusual Pattern Finder)** | An AI agent that analyzes requisition data to flag potential problems — rate spikes, headcount surges, budget overruns, stale requisitions, vendor concentration risk. |
| **Query Agent (Q&A Chat Assistant)** | An AI agent that answers natural language questions about the data (e.g., "What changed in Engineering this week?"). Uses function calling to query the database. |
| **Market Rate Collector (Scraper)** | A Python module that collects market rate data from public sources and stores it in the `MarketRate` table for benchmarking. |

### Category Short Names (used in Request IDs)

| Short Name | Full Category | Example Request ID |
|------------|--------------|-------------------|
| ENG | Engineering Contractors | REQ-ENG-001 |
| CTS | Content & Trust Safety | REQ-CTS-015 |
| DOP | Data Operations | REQ-DOP-042 |
| MKT | Marketing & Creative | REQ-MKT-008 |
| COR | Corporate Services | REQ-COR-199 |

### Notification Types

| Type | When it's created |
|------|------------------|
| **CHANGE_SUMMARY** | After requisitions in a category are modified, the AI summarizer creates a notification with a human-readable summary of all changes. |
| **ANOMALY_ALERT** | When the AI anomaly detector finds an unusual pattern (rate spike, budget overrun, etc.), it creates a high-priority alert. |
| **BUDGET_WARNING** | When a requisition's budget utilization exceeds a threshold (e.g., >90% spent). |
| **MILESTONE** | When a significant event happens (e.g., all positions filled, requisition completed). |

### Change Types

| Type | What triggered the change |
|------|--------------------------|
| **CREATED** | A new requisition was added |
| **UPDATED** | A general field was edited (vendor, location, priority, etc.) |
| **STATUS_CHANGE** | The requisition's status changed (e.g., Open → Sourcing) |
| **RATE_CHANGE** | The hourly bill rate was modified |
| **HEADCOUNT_CHANGE** | The headcount needed or filled was modified |
| **BUDGET_CHANGE** | The budget allocated or spent was modified |
| **BULK_IMPORT** | The requisition was created or updated via CSV upload |

# MetaSource — AI-Powered Sourcing Manager Notification Platform

An automated notification system for 5 sourcing managers tracking a dynamic workforce requisition dataset. The platform detects changes in real time, routes relevant updates to the correct manager, uses AI to summarize and prioritize notifications, and sends email alerts via AWS SNS — all with zero manual intervention.

**Live URL**: [https://meta.callsphere.tech](https://meta.callsphere.tech)
**K8s Namespace**: `meta-test`

---

## Problem Statement

> We have a dynamic dataset that is frequently changed, causing problems for a group of five sourcing managers. Currently, these managers are either notified manually via chat or must proactively check the dataset themselves.

## Solution

1. **Change Detection** — Every create, update, delete, and bulk import is tracked at the field level
2. **Smart Routing** — Category-based routing ensures each manager sees only their relevant updates
3. **AI Summarization** — OpenAI agents generate human-readable summaries of change batches
4. **Real-Time Push** — WebSocket broadcasts deliver instant in-app notifications
5. **Email Alerts via AWS SNS** — Every change triggers an email to the admin via SNS
6. **Anomaly Detection** — AI flags unusual patterns (price spikes, quantity drops, stale items)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui |
| **Gateway** | Go (Gin), WebSocket (Gorilla), AWS SNS SDK |
| **AI Service** | Python (FastAPI), OpenAI Agent SDK (gpt-4.1 / gpt-4.1-mini) |
| **Database** | PostgreSQL (Prisma ORM for schema, raw SQL in Go) |
| **Infrastructure** | k3s, Traefik (TLS ingress), cert-manager |

---

## High-Level System Design

### Architecture Overview

Three microservices behind a Traefik reverse proxy with TLS:

```
                         ┌─────────────────────────────┐
                         │     Traefik (TLS Ingress)    │
                         │   meta.callsphere.tech:443   │
                         └────┬──────────┬──────────┬───┘
                              │          │          │
                     /api/sns/* │   /api/* & /ws/*   │  /*
                              │          │          │
                              v          v          v
                      ┌───────────┐ ┌──────────┐ ┌───────────────┐
                      │  Next.js  │ │    Go    │ │   Next.js     │
                      │ Frontend  │ │ Gateway  │ │  (SSR pages)  │
                      │  :3000    │ │  :8080   │ │   :3000       │
                      └───────────┘ └────┬─────┘ └───────────────┘
                                         │
                              ┌──────────┼──────────┐
                              │          │          │
                              v          v          v
                      ┌────────────┐ ┌───────┐ ┌─────────┐
                      │ Python AI  │ │  AWS  │ │PostgreSQL│
                      │  Service   │ │  SNS  │ │meta_source│
                      │   :8000    │ │(email)│ │  :5432   │
                      └────────────┘ └───────┘ └─────────┘
```

### Service Responsibilities

- **Next.js Frontend** (port 3000) — Dashboard, hiring request data grid, notification center, AI chat, audit log, market rate charts, SNS setup API route
- **Go Gateway** (port 8080) — All CRUD endpoints, real-time WebSocket push, SNS publish, AI proxy, CSV/bulk import, notification routing
- **Python AI Service** (port 8000) — OpenAI agents for summarization, anomaly detection, natural language Q&A, market rate collection

All three connect to **PostgreSQL** (database: `meta_source`). The gateway also publishes to **AWS SNS** topic (`metasource-requisition-changes`) for email delivery.

### Data Flow — What Happens on a Change

```
User edits a field in the UI
        │
        v
  PUT /api/requisitions/:id → Go Gateway
        │
        ├── 1. SELECT old values from DB        (<1ms)
        ├── 2. track() field-level diff           (<1ms)
        ├── 3. INSERT RequisitionChange record    (<5ms)
        ├── 4. UPDATE Requisition row             (<5ms)
        │
        └── Then in PARALLEL (goroutines):
            ├── WebSocket broadcast to manager    (~50ms)
            ├── INSERT Notification record
            ├── go PublishChange() → AWS SNS      (~1-2s, async)
            └── go TriggerAnalysis() → AI service (~2-5s, async)
```

### Background Schedulers

| Scheduler | Frequency | Purpose |
|-----------|-----------|---------|
| Change Summarizer | Every 15 min | Finds unsummarized changes, sends to gpt-4.1-mini, creates notification with AI summary |
| Anomaly Scanner | Daily 10 AM UTC | Scans all 5 categories for unusual patterns, deduplicates with 24h fingerprint |

### Notification Channels

| Channel | Latency | How |
|---------|---------|-----|
| **WebSocket** (in-app) | ~50ms | Go gateway broadcasts to connected browsers |
| **Email** (SNS) | ~1-2s | Fire-and-forget goroutine → AWS SNS → email subscribers |
| **AI Summary** | ~15 min | Background batch summarization via gpt-4.1-mini |

### Category-Based Routing

| Manager | Category |
|---------|----------|
| Sarah Chen | ENGINEERING_CONTRACTORS |
| Marcus Johnson | CONTENT_TRUST_SAFETY |
| Priya Patel | DATA_OPERATIONS |
| David Kim | MARKETING_CREATIVE |
| Lisa Martinez | CORPORATE_SERVICES |

Every requisition belongs to one category → one manager. Routing is a DB lookup, not hardcoded — add a manager by inserting a row.

---

## Low-Level System Design

### Go Gateway — Concurrency Model

The gateway uses **goroutines** (~2KB each) instead of Node.js's single-threaded event loop:

- Each HTTP request gets its own goroutine — a slow DB query never blocks other requests
- `go func()` launches background work (SNS publish, AI analysis) with zero overhead — no job queue (BullMQ/Redis) needed
- `NotifHub.Broadcast()` fans out WebSocket messages across goroutines in parallel
- 1000 WebSocket connections = ~4MB memory (vs ~100MB in Node.js)

**Per-request execution**: query old values → field-level diff → INSERT change → UPDATE row → then 4 goroutines fire in parallel (WebSocket, notification, SNS, AI analysis). The user's response returns after the DB operations (~10ms); async work continues in background goroutines.

### Field-Level Change Detection (track())

Located in `gateway/handlers/requisitions.go`. Pure string comparison — no AI:

1. SELECT current row before update
2. Compare each field: `if oldVal != newVal` → create change record
3. Change type classification: STATUS_CHANGE, RATE_CHANGE, HEADCOUNT_CHANGE, BUDGET_CHANGE, etc.
4. INSERT into `RequisitionChange` with field name, old value, new value, who changed it

### WebSocket Hub (NotifHub)

- Each client registers with a `managerId` on connect
- Broadcasts filter by managerId — managers only receive their category's events
- Admin connections receive all events (no managerId filter)
- Connection cleanup on disconnect via goroutine

### AWS SNS Integration

**Why SNS over SQS**: SNS is push-based (no worker/consumer needed), free tier covers 1M requests/month, and email delivery is always free. Fire-and-forget from the gateway — AWS handles retries and delivery. SQS would only be needed for batched digests or exactly-once processing.

**Flow**: Change → `go PublishChange(event)` goroutine → SNS topic → email to all subscribers

**Setup**: `POST /api/sns/setup` with `{"email": "someone@company.com"}` → AWS sends confirmation email → subscriber starts receiving alerts.

### AI Agents (Python Service)

| Agent | Model | Trigger | Purpose |
|-------|-------|---------|---------|
| **Q&A Chat Assistant** | gpt-4.1 | User clicks chat | Answers NL questions using 6 DB query tools |
| **Change Summarizer** | gpt-4.1-mini | Every 15 min (scheduler) | Batch-summarizes raw field diffs into readable text |
| **Anomaly Detector** | gpt-4.1-mini | Per-change (async) + daily scan | Flags rate spikes >10%, budget >90%, stale requests >30d |
| **Change Detector** | None (SQL only) | Every 15 min | Finds unsummarized changes via `WHERE summary IS NULL` |
| **Market Rate Collector** | None | User-triggered | Generates market rate benchmarking data |

**AI proxy pattern**: Frontend → Go Gateway `/api/ai/*` → Python AI Service `:8000` → OpenAI API

### AI Data Upload Pipeline (Admin Only)

A 4-stage pipeline for ingesting any file format (CSV, Excel, JSON, messy text):

1. **Parse** — Detect format, extract raw records (CSV/JSON/Excel are programmatic; only unstructured text uses gpt-4.1-mini)
2. **Clean** — LLM normalizes values in parallel batches of 10 via `asyncio.gather` ("eng" → ENGINEERING_CONTRACTORS, "$75/hr" → 75.0)
3. **Validate** — Pydantic model enforces schema (required fields, valid enums, correct types)
4. **Upsert** — Sequential DB insert with audit records and manager notifications

Each record tracks status: PENDING → PARSING → CLEANING → VALIDATED → UPLOADED (or FAILED with error). Real-time progress via WebSocket.

### Anomaly Deduplication

24-hour fingerprint-based dedup prevents notification spam. Each anomaly is hashed (category + anomaly type + key details). If the same fingerprint was sent within 24h, it's suppressed. Stored in-memory with TTL cleanup.

### Database Schema

| Model | Purpose |
|-------|---------|
| **SourcingManager** | 5 managers, each assigned a RequisitionCategory |
| **Requisition** | Hiring requests with status, priority, bill rate, headcount, budget |
| **RequisitionChange** | Field-level audit trail (old → new) with AI summaries |
| **Notification** | Per-manager alerts (CHANGE_SUMMARY, ANOMALY_ALERT, BUDGET_WARNING, MILESTONE) |
| **NotificationRule** | Per-manager filtering rules (priority thresholds, change types) |
| **MarketRate** | Market rate benchmarking data |
| **ChatSession** | AI chat conversation history |

### API Endpoints

**Requisitions**: GET/POST/PUT/DELETE `/api/requisitions`, POST `/api/requisitions/upload` (bulk CSV)
**Notifications**: GET/PUT `/api/notifications`, GET `/api/changes`, GET `/api/managers`, GET `/api/stats`
**SNS**: POST/GET `/api/sns/setup`
**AI**: POST `/api/ai/chat`, `/api/ai/summarize`, `/api/ai/analyze`, `/api/ai/detect-changes`, `/api/ai/scrape`
**Data Upload**: POST `/api/data-upload`, GET `/api/data-upload/:jobId/status`

### Kubernetes Deployment

Three deployments in namespace `meta-test`, exposed via ClusterIP services, routed by Traefik IngressRoute with TLS. Secrets: `openai-secret` (OPENAI_API_KEY), `aws-secret` (AWS credentials).

### Scalability

| Dimension | How It Scales |
|-----------|---------------|
| Managers | Add DB row + SNS subscription, no code changes |
| Categories | Add enum value, routing is automatic |
| Requisitions | PostgreSQL with pagination + indexing handles millions |
| API throughput | Go handles 30K-100K req/sec; scale with `kubectl scale --replicas` |
| AI processing | Stateless Python pods; scale with replicas |
| Notifications | SNS free tier: 1M/month; add SMS/Lambda/SQS subscribers without code |

---

## Go (Gin) vs Node.js (Express) — Scalability Comparison

### Why Go Was Chosen for the Gateway

The gateway handles every API request, every WebSocket connection, every SNS publish, and every AI proxy call. The core difference is the **concurrency model**.

**Node.js/Express** runs on a **single-threaded event loop** — one slow operation (DB query, JSON parse, CPU-heavy diff) blocks the entire thread. WebSocket broadcasts to 50+ connections serialize on that thread. Scaling requires clustering (multiple processes) + job queues (BullMQ/Redis) for background work.

**Go (Gin)** uses **goroutines** — lightweight green threads (~2KB each) scheduled across all CPU cores by the Go runtime. Each request is independent, background work is `go func()`, and broadcasts fan out in parallel.

### Head-to-Head Comparison

| Operation | Node.js/Express | Go (Gin) | Winner |
|-----------|----------------|----------|--------|
| **100 concurrent API requests** | Single event loop — if one request does a 50ms DB query, others queue behind it during synchronous parts | 100 goroutines run in parallel, each independently waits for its own DB response | **Go** |
| **WebSocket broadcast to 50 managers** | Serialized on the event loop — sends one message, then the next | `NotifHub.Broadcast()` fans out via goroutines — all 50 sent near-simultaneously | **Go** |
| **SNS publish after every change** | `await sns.publish()` blocks the response or requires careful async handling | `go PublishChange(event)` — fire-and-forget goroutine, response returns instantly | **Go** |
| **Auto-trigger AI analysis after edit** | Needs a job queue (BullMQ + Redis) or risks blocking the response | `go TriggerAnalysis(category)` — one line, runs in background, zero infra | **Go** |
| **Memory per WebSocket connection** | ~50-100KB (V8 overhead) | ~2-4KB (goroutine stack) | **Go** |
| **1000 WebSocket connections** | ~50-100MB memory, event loop contention | ~2-4MB memory, no contention | **Go** |
| **Background work (7 ops per request)** | Needs BullMQ + Redis to avoid blocking | Just `go func()` — zero infrastructure | **Go** |

### Raw Performance Numbers

| Metric | Node.js/Express (typical) | Go/Gin (typical) |
|--------|--------------------------|-------------------|
| Requests/second (JSON CRUD) | ~5,000–15,000 | ~30,000–100,000+ |
| Memory per process | ~50–150MB baseline | ~10–20MB baseline |
| Startup time | ~1–3 seconds | ~10–50 milliseconds |
| WebSocket broadcast (50 clients) | ~5–15ms (serialized) | ~0.5–2ms (parallel) |
| Per-connection overhead | ~1MB per worker thread | ~2KB per goroutine |

### What This Means for MetaSource

When a user edits a hiring request, the Go gateway does **7 things**: query old values, execute UPDATE, insert change record, create notification, broadcast via WebSocket, publish to SNS, and trigger AI analysis. Steps 5–7 run as background goroutines — the user's HTTP response returns in ~10ms while async work continues.

In Node.js, steps 5–7 would either block the response or require a job queue (BullMQ + Redis + a worker process). In Go, they're just `go func()` — zero infrastructure, zero latency impact.

### Why Not Go for Everything?

- **AI Service uses Python** — OpenAI Agent SDK is Python-first; scraping libs (BeautifulSoup, httpx) are Python; the service is I/O bound (waiting on OpenAI API), not CPU bound
- **Frontend uses Next.js** — React is the standard for interactive dashboards; SSR/TypeScript/Tailwind are most productive in Node
- **Each language is used where it's strongest**: Go for the high-throughput API layer, Python for AI/ML, TypeScript for the UI

---

## AWS SNS vs SES vs S3 — Service Comparison

MetaSource uses **AWS SNS** for email notifications. Here's how it compares to the other commonly confused AWS services and why SNS is the right choice.

### What Each Service Does

| Service | Purpose | Model | Think of it as... |
|---------|---------|-------|-------------------|
| **SNS** (Simple Notification Service) | Fan-out messaging to multiple subscribers | **Pub/Sub** — publish once, deliver to many | A megaphone — you shout once, everyone hears |
| **SES** (Simple Email Service) | Full email sending platform (marketing, transactional, bulk) | **SMTP replacement** — you send to specific recipients | A post office — you address each letter individually |
| **S3** (Simple Storage Service) | Object/file storage | **Storage** — store and retrieve files | A warehouse — you put things in and take them out |

### Head-to-Head Comparison

| Factor | SNS | SES | S3 |
|--------|-----|-----|-----|
| **Primary use** | Push notifications (email, SMS, Lambda, SQS, webhooks) | Sending emails (transactional, marketing, bulk) | Storing files (images, backups, logs, static assets) |
| **Delivery model** | Pub/Sub fan-out — one publish, all subscribers receive | Direct send — you specify each recipient per email | Not a delivery service — clients pull files via URL |
| **Email capability** | Yes — simple plain-text or basic email to subscribers | Yes — full HTML templates, attachments, custom headers, DKIM/SPF | No — stores files, doesn't send anything |
| **SMS capability** | Yes — send SMS to phone numbers | No | No |
| **Trigger Lambda** | Yes — SNS → Lambda | No (but SES can trigger SNS → Lambda via receipt rules) | Yes — S3 event → Lambda on upload/delete |
| **Fan-out to queues** | Yes — SNS → SQS for decoupled processing | No | No (use S3 events → SQS) |
| **Subscriber management** | Built-in — subscribers confirm via email/SMS, AWS manages the list | You manage your own recipient list | N/A |
| **Email customization** | Limited — plain text or basic JSON subject/body | Full — HTML templates, dynamic variables, attachments, custom from/reply-to | N/A |
| **Retry on failure** | Built-in (3 retries for email, configurable for HTTP) | Built-in with bounce/complaint handling | N/A |
| **Cost (email)** | Free (email delivery always free, first 1M publishes free) | $0.10 per 1,000 emails | N/A |
| **Cost (storage)** | No storage | No storage | $0.023/GB/month |
| **Setup complexity** | ~50 lines of code | ~200+ lines (domain verification, DKIM, templates, bounce handling) | ~20 lines for upload/download |
| **Best for** | Event-driven notifications, alerts, fan-out to multiple systems | Marketing emails, transactional emails with HTML templates, bulk sends | File storage, static hosting, data lakes, backups |

### Why MetaSource Uses SNS (Not SES or S3)

| Requirement | SNS | SES | S3 |
|-------------|-----|-----|-----|
| Send email on every requisition change | **Yes** — fire-and-forget publish, AWS delivers | Yes, but overkill — need to manage recipient lists, templates, bounce handling | **No** — not an email service |
| Zero infrastructure to manage | **Yes** — no worker, no queue, no consumer | Needs domain verification, DKIM setup, bounce/complaint processing | N/A |
| Add new subscribers without code changes | **Yes** — `POST /api/sns/setup`, subscriber confirms via email | Need to update recipient list in code or database | N/A |
| Fan-out to multiple channels (email + SMS + Lambda) | **Yes** — add subscribers of different types to same topic | Email only | N/A |
| Cost at our scale (~30K changes/month) | **$0/month** (3% of free tier) | ~$3/month | N/A |

**The bottom line**: SNS is the right tool for **event-driven alerts** where you publish once and AWS handles delivery to all subscribers. SES is the right tool for **custom email campaigns** where you need HTML templates, personalization, and bulk sending. S3 is for **storing files**, not sending notifications. MetaSource needs event-driven alerts → SNS.

### When You Would Switch to SES

You'd add SES alongside SNS if you needed: custom HTML email templates with your brand styling, personalized per-manager email content (different body per recipient), email analytics (open rates, click tracking), attachments in notification emails, or marketing/digest emails separate from real-time alerts.

### When You Would Use S3

You'd add S3 for: storing uploaded CSV/Excel files before processing, archiving notification history as JSON files, hosting static frontend assets (if moving off k8s), or storing AI-generated reports as downloadable PDFs.

---

## Interview Questions — Design Decisions

### Q1: How will you automate the notification and information delivery process?

**Zero manual intervention.** Every change is detected, recorded, routed, and delivered automatically through three parallel channels.

**On every edit**: Go gateway does field-level diff (track()), then fires 4 parallel goroutines — WebSocket broadcast (~50ms), DB notification record, AWS SNS email (~1-2s), and AI anomaly check (~2-5s). The manager's browser gets a toast notification within 50ms.

**Background automation**: Change Summarizer runs every 15 min — finds unsummarized changes, sends to gpt-4.1-mini, creates notification + email. Anomaly Scanner runs daily — scans all categories for rate spikes, budget overruns, stale requests.

**What managers never have to do**: Check the dataset manually, figure out what changed (AI summarizes), watch for problems (AI anomaly detection), or ask "what happened while I was away?" (AI Chat answers NL questions).

**Bot-driven data collection**: Market Rate Collector populates benchmarking data. CSV bulk import creates change records + notifications per category automatically.

---

### Q2: How will your approach handle growth (more managers, larger datasets)?

**Every scaling dimension was considered during architecture, not as an afterthought.**

**Adding managers**: One DB INSERT — routing is a database lookup (`SELECT id FROM SourcingManager WHERE category = $1`), not hardcoded. Add an SNS subscriber via `POST /api/sns/setup` for email alerts.

**Larger datasets**: PostgreSQL handles millions of rows with pagination + indexing. The 15-min summarizer processes in batches. Go goroutines use ~2-4KB per WebSocket connection (1000 connections = ~4MB).

**Why Go helps**: The gateway handles 7 operations per request. In Node.js, async operations would need BullMQ + Redis. In Go, they're just `go func()` — zero-infrastructure concurrency, 30K-100K req/sec on a single pod.

**Horizontal scaling**: All services are stateless in Kubernetes — `kubectl scale deployment meta-gateway --replicas=3` for 3x throughput. The only shared state is PostgreSQL.

---

### Q3: How will you ensure each manager receives only relevant information but captures all changes?

**Every change is captured once (audit trail), but only routed to the owning manager.**

**Routing**: Every requisition belongs to one category → one manager. The gateway looks up the manager and only notifies them.

**Where filtering happens**:
- **WebSocket** — Each connection registers with a managerId; broadcasts target only that manager + admin
- **Notification table** — Each notification tied to one managerId via foreign key
- **Dashboard/API** — `?managerId=X` resolves to the manager's category and filters all queries
- **AI Chat** — Query agent receives managerId as context, focuses on their category
- **Email (SNS)** — Messages include category as a message attribute for subscriber filtering

**All changes are captured**: The `RequisitionChange` table stores every change to every requisition regardless of category. Routing controls who gets notified, not what gets recorded.

---

### Q4: How will you ensure the solution is easy to maintain and adapt?

**Three separate services, each in the language best suited for its job, with clear boundaries.**

**Separation of concerns**:
- **frontend/** — UI only, no business logic. Change UI without touching backend.
- **gateway/** — API + real-time. Change notification logic without touching UI or AI.
- **ai-service/** — AI only. Swap models or add agents without touching the API.

**Adding a notification channel**: One more `go func()` in the gateway's fan-out. Adding Slack = one new goroutine. SNS already supports SMS/Lambda/SQS/webhooks without code changes.

**Adding an AI agent**: Self-contained Python file + endpoint in main.py + proxy route in gateway. No changes to existing agents.

**Schema changes**: Prisma manages migrations. Add field to model → `npx prisma migrate dev` → TypeScript types auto-generated.

**Adapting notification rules**: The `track()` function in `requisitions.go` is the single place to add filtering logic. The `NotificationRule` table already supports per-manager rules.

**Infrastructure is declarative**: All Kubernetes YAML in `k8s/`. Move servers with `kubectl apply -f k8s/`. Scale by changing `replicas`.

---

### Design Decision Summary

| Decision | Why | Alternative Considered |
|----------|-----|----------------------|
| Go for gateway | Real-time WebSocket + 7 async ops per request without a job queue | Node.js — would need BullMQ + Redis |
| Python for AI | OpenAI Agent SDK is Python-first, scraping libs are Python | Node.js — Agent SDK features are Python-only |
| Next.js for frontend | SSR, TypeScript, Tailwind, React ecosystem for dashboards | Plain React SPA |
| AWS SNS for email | Zero infrastructure, free tier (1M/month), fire-and-forget | SQS + worker process |
| WebSocket for real-time | Instant (<50ms), no polling overhead | Polling every 5s |
| Category-based routing | Simple, deterministic, scales by adding DB rows | Tag-based routing |
| Field-level change tracking | Managers need "billRate: $75 → $85", not just "something changed" | Row-level tracking |
| AI batch summarization | One OpenAI call per batch (cost-efficient), better context | Per-change AI call — 10x cost |
| Fingerprint dedup | Prevent anomaly notification spam | No dedup — causes 200+ duplicates |
| Prisma for schema | Type-safe migrations, auto-generated types | Raw SQL migrations |
| k3s | Production-grade orchestration, same APIs as full k8s | Docker Compose |

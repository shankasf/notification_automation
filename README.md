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

## Go (Gin) vs Node.js (Express) — Scalability Numbers

| Metric | Node.js/Express | Go (Gin) |
|--------|----------------|----------|
| Requests/sec (JSON CRUD) | 5,000–15,000 | 30,000–100,000+ |
| Memory baseline | 50–150 MB | 10–20 MB |
| Startup time | 1–3 sec | 10–50 ms |
| Concurrency model | Single-threaded event loop | Goroutines (multi-core) |
| Memory per connection | 50–100 KB | 2–4 KB |
| 1,000 WebSocket connections | 50–100 MB | 2–4 MB |
| WebSocket broadcast (50 clients) | 5–15 ms (serialized) | 0.5–2 ms (parallel) |
| Background async work | Requires job queue (BullMQ + Redis) | `go func()` — zero infra |
| Threads per request | Shared single thread | 1 goroutine (~2 KB) |
| Max concurrent connections (single pod) | ~10,000 (event loop bottleneck) | ~100,000+ (OS limit) |
| CPU-bound work impact | Blocks entire event loop | Blocks only that goroutine |
| Horizontal scaling | Cluster mode (multi-process) | Single binary, multi-core native |

---

## AWS SNS vs SES vs S3 — Scalability Numbers

| Metric | SNS | SES | S3 |
|--------|-----|-----|-----|
| **What it does** | Pub/Sub notifications (email, SMS, Lambda, SQS) | Email sending (transactional, marketing, bulk) | Object/file storage |
| **Throughput** | 30,000 publishes/sec (soft limit) | 200 emails/sec (sandbox), 50,000/sec (production) | 5,500 PUT/sec per prefix, 55,000 GET/sec per prefix |
| **Max message/object size** | 256 KB | 40 MB (with attachments) | 5 TB per object |
| **Subscribers/recipients per request** | 12.5M subscribers per topic | 50 recipients per call | N/A |
| **Free tier** | 1M publishes/month + free email delivery | 62,000 emails/month (from EC2) | 5 GB storage + 20,000 GET + 2,000 PUT/month |
| **Cost after free tier** | $0.50 per 1M publishes | $0.10 per 1,000 emails | $0.023/GB storage, $0.0004/1K requests |
| **Delivery model** | Push — AWS delivers to all subscribers | Push — you specify each recipient | Pull — clients fetch via URL/API |
| **Latency** | ~1–2 sec (email), ~100 ms (Lambda/SQS) | ~1–3 sec (email) | ~10–100 ms (GET/PUT) |
| **Retry on failure** | 3 retries (email), configurable (HTTP) | Built-in with bounce/complaint handling | N/A |
| **Fan-out** | 1 publish → all subscribers (email + SMS + Lambda + SQS + HTTP) | 1 call → 1 email (no fan-out) | S3 events → SNS/SQS/Lambda |
| **Subscriber management** | Built-in (confirm via email/SMS) | You manage recipient lists | N/A |
| **Durability** | N/A (delivery, not storage) | N/A (delivery, not storage) | 99.999999999% (11 nines) |
| **Availability SLA** | 99.9% | 99.9% | 99.99% |
| **Setup lines of code** | ~50 | ~200+ (domain verification, DKIM, templates) | ~20 |
| **MetaSource usage** | Email alerts on every change ($0/month at 30K changes) | Not used — overkill for simple alerts | Not used — no file storage needed |

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

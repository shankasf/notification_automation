# MetaSource — Intelligent Workforce Sourcing Platform

A platform that helps sourcing managers track contractor hiring requests without any manual effort. When admin edits a hiring request — updates a bill rate, fills a position, changes status — the system instantly detects it and notifies the relevant category manager. When a manager makes changes, admin gets notified. Both sides get real-time WebSocket push, AI-generated summaries, and email alerts. All automatic.

**Live**: [https://meta.callsphere.tech](https://meta.callsphere.tech)

---

## What It Does

Five sourcing managers each own a category of hiring requests (engineering contractors, content & trust/safety, data operations, marketing/creative, corporate services). The platform:

- **Detects every change** — field-level tracking captures exactly what changed, by whom (admin or manager), and when
- **Routes notifications both ways** — admin edits notify the relevant manager; manager edits notify admin
- **Updates dashboards in real time** — WebSocket push means counts and stats refresh instantly, no page reload needed
- **Summarizes with AI** — instead of raw field diffs, managers get plain English summaries like "Bill rate for Senior DevOps increased from $75 to $95/hr"
- **Sends email alerts** — every change triggers an email to the other side via AWS SNS
- **Flags problems automatically** — AI scans for anomalies like price spikes, budget overruns, and stale requests

### What Managers See

| Page | What's There |
|------|-------------|
| **Home** | All 5 managers' active request counts, unfilled positions, and alert badges — updates live via WebSocket |
| **Dashboard** | Stats cards (total requests, unfilled positions, budget, critical priority), category pie chart, status bar chart, recent changes timeline |
| **Hiring Requests** | Full data grid with inline editing, status/priority dropdowns, search, filters, pagination, CSV upload |
| **Notifications** | All alerts with read/unread state, AI-generated summaries |
| **Change Log** | Complete audit trail of every field change across all requests |
| **Market Rates** | Benchmarking data for contractor rates |
| **AI Chat** | Ask questions in plain English — "What are the highest bill rates in engineering?" |

### Admin vs Manager

- **Admin** sees all 5 managers' data, can edit any category, access the data upload pipeline
- **Managers** are auto-redirected to their own dashboard, can only edit their category's requests
- **Notification routing is bidirectional** — when admin edits a request, the relevant category manager gets notified (WebSocket push, in-app notification, and email). When any manager edits a request, admin gets notified in real time via WebSocket. This applies across all 5 managers — every change triggers a notification to the other side

---

## How It Works

### The Change Flow (What Happens When Admin or a Manager Edits a Request)

```
Admin or manager changes status from OPEN to COMPLETED
    |
    v
Go Gateway receives PUT /api/requisitions/:id
    |
    |-- 1. Reads current values from database
    |-- 2. Compares old vs new (field-level diff)
    |-- 3. Saves change record (who, what, when)
    |-- 4. Updates the requisition
    |
    Then fires 4 things in parallel:
        |-- WebSocket broadcast to the category manager + admin (~50ms)
        |-- Creates notification in database for the category manager
        |-- Sends email via AWS SNS (~1-2s)
        |-- Triggers AI anomaly check (~2-5s)
    |
    v
The other side's browser receives WebSocket event
    |-- Dashboard refetches stats (counts drop because COMPLETED is excluded)
    |-- Home page refetches manager cards (same)
    |-- Toast notification appears
    |-- Notification badge increments
```

### Real-Time Updates

Every page that shows data listens for WebSocket events and silently refetches when something changes:

| Page | Listens For | What Refreshes |
|------|-------------|----------------|
| **Home page** | `change`, `notification`, `refresh` | All manager cards, total hiring requests, unfilled positions, alerts count |
| **Dashboard** | `change`, `notification` | All stat cards, charts, recent changes |
| **Hiring Requests** | `change` | Table data, total count, pagination |
| **Notifications** | `notification`, `read` | Notification list, unread badge in sidebar |

The WebSocket hub routes messages correctly:
- A change to an Engineering request goes to the Engineering manager's browser AND all admin browsers
- Admin connections receive events for every manager

### Active Request Counting

The "Total Hiring Requests" and "Unfilled Positions" numbers on both the home page and dashboard **only count active requests**. Requests with status COMPLETED or CANCELLED are excluded from these headline numbers. The status distribution chart on the dashboard still shows all statuses for the full picture.

### AI Features

| Feature | What It Does | When It Runs |
|---------|-------------|--------------|
| **Change Summaries** | Turns "billRateHourly: 75 -> 95" into "Bill rate increased by 27% for Senior DevOps role" | Every 15 minutes (batch) |
| **Anomaly Detection** | Flags rate spikes >10%, budgets >90% used, requests stale >30 days | On each change + daily scan |
| **Chat Assistant** | Answers questions like "Which category has the most unfilled positions?" using 6 database query tools | On demand |
| **Data Upload Pipeline** | Ingests CSV, Excel, JSON, or messy text files — AI cleans and normalizes data | Admin-triggered |

### Email Alerts (AWS SNS)

Every change publishes to an SNS topic. Subscribe any email address via `POST /api/sns/setup` — AWS handles confirmation and delivery. No email server, no SMTP config, no worker process.

---

## Architecture

Three microservices behind Traefik (TLS ingress) on k3s:

```
Browser
  |
  v
Traefik (meta.callsphere.tech:443)
  |
  |-- /api/*  -->  Go Gateway (:8080)
  |-- /ws/*   -->  Go Gateway (:8080)
  |-- /*      -->  Next.js Frontend (:3000)
  |
  v
Go Gateway connects to:
  |-- PostgreSQL (meta_source database)
  |-- Python AI Service (:8000) --> OpenAI API
  |-- AWS SNS (email delivery)
```

### Services

| Service | Technology | Role |
|---------|-----------|------|
| **Frontend** | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Recharts | Dashboard UI, data grid, notification center, AI chat, Google OAuth |
| **Gateway** | Go (Gin), Gorilla WebSocket, AWS SNS SDK | All CRUD APIs, real-time WebSocket push, change tracking, notification routing, CSV import, AI proxy |
| **AI Service** | Python (FastAPI), OpenAI Agent SDK (gpt-4.1 / gpt-4.1-mini) | Summarization, anomaly detection, chat Q&A, data cleaning, market rates |
| **Database** | PostgreSQL, Prisma (schema/migrations), raw SQL in Go | All data storage — requisitions, changes, notifications, managers, chat history |

### Database Tables

9 tables in PostgreSQL, managed via Prisma ORM.

**SourcingManager** — 5 managers, each assigned one category

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | String | |
| email | String | Unique |
| category | RequisitionCategory | Enum |
| avatarUrl | String? | |
| createdAt | DateTime | Default: now |

**Requisition** — Hiring requests

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| requisitionId | String | Unique (display ID) |
| team | String | |
| department | String | |
| roleTitle | String | |
| category | RequisitionCategory | Enum |
| headcountNeeded | Int | |
| headcountFilled | Int | Default: 0 |
| vendor | String | |
| billRateHourly | Float | |
| location | String | |
| status | RequisitionStatus | Default: OPEN |
| priority | Priority | Default: MEDIUM |
| budgetAllocated | Float | |
| budgetSpent | Float | Default: 0 |
| startDate | DateTime? | |
| endDate | DateTime? | |
| notes | String? | |
| createdAt | DateTime | Default: now |
| updatedAt | DateTime | Auto-updated |

**RequisitionChange** — Every field change with old/new values, AI summary

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| requisitionId | String | FK → Requisition (CASCADE) |
| changeType | ChangeType | Enum |
| fieldChanged | String? | |
| oldValue | String? | |
| newValue | String? | |
| changedBy | String | Default: "system" |
| summary | String? | AI-generated |
| createdAt | DateTime | Default: now |

**Notification** — Per-manager alerts

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| managerId | String | FK → SourcingManager (CASCADE) |
| type | NotificationType | Enum |
| title | String | |
| message | String | |
| isRead | Boolean | Default: false |
| metadata | Json? | |
| createdAt | DateTime | Default: now |

**NotificationRule** — Per-manager filtering preferences

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| managerId | String | FK → SourcingManager (CASCADE) |
| ruleType | String | |
| threshold | Float? | |
| isEnabled | Boolean | Default: true |
| createdAt | DateTime | Default: now |

**MarketRate** — Contractor rate benchmarks

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| roleTitle | String | |
| category | RequisitionCategory | Enum |
| location | String | |
| minRate | Float | |
| maxRate | Float | |
| medianRate | Float | |
| source | String | |
| scrapedAt | DateTime | Default: now |

**ChatSession** — AI chat conversation history

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| managerId | String? | |
| messages | Json | Default: [] |
| createdAt | DateTime | Default: now |
| updatedAt | DateTime | Auto-updated |

**AnomalyFingerprint** — 24h dedup for anomaly notifications

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| fingerprint | String | Indexed with createdAt |
| category | String | |
| severity | String | |
| managerId | String? | |
| createdAt | DateTime | Default: now |

**ScrapeLog** — Web scraping history

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| source | String | |
| rolesScraped | Int | |
| status | String | |
| duration | Int | |
| error | String? | |
| createdAt | DateTime | Default: now |

**Enums**: RequisitionCategory (5 values: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES) · RequisitionStatus (8: OPEN → SOURCING → INTERVIEWING → OFFER → ONBOARDING → ACTIVE → COMPLETED, CANCELLED) · Priority (4: CRITICAL, HIGH, MEDIUM, LOW) · ChangeType (7: CREATED, UPDATED, STATUS_CHANGE, RATE_CHANGE, HEADCOUNT_CHANGE, BUDGET_CHANGE, BULK_IMPORT) · NotificationType (4: CHANGE_SUMMARY, ANOMALY_ALERT, BUDGET_WARNING, MILESTONE)

### Requisition Statuses

OPEN → SOURCING → INTERVIEWING → OFFER → ONBOARDING → ACTIVE → COMPLETED

Requests can also be CANCELLED. Only OPEN through ACTIVE count as "active" in dashboard totals.

### API Endpoints

| Group | Endpoints |
|-------|----------|
| **Requisitions** | GET/POST/PUT/DELETE `/api/requisitions`, POST `/api/requisitions/upload` |
| **Stats & Managers** | GET `/api/stats`, GET `/api/managers`, GET `/api/changes` |
| **Notifications** | GET/PUT `/api/notifications` |
| **SNS** | POST/GET `/api/sns/setup` |
| **AI** | POST `/api/ai/chat`, `/api/ai/summarize`, `/api/ai/analyze`, `/api/ai/detect-changes`, `/api/ai/scrape` |
| **Data Upload** | POST `/api/data-upload`, GET `/api/data-upload/:jobId/status` |

---

## Technical Details

### Why Go for the Gateway

Each requisition update triggers 7 operations (read old values, diff, save change, update row, WebSocket broadcast, create notification, SNS publish). In Go, the async operations are `go func()` — zero infrastructure. In Node.js, you'd need BullMQ + Redis for the same thing.

| Metric | Node.js/Express | Go (Gin) |
|--------|----------------|----------|
| Requests/sec | 5,000–15,000 | 30,000–100,000+ |
| Memory per WebSocket connection | 50–100 KB | 2–4 KB |
| Background async work | Requires job queue + Redis | `go func()` — built in |
| 1,000 WebSocket connections | 50–100 MB RAM | 2–4 MB RAM |

### WebSocket Hub

- Connections register with a `managerId` (or "admin" for admin users)
- On broadcast: sends to the target manager's connections + all admin connections
- Auto-reconnect with exponential backoff on the client side
- Connection cleanup on disconnect

### Field-Level Change Tracking

The `track()` function in `requisitions.go` compares old vs new for each field. No AI — pure string comparison. Each change gets a type: STATUS_CHANGE, RATE_CHANGE, HEADCOUNT_CHANGE, BUDGET_CHANGE, or UPDATED.

### AI Data Upload Pipeline

4 stages for ingesting any file format:

1. **Parse** — Detect format, extract records (structured formats are programmatic; only unstructured text uses AI)
2. **Clean** — AI normalizes values in parallel batches ("eng" → ENGINEERING_CONTRACTORS, "$75/hr" → 75.0)
3. **Validate** — Pydantic schema enforcement (required fields, valid enums, correct types)
4. **Upsert** — Sequential DB insert with audit records and notifications

### Anomaly Deduplication

24-hour fingerprint-based dedup prevents notification spam. Each anomaly is hashed (category + type + key details). Same fingerprint within 24h is suppressed.

### Kubernetes Deployment

Three deployments in namespace `meta-test`. Traefik IngressRoute with TLS via cert-manager. Secrets: `openai-secret`, `aws-secret`.

Resource allocation (small dataset):

| Service | CPU (request/limit) | Memory (request/limit) |
|---------|-------------------|----------------------|
| Frontend | 100m / 500m | 512Mi / 1.5Gi |
| Gateway | 25m / 200m | 128Mi / 256Mi |
| AI Service | 50m / 300m | 256Mi / 512Mi |

### Scaling

| What | How |
|------|-----|
| Add a manager | INSERT one DB row + subscribe their email to SNS |
| Add a category | Add enum value — routing is automatic |
| More requests | PostgreSQL with pagination + indexing handles millions |
| More traffic | `kubectl scale --replicas` — all services are stateless |
| More notification channels | One `go func()` in the gateway — SNS already supports SMS, Lambda, SQS, HTTP |

---

## Project Structure

```
meta_test/
  frontend/       Next.js app (UI, Prisma schema, API routes for local dev)
  gateway/        Go API server (all production API endpoints, WebSocket, SNS)
  ai-service/     Python FastAPI (OpenAI agents, anomaly detection, chat)
  k8s/            Kubernetes deployment + ingress YAML
```

---

## Future: Data Pipeline with Apache Airflow & DBT

The platform currently runs AI summarization every 15 minutes, anomaly detection on each change + daily, and data ingestion via admin-triggered uploads. As data volume grows and analytics requirements expand, a dedicated data pipeline using **Apache Airflow** (orchestration) and **DBT** (transformation) would replace these ad-hoc processes with scheduled, observable, testable pipelines.

### Why Airflow + DBT

| Current Approach | Problem at Scale | Airflow/DBT Solution |
|-----------------|------------------|---------------------|
| AI summarization runs on a 15-min cron in Python | No retry on failure, no visibility into backlog | Airflow DAG with retries, SLA alerts, backfill capability |
| Anomaly detection triggered per-change + daily scan | Duplicate work, no dependency management | Airflow schedules detection after summarization completes |
| CSV/Excel upload pipeline is synchronous in gateway | Blocks API, no progress tracking for large files | Airflow async pipeline with stage-level status |
| Market rate scraping is manual | No scheduling, no staleness detection | Airflow DAG scrapes on schedule, DBT flags stale data |
| Dashboard stats computed on every API call | Redundant computation, slow at scale | DBT pre-computes materialized views, Airflow refreshes them |
| No data quality checks | Bad data discovered only when users complain | DBT tests enforce schema, uniqueness, freshness |

### System Design — Airflow Orchestration Layer

```mermaid
flowchart TB
    subgraph Sources["Data Sources"]
        PG[(PostgreSQL<br/>meta_source)]
        CSV[CSV / Excel<br/>Uploads]
        SCRAPE[Market Rate<br/>Scrapers]
        API_EXT[External APIs<br/>Vendor Systems]
    end

    subgraph Airflow["Apache Airflow (Orchestrator)"]
        direction TB
        SCHED[Airflow Scheduler]

        subgraph DAGs["DAG Definitions"]
            DAG1["📋 requisition_changes_pipeline<br/>⏰ Every 15 min"]
            DAG2["🔍 anomaly_detection_pipeline<br/>⏰ Hourly"]
            DAG3["📂 data_ingestion_pipeline<br/>⏰ Event-triggered"]
            DAG4["📊 analytics_refresh_pipeline<br/>⏰ Every 30 min"]
            DAG5["💰 market_rates_pipeline<br/>⏰ Daily at 6 AM"]
            DAG6["🧹 data_quality_pipeline<br/>⏰ Daily at midnight"]
        end

        SCHED --> DAGs
    end

    subgraph DBT["DBT (Transform Layer)"]
        direction TB
        subgraph Staging["Staging Models"]
            STG1[stg_requisitions]
            STG2[stg_changes]
            STG3[stg_notifications]
            STG4[stg_market_rates]
        end

        subgraph Intermediate["Intermediate Models"]
            INT1[int_change_summaries]
            INT2[int_anomaly_scores]
            INT3[int_rate_benchmarks]
            INT4[int_manager_workload]
        end

        subgraph Marts["Mart Models (Materialized Views)"]
            MART1[mart_dashboard_stats]
            MART2[mart_manager_overview]
            MART3[mart_budget_tracking]
            MART4[mart_hiring_velocity]
            MART5[mart_anomaly_report]
        end

        Staging --> Intermediate --> Marts
    end

    subgraph Consumers["Consumers"]
        GW[Go Gateway API]
        AI[AI Service]
        DASH[Dashboard UI]
        EMAIL[Email Alerts<br/>AWS SNS]
    end

    Sources --> Airflow
    Airflow -->|"dbt run"| DBT
    DBT -->|Materialized tables| PG
    PG --> Consumers
    Airflow -->|"Trigger on completion"| AI
    Airflow -->|"Trigger on anomaly"| EMAIL
```

### DAG Design — Requisition Changes Pipeline

This is the core pipeline that replaces the current 15-minute cron summarization and per-change anomaly detection.

```mermaid
flowchart LR
    subgraph DAG["requisition_changes_pipeline — Runs every 15 min"]
        direction LR
        T1["extract_new_changes<br/>─────────────<br/>Query RequisitionChange<br/>where summary IS NULL"]
        T2["dbt_run_staging<br/>─────────────<br/>dbt run --select<br/>stg_changes"]
        T3["ai_generate_summaries<br/>─────────────<br/>Batch call AI Service<br/>for plain English summaries"]
        T4["dbt_run_intermediate<br/>─────────────<br/>dbt run --select<br/>int_change_summaries<br/>int_anomaly_scores"]
        T5["detect_anomalies<br/>─────────────<br/>Flag rate spikes >10%<br/>budget >90%, stale >30d"]
        T6["notify_managers<br/>─────────────<br/>Create notifications<br/>+ WebSocket broadcast"]
        T7["dbt_run_marts<br/>─────────────<br/>dbt run --select<br/>mart_dashboard_stats<br/>mart_anomaly_report"]
        T8["refresh_websocket<br/>─────────────<br/>Push 'refresh' event<br/>to all connections"]

        T1 --> T2 --> T3 --> T4 --> T5 --> T6 --> T7 --> T8
    end
```

### DAG Design — Data Ingestion Pipeline

Replaces the synchronous upload endpoint with an async, stage-tracked pipeline.

```mermaid
flowchart TB
    subgraph DAG["data_ingestion_pipeline — Event-triggered by file upload"]
        direction TB

        UPLOAD["file_upload_sensor<br/>─────────────<br/>Watch S3 bucket for<br/>new CSV/Excel/JSON"]

        subgraph Parse["Stage 1: Parse"]
            P1["detect_format<br/>CSV / Excel / JSON / Text"]
            P2["extract_records<br/>Programmatic for structured<br/>AI for unstructured"]
        end

        subgraph Clean["Stage 2: Clean (DBT)"]
            C1["dbt run --select<br/>stg_raw_upload"]
            C2["dbt run --select<br/>int_cleaned_upload<br/>─────────────<br/>Normalize categories<br/>Parse rates, dates<br/>Resolve vendors"]
        end

        subgraph Validate["Stage 3: Validate"]
            V1["dbt test --select<br/>int_cleaned_upload<br/>─────────────<br/>not_null, unique,<br/>accepted_values,<br/>relationships"]
            V2["quarantine_failures<br/>─────────────<br/>Move bad rows to<br/>quarantine table"]
        end

        subgraph Load["Stage 4: Load"]
            L1["upsert_requisitions<br/>─────────────<br/>Insert/update with<br/>change tracking"]
            L2["create_audit_records<br/>─────────────<br/>Log BULK_IMPORT<br/>changes"]
            L3["trigger_notifications<br/>─────────────<br/>Notify managers of<br/>new/updated requests"]
        end

        UPLOAD --> Parse --> Clean --> Validate --> Load
    end
```

### DAG Design — Analytics & Market Rates

```mermaid
flowchart LR
    subgraph Analytics["analytics_refresh_pipeline — Every 30 min"]
        direction LR
        A1["dbt run --select<br/>mart_dashboard_stats<br/>mart_manager_overview<br/>mart_budget_tracking<br/>mart_hiring_velocity"]
        A2["dbt test --select<br/>tag:marts"]
        A3["websocket_refresh<br/>broadcast"]
        A1 --> A2 --> A3
    end

    subgraph Market["market_rates_pipeline — Daily 6 AM"]
        direction LR
        M1["scrape_glassdoor<br/>scrape_levels_fyi<br/>scrape_indeed"]
        M2["dbt run --select<br/>stg_market_rates"]
        M3["dbt run --select<br/>int_rate_benchmarks"]
        M4["dbt test<br/>freshness check"]
        M5["flag_stale_rates<br/>alert if >7 days old"]
        M1 --> M2 --> M3 --> M4 --> M5
    end
```

### DBT Model Dependency Graph

```mermaid
flowchart TB
    subgraph Sources["Source Tables (PostgreSQL)"]
        S_REQ[source: Requisition]
        S_CHG[source: RequisitionChange]
        S_NOT[source: Notification]
        S_MGR[source: SourcingManager]
        S_MKT[source: MarketRate]
        S_ANO[source: AnomalyFingerprint]
    end

    subgraph Staging["Staging Layer — Clean & type-cast"]
        STG_REQ[stg_requisitions<br/>───<br/>Cast types, add<br/>is_active flag]
        STG_CHG[stg_changes<br/>───<br/>Parse timestamps,<br/>classify change types]
        STG_NOT[stg_notifications<br/>───<br/>Add read latency<br/>calculation]
        STG_MKT[stg_market_rates<br/>───<br/>Normalize titles,<br/>deduplicate]
    end

    subgraph Intermediate["Intermediate Layer — Business logic"]
        INT_SUM[int_change_summaries<br/>───<br/>Group changes by<br/>requisition + time window]
        INT_ANO[int_anomaly_scores<br/>───<br/>Rate deviation from<br/>market, budget burn rate]
        INT_BENCH[int_rate_benchmarks<br/>───<br/>Category/location<br/>percentiles]
        INT_WORK[int_manager_workload<br/>───<br/>Open reqs, pending<br/>changes, alert count]
        INT_VEL[int_hiring_velocity<br/>───<br/>Days per stage,<br/>fill rate trends]
    end

    subgraph Marts["Mart Layer — API-ready tables"]
        MART_DASH[mart_dashboard_stats<br/>───<br/>Pre-computed stats<br/>for /api/stats]
        MART_MGR[mart_manager_overview<br/>───<br/>Per-manager cards<br/>for home page]
        MART_BUD[mart_budget_tracking<br/>───<br/>Budget utilization<br/>forecasts]
        MART_HIRE[mart_hiring_velocity<br/>───<br/>Time-to-fill metrics<br/>by category]
        MART_ANO[mart_anomaly_report<br/>───<br/>Active anomalies<br/>with severity ranking]
    end

    S_REQ --> STG_REQ
    S_CHG --> STG_CHG
    S_NOT --> STG_NOT
    S_MKT --> STG_MKT
    S_MGR --> INT_WORK

    STG_REQ --> INT_SUM
    STG_REQ --> INT_ANO
    STG_REQ --> INT_WORK
    STG_REQ --> INT_VEL
    STG_CHG --> INT_SUM
    STG_CHG --> INT_ANO
    STG_MKT --> INT_BENCH

    INT_SUM --> MART_DASH
    INT_SUM --> MART_MGR
    INT_ANO --> MART_ANO
    INT_ANO --> MART_DASH
    INT_BENCH --> MART_ANO
    INT_WORK --> MART_MGR
    INT_VEL --> MART_HIRE
    INT_WORK --> MART_DASH
    STG_NOT --> MART_MGR

    S_ANO --> INT_ANO
    INT_SUM --> MART_BUD
    STG_REQ --> MART_BUD
```

### Proposed Project Structure

```
meta_test/
  ...existing services...
  data-pipeline/
    dags/
      requisition_changes.py      # 15-min change processing DAG
      anomaly_detection.py        # Hourly anomaly scan DAG
      data_ingestion.py           # Event-triggered upload DAG
      analytics_refresh.py        # 30-min mart refresh DAG
      market_rates.py             # Daily scraping DAG
      data_quality.py             # Daily validation DAG
    dbt/
      models/
        staging/
          stg_requisitions.sql
          stg_changes.sql
          stg_notifications.sql
          stg_market_rates.sql
        intermediate/
          int_change_summaries.sql
          int_anomaly_scores.sql
          int_rate_benchmarks.sql
          int_manager_workload.sql
          int_hiring_velocity.sql
        marts/
          mart_dashboard_stats.sql
          mart_manager_overview.sql
          mart_budget_tracking.sql
          mart_hiring_velocity.sql
          mart_anomaly_report.sql
      tests/
        assert_no_null_requisition_ids.sql
        assert_valid_status_transitions.sql
        assert_budget_not_negative.sql
      dbt_project.yml
      profiles.yml
    docker-compose.airflow.yml    # Local Airflow dev environment
    requirements.txt
```

### Integration with Existing Services

```mermaid
flowchart LR
    subgraph Current["Current Architecture"]
        FE[Next.js Frontend]
        GW[Go Gateway]
        AI[AI Service]
        PG[(PostgreSQL)]
    end

    subgraph New["New Pipeline Layer"]
        AF[Apache Airflow]
        DBT[DBT]
        S3[S3 Staging Bucket]
    end

    FE -->|"Upload file"| GW
    GW -->|"Store raw file"| S3
    S3 -->|"S3 sensor triggers"| AF
    AF -->|"dbt run / dbt test"| DBT
    DBT -->|"Read/write"| PG
    AF -->|"Call /ai/summarize,<br/>/ai/analyze"| AI
    AF -->|"POST /api/notifications<br/>+ WebSocket refresh"| GW
    GW -->|"Read mart tables<br/>instead of live queries"| PG

    style New fill:#f0f9ff,stroke:#0284c7
    style Current fill:#f0fdf4,stroke:#16a34a
```

### Implementation Phases

| Phase | Scope | Outcome |
|-------|-------|---------|
| **Phase 1** | Set up Airflow + DBT, migrate 15-min summarization cron to a DAG | Retries, alerting, and observability for existing process |
| **Phase 2** | Add DBT staging + intermediate models, replace live `/api/stats` queries with mart tables | Dashboard loads from pre-computed tables — faster API responses |
| **Phase 3** | Move upload pipeline from synchronous gateway handler to Airflow DAG with S3 staging | Async uploads, stage-level progress, automatic retries |
| **Phase 4** | Add market rate scraping DAG with freshness checks and DBT tests | Automated rate updates, stale data alerts |
| **Phase 5** | Full data quality suite — DBT tests on all models, Airflow SLA monitoring, anomaly alerting | Data contracts enforced, pipeline health visible in Airflow UI |

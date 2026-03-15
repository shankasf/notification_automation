# MetaSource — AI-Powered Sourcing Manager Notification Platform

## Overview

A procurement/sourcing automation platform that solves the problem of 5 sourcing managers manually tracking a dynamic ordering dataset. The system **automatically detects changes, routes relevant updates to the right manager, and uses AI to summarize and prioritize notifications**.

**Live URL**: https://meta.callsphere.tech
**Namespace**: `meta-test`

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │    meta.callsphere.tech          │
                    │    (Traefik + cert-manager)      │
                    └──────────┬──────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │ /*             │ /api/ai/*       │
              ▼                ▼                 │
    ┌─────────────────┐  ┌──────────────────┐   │
    │   Next.js App   │  │  Python AI Svc   │   │
    │   (Port 3000)   │  │  (Port 8000)     │   │
    │                 │  │                   │   │
    │  • Dashboard    │  │  • OpenAI Agents  │   │
    │  • Dataset CRUD │  │  • Change Detect  │   │
    │  • Notif Center │  │  • Summarizer     │   │
    │  • API Routes   │  │  • Anomaly Detect │   │
    │  • Auth         │  │  • NL Query       │   │
    │  • Charts       │  │  • Data Scraper   │   │
    └────────┬────────┘  └────────┬──────────┘   │
             │                    │               │
             └────────┬──────────┘               │
                      ▼                          │
            ┌──────────────────┐                 │
            │   PostgreSQL     │                 │
            │  72.62.162.83    │                 │
            │  db: meta_source │                 │
            └──────────────────┘                 │
```

---

## Phase 1: Infrastructure & DNS Setup

### Step 1.1 — Hostinger DNS
- Add A record: `meta` → `72.62.162.83` for `callsphere.tech`
- **Note**: Hostinger API token appears expired — may need to add manually via Hostinger panel, or user provides a fresh token

### Step 1.2 — Database
- Create PostgreSQL database `meta_source` on `72.62.162.83`
- Password: `postgres` (matches existing pattern)

### Step 1.3 — K8s Namespace & Secrets
- Create namespace `meta-test`
- Create secret for OpenAI API key
- Create configmap for non-sensitive env vars

---

## Phase 2: Dataset Design & Scraping

### The Dataset
Realistic procurement/sourcing data representing what a tech hardware company would order. **5 categories, each assigned to a sourcing manager**:

| Manager | Category | Example Items |
|---------|----------|---------------|
| Sarah Chen | **Semiconductors & ICs** | Microcontrollers, FPGAs, memory chips, sensors |
| Marcus Johnson | **Passive Components & PCBs** | Resistors, capacitors, PCB boards, connectors |
| Priya Patel | **Mechanical & Enclosures** | Metal housings, heatsinks, screws, gaskets |
| David Kim | **Raw Materials & Chemicals** | Solder paste, thermal compounds, adhesives |
| Lisa Martinez | **Packaging & Logistics** | Boxes, ESD bags, foam inserts, labels |

### Data Fields per Item
```
sku, item_name, category, supplier, quantity_needed, quantity_on_hand,
reorder_point, unit_price, currency, lead_time_days, priority (critical/high/medium/low),
status (pending/approved/ordered/delivered/cancelled), last_updated, notes
```

### Scraping Component (demonstrates job requirement)
- **Python scraper** that pulls real electronic component pricing from public sources (e.g., Octopart API, Digi-Key public pages, or commodity price feeds)
- Populates the dataset with realistic, current pricing
- Generates ~200 items across the 5 categories
- Includes a "scrape now" button in the UI to demonstrate live capability

---

## Phase 3: Next.js Application (Frontend + API)

### Tech Stack
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui components
- Prisma ORM
- Recharts for visualizations
- Tanstack Table for data grids

### Pages

#### 3.1 — Landing / Login
- Simple login page (select a manager or admin view)
- No complex auth — dropdown to switch between managers for demo purposes

#### 3.2 — Admin Dashboard (`/dashboard`)
- **Overview cards**: Total items, pending orders, critical alerts, recent changes
- **Charts**: Spend by category (pie), order volume over time (line), priority distribution (bar)
- **Recent changes feed**: Last 20 changes with AI summaries
- **Manager assignment overview**: Which manager covers what

#### 3.3 — Manager Dashboard (`/dashboard/[managerId]`)
- **Filtered to only their categories**
- Personal notification feed with AI-generated summaries
- Their items table with sorting/filtering
- "What changed for me" section

#### 3.4 — Dataset Table (`/dataset`)
- Full editable data grid (admin) / read-only (managers see only their categories)
- Inline editing — every edit auto-logged as a change
- CSV upload for bulk updates
- Add/delete items
- Filter by category, supplier, status, priority

#### 3.5 — Notification Center (`/notifications`)
- All notifications for the current user
- Mark as read/unread
- AI-generated change summaries grouped by time period
- Notification preferences / rules (e.g., "alert me only for critical priority changes")

#### 3.6 — Change Audit Log (`/changes`)
- Full history of every dataset change
- Who changed what, when, old vs new value
- Filterable by category, manager, date range, field

#### 3.7 — AI Chat (`/ai`)
- Natural language Q&A interface
- Ask questions like:
  - "What changed in Semiconductors this week?"
  - "Which items are below reorder point?"
  - "Summarize today's critical changes for Marcus"
- Powered by OpenAI Agent SDK via the Python AI service

### API Routes (Next.js `/app/api/`)
- `GET/POST /api/dataset` — List items, create item
- `PUT/DELETE /api/dataset/[id]` — Update/delete item
- `POST /api/dataset/upload` — CSV bulk upload
- `GET/POST /api/managers` — CRUD managers
- `GET /api/notifications/[managerId]` — Get notifications
- `PUT /api/notifications/[id]/read` — Mark read
- `GET /api/changes` — Query change log
- `POST /api/scrape` — Trigger data scrape
- `POST /api/ai/chat` — Proxy to Python AI service

---

## Phase 4: Python AI Service

### Tech Stack
- Python 3.11, FastAPI
- OpenAI Agent SDK (`openai-agents`)
- BeautifulSoup + httpx for scraping
- psycopg2 for direct DB access
- APScheduler for periodic tasks

### Agents (OpenAI Agent SDK)

#### 4.1 — Change Detection Agent
- Runs on a schedule (every 5 minutes) or triggered by webhook
- Compares current dataset state to last snapshot
- Identifies: new items, deleted items, field changes (price, quantity, status, priority)
- Routes changes to affected managers based on category

#### 4.2 — Summarizer Agent
- Takes a batch of raw changes and produces a human-readable summary
- Groups changes by category, highlights most important ones
- Example output: *"3 items in Semiconductors updated: MCU-2048 price increased 12% ($4.50→$5.04), FPGA-100 quantity_needed raised to 5000, SENSOR-IR dropped to critical priority"*

#### 4.3 — Anomaly Detection Agent
- Flags unusual patterns:
  - Price changes > 10%
  - Quantity spikes/drops > 50%
  - Items sitting in "pending" status too long
  - Supplier concentration risk
- Creates high-priority notifications for anomalies

#### 4.4 — Query Agent (Chat)
- Natural language interface to the dataset
- Uses function calling to query the DB
- Can answer questions about current state, historical changes, trends

### Scraper Module
- `commodity_scraper.py` — Scrapes public product/pricing data
- `data_generator.py` — Generates realistic synthetic data seeded with scraped prices
- Produces ~200 items with realistic SKUs, suppliers, pricing

### Endpoints
- `POST /api/ai/chat` — Chat with the query agent
- `POST /api/ai/analyze` — Run anomaly detection on current data
- `POST /api/ai/summarize` — Summarize recent changes for a manager
- `POST /api/ai/scrape` — Run the scraper
- `GET /api/ai/health` — Health check

---

## Phase 5: Notification System

### How It Works
1. **Change detected** (edit via UI, CSV upload, or scrape update)
2. **Next.js API** logs the change to `dataset_changes` table
3. **AI service** picks up new changes (webhook or poll)
4. **Summarizer agent** groups changes and creates human-readable summary
5. **Anomaly agent** checks for unusual patterns
6. **Notification created** in `notifications` table for the relevant manager(s)
7. **Dashboard** shows new notification badge + toast

### Notification Rules (per manager)
- Filter by priority threshold (e.g., only critical/high)
- Filter by change type (price changes only, new items only, etc.)
- Email digest option (stretch goal — via existing Gmail/SMTP credentials)

---

## Phase 6: Kubernetes Deployment

### Resources
```yaml
# Frontend: Next.js
  image: node:20-alpine
  resources:
    requests: { cpu: 200m, memory: 512Mi }
    limits: { cpu: 1000m, memory: 1Gi }

# AI Service: Python
  image: python:3.11-slim
  resources:
    requests: { cpu: 200m, memory: 256Mi }
    limits: { cpu: 500m, memory: 512Mi }
```

### Files
- `k8s/namespace.yaml` — Namespace `meta-test`
- `k8s/deployment.yaml` — 2 deployments (frontend + ai-service) with hostPath volumes
- `k8s/services.yaml` — NodePort for frontend, ClusterIP for ai-service
- `k8s/ingress.yaml` — Traefik ingress with TLS for `meta.callsphere.tech`
- `k8s/secrets.yaml` — OpenAI API key
- `k8s/configmap.yaml` — DB connection, app config

### HostPath Volumes (for hot-reload dev)
```
/home/ubuntu/apps/meta_test/frontend → /app (frontend container)
/home/ubuntu/apps/meta_test/ai-service → /app (ai-service container)
```

---

## Phase 7: Database Schema (Prisma)

```prisma
model SourcingManager {
  id              String   @id @default(uuid())
  name            String
  email           String   @unique
  role            String   @default("manager")
  categories      Category[]
  notifications   Notification[]
  rules           NotificationRule[]
  createdAt       DateTime @default(now())
}

model Category {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  managerId   String
  manager     SourcingManager @relation(fields: [managerId], references: [id])
  items       DatasetItem[]
}

model DatasetItem {
  id              String   @id @default(uuid())
  sku             String   @unique
  itemName        String
  categoryId      String
  category        Category @relation(fields: [categoryId], references: [id])
  supplier        String
  quantityNeeded  Int
  quantityOnHand  Int
  reorderPoint    Int
  unitPrice       Decimal  @db.Decimal(10,2)
  currency        String   @default("USD")
  leadTimeDays    Int
  priority        String   @default("medium")  // critical, high, medium, low
  status          String   @default("pending")  // pending, approved, ordered, delivered, cancelled
  notes           String?
  lastUpdated     DateTime @updatedAt
  createdAt       DateTime @default(now())
  changes         DatasetChange[]
}

model DatasetChange {
  id           String   @id @default(uuid())
  itemId       String
  item         DatasetItem @relation(fields: [itemId], references: [id])
  fieldChanged String
  oldValue     String
  newValue     String
  changeType   String   // create, update, delete, bulk_upload, scrape
  changedBy    String   @default("system")
  aiSummary    String?
  createdAt    DateTime @default(now())
}

model Notification {
  id          String   @id @default(uuid())
  managerId   String
  manager     SourcingManager @relation(fields: [managerId], references: [id])
  title       String
  message     String
  aiSummary   String?
  priority    String   @default("medium")
  read        Boolean  @default(false)
  changeIds   String[] // references to DatasetChange ids
  createdAt   DateTime @default(now())
}

model NotificationRule {
  id              String   @id @default(uuid())
  managerId       String
  manager         SourcingManager @relation(fields: [managerId], references: [id])
  ruleType        String   // priority_threshold, change_type, price_change_pct
  threshold       String
  enabled         Boolean  @default(true)
}

model ScrapeLog {
  id            String   @id @default(uuid())
  source        String
  itemsScraped  Int
  status        String   // success, partial, failed
  errorMessage  String?
  scrapedAt     DateTime @default(now())
}
```

---

## Implementation Order

| Step | What | Est. Files |
|------|------|-----------|
| 1 | DNS A record (Hostinger) + create DB | 0 |
| 2 | Next.js project scaffold (package.json, tailwind, prisma, layout) | ~8 |
| 3 | Prisma schema + seed data (scrape + generate ~200 items) | ~4 |
| 4 | API routes (dataset CRUD, managers, changes, notifications) | ~10 |
| 5 | Dashboard pages (admin overview, manager view, charts) | ~6 |
| 6 | Dataset table page (editable grid, CSV upload) | ~3 |
| 7 | Notification center page | ~2 |
| 8 | Change audit log page | ~2 |
| 9 | Python AI service (FastAPI + OpenAI agents) | ~8 |
| 10 | AI chat page in frontend | ~2 |
| 11 | K8s manifests + deploy | ~5 |
| 12 | Integration testing + polish | ~0 |

**Total**: ~50 files

---

## Key Interview Talking Points This Enables

1. **Scraping & Bot-Driven Data Collection** → Live scraper pulling real pricing data
2. **AI Automation** → OpenAI Agent SDK with 4 specialized agents
3. **Scalability** → Category-based routing (add managers/categories without code changes), k8s deployment
4. **Relevance Filtering** → Each manager sees only their categories, notification rules
5. **Maintainability** → Clean separation (Next.js for UI/API, Python for AI), Prisma for schema management
6. **Change Detection** → Every edit tracked, AI summarizes batches of changes
7. **Compliance** → Full audit trail in change log

---

## Blockers / Questions

1. **Hostinger API token** — appears expired. Need to either:
   - Get a fresh token from Hostinger panel
   - Or manually add the DNS A record via the Hostinger web UI

2. **Cluster resources** — Server at 61% memory (9.8GB/16GB). The 2 pods we're adding are lightweight (~1.5GB total). Should be fine.

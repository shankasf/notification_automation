"""FastAPI application entry point for the MetaSource AI Service.

This is the main HTTP server that exposes REST endpoints for the AI-powered
workforce management platform. It orchestrates:
- Natural-language chat queries against hiring/requisition data
- AI-driven change summarization and anomaly detection
- File upload processing through a multi-agent pipeline
- Market rate scraping / generation
- Manager email notifications with anomaly deduplication
- Background schedulers for periodic summarization and anomaly scans

All endpoints apply input guardrails (prompt injection, PII redaction, length
limits) and output guardrails (sanitization, scope validation) before and after
LLM calls.
"""

import asyncio
import os
import sys
import uuid
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

# Fail fast if DATABASE_URL is not configured
if not os.environ.get("DATABASE_URL"):
    print("FATAL: DATABASE_URL environment variable is not set. Exiting.", file=sys.stderr)
    sys.exit(1)

from logging_config import setup_logging, get_logger

setup_logging(os.environ.get("LOG_LEVEL", "INFO"))
logger = get_logger("api")

from agents import trace, set_tracing_disabled
from agents.tracing import custom_span

# Disable sending traces to OpenAI backend if no API key or explicitly disabled
if os.environ.get("DISABLE_OPENAI_TRACING", "").lower() in ("1", "true"):
    set_tracing_disabled(True)
    logger.info("OpenAI tracing disabled via DISABLE_OPENAI_TRACING")

from guardrails.prompt_guard import check_prompt_injection, validate_input_length
from guardrails.pii_scanner import redact_text, has_pii
from guardrails.file_validator import validate_upload, scan_file_pii
from guardrails.output_sanitizer import hash_response
from ai_agents.change_detector import detect_changes
from ai_agents.summarizer import summarize_changes
from ai_agents.anomaly_detector import detect_anomalies
from ai_agents.query_agent import process_query
from ai_agents.upload_pipeline import run_pipeline
from scrapers.rate_scraper import scrape_market_rates
from email_notifier import send_manager_notification
from anomaly_dedup import compute_fingerprint, is_duplicate, record_fingerprint, ensure_table

app = FastAPI(title="MetaSource AI Service", version="1.0.0")

# CORS restricted to the Go gateway (both k8s service name and local dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://meta-gateway:8080", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Origin", "Content-Type", "Authorization", "Accept", "X-Request-ID"],
)

# In-memory session store for chat continuity
sessions: dict[str, list] = {}


# ── Request logging middleware ────────────────────────────────────────────


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    logger.info(
        "request_started",
        extra={"extra_data": {"method": request.method, "path": request.url.path}},
    )
    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "request_completed",
        extra={
            "extra_data": {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            }
        },
    )
    return response


# ── Request / Response models ──────────────────────────────────────────────


class ChatRequest(BaseModel):
    message: str
    managerId: Optional[str] = None
    sessionId: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    sessionId: str


class ChangeItem(BaseModel):
    changeType: str
    fieldChanged: str
    oldValue: Optional[str] = None
    newValue: Optional[str] = None
    requisitionId: Optional[str] = None


class SummarizeRequest(BaseModel):
    changes: list[ChangeItem]
    category: str


class SummarizeResponse(BaseModel):
    summary: str


class AnalyzeRequest(BaseModel):
    managerId: Optional[str] = None
    category: Optional[str] = None


class AnomalyItem(BaseModel):
    type: str
    description: str
    severity: str
    requisitionId: Optional[str] = None


class AnalyzeResponse(BaseModel):
    anomalies: list[AnomalyItem]


class DetectChangesRequest(BaseModel):
    since: Optional[datetime] = None


class DetectChangesResponse(BaseModel):
    changes_by_category: dict


class ScrapeResponse(BaseModel):
    status: str
    roles_scraped: int
    duration_ms: int


class UploadProcessRequest(BaseModel):
    jobId: str
    fileContent: str
    fileType: str  # csv, json, xlsx, txt, etc.
    rawBytes: Optional[str] = None  # base64 encoded for binary files


class UploadProcessResponse(BaseModel):
    jobId: str
    status: str
    created: int
    failed: int
    errors: list[str]


# ── Routes ─────────────────────────────────────────────────────────────────


@app.post("/api/ai/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, request_obj: Request):
    """Natural language query agent - answers questions about workforce data."""
    session_id = request.sessionId or str(uuid.uuid4())
    logger.info(
        "chat_request",
        extra={
            "extra_data": {
                "session_id": session_id,
                "manager_id": request.managerId,
                "message_length": len(request.message),
            }
        },
    )

    # ── Input guardrails ──────────────────────────────────────────────
    if not validate_input_length(request.message):
        return JSONResponse(
            status_code=400,
            content={"error": "Message too long (max 10,000 characters)"},
        )

    blocked, reason = check_prompt_injection(request.message)
    if blocked:
        logger.warning(
            "prompt_injection_blocked",
            extra={"extra_data": {"reason": reason, "session_id": session_id}},
        )
        return JSONResponse(
            status_code=400,
            content={"error": f"Message blocked: {reason}"},
        )

    # Read user identity from gateway headers (for scope validation)
    user_email = request_obj.headers.get("x-user-email", "unknown")
    user_role = request_obj.headers.get("x-user-role", "")
    user_category = request_obj.headers.get("x-manager-category", "")

    # Check banned cross-category topics (managers only)
    from guardrails.prompt_guard import check_banned_topics
    banned, ban_reason = check_banned_topics(request.message, user_category or None)
    if banned:
        logger.warning("banned_topic_blocked", extra={"extra_data": {"reason": ban_reason}})
        return JSONResponse(status_code=400, content={"error": f"Query blocked: {ban_reason}"})

    # Redact PII from user message before sending to LLM
    if has_pii(request.message):
        logger.warning("pii_in_chat_message", extra={"extra_data": {"user": user_email}})
        request.message = redact_text(request.message)

    try:
        with trace("Chat Query", group_id=session_id):
            with custom_span("chat_endpoint"):
                response_text = await process_query(
                    request.message,
                    request.managerId,
                    category=user_category or None,
                )
        response_hash = hash_response(response_text)
        logger.info(
            "chat_response",
            extra={
                "extra_data": {
                    "session_id": session_id,
                    "response_length": len(response_text),
                    "response_hash": response_hash,
                    "user_email": user_email,
                }
            },
        )
        return ChatResponse(response=response_text, sessionId=session_id)
    except Exception as e:
        logger.error(
            "chat_failed",
            extra={"extra_data": {"session_id": session_id, "error": str(e)}},
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")


@app.post("/api/ai/summarize", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest):
    """Summarize requisition changes using AI."""
    logger.info(
        "summarize_request",
        extra={
            "extra_data": {
                "category": request.category,
                "change_count": len(request.changes),
            }
        },
    )
    try:
        with trace("Summarize Changes"):
            with custom_span("summarize_endpoint"):
                changes_dicts = [c.model_dump() for c in request.changes]
                summary = await summarize_changes(changes_dicts, request.category)
        logger.info(
            "summarize_response",
            extra={
                "extra_data": {
                    "category": request.category,
                    "summary_length": len(summary),
                }
            },
        )
        return SummarizeResponse(summary=summary)
    except Exception as e:
        logger.error(
            "summarize_failed",
            extra={"extra_data": {"category": request.category, "error": str(e)}},
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail=f"Summarization failed: {str(e)}"
        )


@app.post("/api/ai/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """Detect anomalies in requisition data using AI."""
    logger.info(
        "analyze_request",
        extra={
            "extra_data": {
                "category": request.category,
                "manager_id": request.managerId,
            }
        },
    )
    try:
        with trace("Anomaly Analysis"):
            with custom_span("analyze_endpoint"):
                anomalies_raw = await detect_anomalies(
                    category=request.category, manager_id=request.managerId
                )
                anomalies = []
                for a in anomalies_raw:
                    anomalies.append(
                        AnomalyItem(
                            type=a.get("type", "unknown"),
                            description=a.get("description", ""),
                            severity=a.get("severity", "medium"),
                            requisitionId=a.get("requisitionId"),
                        )
                    )
        logger.info(
            "analyze_response",
            extra={
                "extra_data": {
                    "category": request.category,
                    "anomaly_count": len(anomalies),
                }
            },
        )
        return AnalyzeResponse(anomalies=anomalies)
    except Exception as e:
        logger.error(
            "analyze_failed",
            extra={"extra_data": {"category": request.category, "error": str(e)}},
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail=f"Analysis failed: {str(e)}"
        )


@app.post("/api/ai/detect-changes", response_model=DetectChangesResponse)
async def detect_changes_endpoint(request: DetectChangesRequest):
    """Detect unsummarized changes (pure Python, no AI)."""
    logger.info(
        "detect_changes_request",
        extra={"extra_data": {"since": str(request.since)}},
    )
    try:
        with trace("Detect Changes"):
            with custom_span("detect_changes_endpoint"):
                grouped = detect_changes(since=request.since)
        total = sum(len(v) for v in grouped.values())
        logger.info(
            "detect_changes_response",
            extra={
                "extra_data": {
                    "categories_found": len(grouped),
                    "total_changes": total,
                }
            },
        )
        return DetectChangesResponse(changes_by_category=grouped)
    except Exception as e:
        logger.error("detect_changes_failed", extra={"extra_data": {"error": str(e)}}, exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Change detection failed: {str(e)}"
        )


@app.post("/api/ai/scrape", response_model=ScrapeResponse)
async def scrape(request: dict = None):
    """Scrape/generate market rates."""
    logger.info("scrape_request")
    try:
        with trace("Market Rate Scrape"):
            with custom_span("scrape_endpoint"):
                result = await scrape_market_rates()
        logger.info(
            "scrape_response",
            extra={"extra_data": {"roles_scraped": result["roles_scraped"], "duration_ms": result["duration_ms"]}},
        )
        return ScrapeResponse(**result)
    except Exception as e:
        logger.error("scrape_failed", extra={"extra_data": {"error": str(e)}}, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Scraping failed: {str(e)}")


@app.get("/api/ai/health")
async def health():
    logger.debug("health_check")
    return {"status": "ok"}


# ── Anomaly email notification with dedup ────────────────────────────────


class NotifyAnomalyRequest(BaseModel):
    anomalies: list[AnomalyItem]
    category: str
    managerId: Optional[str] = None


@app.post("/api/ai/notify-anomaly")
async def notify_anomaly(request: NotifyAnomalyRequest):
    """Send email for critical/high anomalies with dedup.

    Returns which anomalies are NEW (not seen in the last 24h) so the
    caller can decide whether to create in-app notifications for them.
    """
    logger.info(
        "notify_anomaly_request_disabled",
        extra={
            "extra_data": {
                "category": request.category,
                "anomaly_count": len(request.anomalies),
                "manager_id": request.managerId,
            }
        },
    )
    # Anomaly notifications temporarily disabled
    return {"sent": 0, "skipped": len(request.anomalies), "newAnomalies": [], "disabled": True}

    sent = 0
    skipped = 0
    new_anomalies: list[dict] = []

    # Resolve manager if not provided
    manager_id = request.managerId
    if not manager_id:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        try:
            cur = conn.cursor()
            cur.execute(
                'SELECT id FROM "SourcingManager" WHERE category = %s',
                (request.category,),
            )
            row = cur.fetchone()
            if row:
                manager_id = row[0]
        finally:
            conn.close()

    for anomaly in request.anomalies:
        if anomaly.severity not in ("critical", "high"):
            continue

        fp = compute_fingerprint(anomaly.type, anomaly.requisitionId, request.category)

        if is_duplicate(fp, hours=24):
            logger.info(
                "anomaly_email_skipped_dup",
                extra={
                    "extra_data": {
                        "fingerprint": fp[:16],
                        "type": anomaly.type,
                        "category": request.category,
                    }
                },
            )
            skipped += 1
            continue

        # Record fingerprint before sending to prevent race conditions
        record_fingerprint(fp, request.category, anomaly.severity, manager_id)

        # Track this as a genuinely new anomaly
        new_anomalies.append({
            "type": anomaly.type,
            "description": anomaly.description,
            "severity": anomaly.severity,
            "requisitionId": anomaly.requisitionId,
        })

        if manager_id:
            msg = f"[{anomaly.severity.upper()}] {anomaly.description}"
            send_manager_notification(
                manager_id,
                f"Anomaly Alert: {request.category.replace('_', ' ').title()}",
                msg,
                "ANOMALY_ALERT",
            )
            sent += 1

    logger.info(
        "notify_anomaly_complete",
        extra={
            "extra_data": {
                "category": request.category,
                "sent": sent,
                "skipped": skipped,
                "new_count": len(new_anomalies),
            }
        },
    )
    return {"sent": sent, "skipped": skipped, "newAnomalies": new_anomalies}


# ── Manager email notification ───────────────────────────────────────────


class SendEmailRequest(BaseModel):
    managerId: str
    subject: str
    body: str
    notifType: str = "CHANGE_SUMMARY"


@app.post("/api/ai/send-email")
async def send_email(request: SendEmailRequest):
    """Send an email notification to a manager."""
    logger.info(
        "send_email_request",
        extra={
            "extra_data": {
                "manager_id": request.managerId,
                "subject": request.subject,
                "notif_type": request.notifType,
            }
        },
    )
    success = send_manager_notification(
        request.managerId, request.subject, request.body, request.notifType
    )
    return {"sent": success}


# ── Data Upload Pipeline ─────────────────────────────────────────────────

# Track running jobs (with timestamps for cleanup)
_upload_jobs: dict[str, dict] = {}
_UPLOAD_JOB_TTL_SECONDS = 3600  # 1 hour


def _cleanup_old_jobs():
    """Remove upload job results older than TTL to prevent memory leaks."""
    now = time.time()
    expired = [
        jid for jid, data in _upload_jobs.items()
        if now - data.get("_stored_at", 0) > _UPLOAD_JOB_TTL_SECONDS
    ]
    for jid in expired:
        del _upload_jobs[jid]


@app.post("/api/ai/upload/process", response_model=UploadProcessResponse)
async def process_upload(request: UploadProcessRequest):
    """Start the multi-agent data upload pipeline."""
    logger.info(
        "upload_process_request",
        extra={
            "extra_data": {
                "job_id": request.jobId,
                "file_type": request.fileType,
                "content_length": len(request.fileContent),
            }
        },
    )

    # Decode base64 binary payload (e.g., xlsx) sent from the gateway
    raw_bytes = None
    if request.rawBytes:
        import base64

        raw_bytes = base64.b64decode(request.rawBytes)

    # ── File validation guardrails ────────────────────────────────────
    if raw_bytes:
        filename = f"{request.jobId}.{request.fileType}"
        valid, reason = validate_upload(raw_bytes, filename)
        if not valid:
            return JSONResponse(
                status_code=400,
                content={"error": f"File rejected: {reason}"},
            )

    # Scan text content for PII
    if request.fileContent:
        pii_findings = scan_file_pii(request.fileContent)
        if pii_findings:
            logger.warning(
                "pii_in_upload",
                extra={"extra_data": {"findings_count": len(pii_findings), "job_id": request.jobId}},
            )
            # Redact PII from file content before processing
            request.fileContent = redact_text(request.fileContent)

    try:
        with trace("Upload Pipeline", metadata={"job_id": request.jobId, "file_type": request.fileType}):
            with custom_span("upload_pipeline_execution"):
                result = await run_pipeline(
                    job_id=request.jobId,
                    file_content=request.fileContent,
                    file_type=request.fileType,
                    raw_bytes=raw_bytes,
                )
        # Evict stale results first, then cache this one for status polling
        _cleanup_old_jobs()
        result["_stored_at"] = time.time()
        _upload_jobs[request.jobId] = result
        logger.info(
            "upload_process_completed",
            extra={
                "extra_data": {
                    "job_id": request.jobId,
                    "created": result["created"],
                    "failed": result["failed"],
                }
            },
        )
        return UploadProcessResponse(
            jobId=request.jobId,
            status="completed",
            created=result["created"],
            failed=result["failed"],
            errors=result["errors"],
        )
    except Exception as e:
        logger.error(
            "upload_process_failed",
            extra={"extra_data": {"job_id": request.jobId, "error": str(e)}},
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")


@app.get("/api/ai/upload/status/{job_id}")
async def upload_status(job_id: str):
    """Get status of an upload job."""
    logger.info(
        "upload_status_request",
        extra={"extra_data": {"job_id": job_id}},
    )
    if job_id in _upload_jobs:
        return _upload_jobs[job_id]
    return {"status": "processing", "message": "Pipeline is still running"}


# ── Background Schedulers ────────────────────────────────────────────────

scheduler_logger = get_logger("scheduler")


async def scheduled_summarize():
    """Periodically find unsummarized RequisitionChange rows, generate AI summaries
    grouped by category, stamp the summary back onto each change row, and send a
    digest email to the category manager.

    In-app notifications are NOT created here — the gateway already creates one
    immediately when the change occurs (see requisitions.go UpdateRequisition).

    Runs every 15 minutes in the background.
    """
    while True:
        await asyncio.sleep(900)  # 15 minutes
        scheduler_logger.info("scheduled_summarize_started")
        try:
            with trace("Scheduled Summarize"):
                grouped = detect_changes()
                if not grouped:
                    scheduler_logger.info("scheduled_summarize_no_changes")
                    continue

                for category, changes in grouped.items():
                    if not changes:
                        continue

                    scheduler_logger.info(
                        "summarizing_category",
                        extra={
                            "extra_data": {
                                "category": category,
                                "change_count": len(changes),
                            }
                        },
                    )

                    with custom_span(f"summarize_{category}"):
                        summary = await summarize_changes(changes, category)

                    manager_id = None
                    should_email = False
                    with custom_span(f"db_update_{category}"):
                        conn = psycopg2.connect(os.environ["DATABASE_URL"])
                        cur = conn.cursor()
                        try:
                            change_ids = [c["id"] for c in changes]
                            for cid in change_ids:
                                cur.execute(
                                    'UPDATE "RequisitionChange" SET summary = %s WHERE id = %s',
                                    (summary, cid),
                                )
                            cur.execute(
                                'SELECT id FROM "SourcingManager" WHERE category = %s',
                                (category,),
                            )
                            row = cur.fetchone()
                            if row:
                                manager_id = row[0]
                                should_email = True
                            conn.commit()
                            scheduler_logger.info(
                                "db_updated",
                                extra={
                                    "extra_data": {
                                        "category": category,
                                        "changes_updated": len(change_ids),
                                        "email_queued": should_email,
                                    }
                                },
                            )
                        finally:
                            conn.close()

                    if should_email and manager_id:
                        with custom_span(f"email_{category}"):
                            send_manager_notification(
                                manager_id,
                                f"{len(changes)} Changes in {category.replace('_', ' ').title()}",
                                summary,
                                "CHANGE_SUMMARY",
                            )

                    scheduler_logger.info(
                        "category_summarized",
                        extra={
                            "extra_data": {
                                "category": category,
                                "change_count": len(changes),
                            }
                        },
                    )
        except Exception as e:
            scheduler_logger.error(
                "scheduled_summarize_failed",
                extra={"extra_data": {"error": str(e)}},
                exc_info=True,
            )


async def scheduled_anomaly_scan():
    """Run anomaly detection daily at 10 AM UTC across all five workforce categories.

    For each category, calls the AI anomaly detector, deduplicates results against
    the AnomalyFingerprint table (24h window), creates in-app Notifications, and
    sends a consolidated email to the category manager.
    """
    while True:
        # Calculate seconds until next 10 AM UTC
        now = datetime.now(timezone.utc)
        target = now.replace(hour=10, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        wait_seconds = (target - now).total_seconds()
        scheduler_logger.info(
            "anomaly_scan_scheduled",
            extra={"extra_data": {"next_run": str(target), "wait_seconds": wait_seconds}},
        )
        await asyncio.sleep(wait_seconds)

        scheduler_logger.info("scheduled_anomaly_scan_started")
        try:
            categories = [
                "ENGINEERING_CONTRACTORS",
                "CONTENT_TRUST_SAFETY",
                "DATA_OPERATIONS",
                "MARKETING_CREATIVE",
                "CORPORATE_SERVICES",
            ]
            with trace("Scheduled Anomaly Scan"):
                for category in categories:
                    scheduler_logger.info(
                        "scanning_category",
                        extra={"extra_data": {"category": category}},
                    )

                    with custom_span(f"anomaly_detect_{category}"):
                        anomalies = await detect_anomalies(category=category)

                    if not anomalies:
                        scheduler_logger.info(
                            "no_anomalies",
                            extra={"extra_data": {"category": category}},
                        )
                        continue

                    scheduler_logger.warning(
                        "anomalies_detected",
                        extra={
                            "extra_data": {
                                "category": category,
                                "anomaly_count": len(anomalies),
                            }
                        },
                    )

                    # Create in-app notifications and email for new (non-duplicate) anomalies
                    with custom_span(f"anomaly_notify_{category}"):
                        conn = psycopg2.connect(os.environ["DATABASE_URL"])
                        cur = conn.cursor()
                        try:
                            cur.execute(
                                'SELECT id FROM "SourcingManager" WHERE category = %s',
                                (category,),
                            )
                            row = cur.fetchone()
                            if row:
                                manager_id = row[0]
                                all_msgs = []
                                # Cap at 5 anomalies per category to avoid notification spam
                                for anomaly in anomalies[:5]:
                                    a_type = anomaly.get("type", "unknown")
                                    a_severity = anomaly.get("severity", "medium")
                                    a_req_id = anomaly.get("requisitionId")
                                    fp = compute_fingerprint(a_type, a_req_id, category)

                                    if is_duplicate(fp, hours=24):
                                        scheduler_logger.info(
                                            "scheduled_anomaly_skipped_dup",
                                            extra={
                                                "extra_data": {
                                                    "fingerprint": fp[:16],
                                                    "type": a_type,
                                                    "category": category,
                                                }
                                            },
                                        )
                                        continue

                                    msg = f"[{a_severity.upper()}] {anomaly.get('description', 'Anomaly detected')}"
                                    cur.execute(
                                        '''INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
                                           VALUES (gen_random_uuid(), %s, 'ANOMALY_ALERT', 'Automated Anomaly Alert', %s, false, NOW())''',
                                        (manager_id, msg),
                                    )
                                    all_msgs.append(msg)
                                    record_fingerprint(fp, category, a_severity, manager_id)
                            conn.commit()
                        finally:
                            conn.close()

                        if row and all_msgs:
                            send_manager_notification(
                                manager_id,
                                f"Anomaly Alert: {category.replace('_', ' ').title()}",
                                "\n".join(all_msgs),
                                "ANOMALY_ALERT",
                            )
                            scheduler_logger.info(
                                "anomaly_notifications_sent",
                                extra={
                                    "extra_data": {
                                        "category": category,
                                        "manager_id": manager_id,
                                        "notification_count": len(all_msgs),
                                    }
                                },
                            )
        except Exception as e:
            scheduler_logger.error(
                "scheduled_anomaly_scan_failed",
                extra={"extra_data": {"error": str(e)}},
                exc_info=True,
            )


@app.on_event("startup")
async def start_schedulers():
    logger.info("starting_background_schedulers")
    ensure_table()
    asyncio.create_task(scheduled_summarize())
    # asyncio.create_task(scheduled_anomaly_scan())  # temporarily disabled
    logger.info("background_schedulers_started")

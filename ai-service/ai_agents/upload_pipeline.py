"""Multi-agent data-upload pipeline orchestrator.

Coordinates the four-stage pipeline that turns a raw uploaded file into
validated Requisition rows in PostgreSQL:

  1. **Parse** -- detect file format and extract raw records (upload_parser)
  2. **Clean** -- normalize fields via LLM in parallel batches (upload_cleaner)
  3. **Validate** -- enforce Pydantic schema constraints (upload_models)
  4. **Upsert** -- insert valid records and create RequisitionChange audit rows

Progress updates are broadcast to the Go gateway at each stage so the
frontend can show real-time status via WebSocket.

After insertion, in-app Notifications are created for the sourcing managers
of affected categories.
"""

import os
import time
import asyncio
import uuid
from datetime import datetime, timezone

import psycopg2
import httpx

from logging_config import get_logger
from ai_agents.upload_parser import parse_file
from ai_agents.upload_cleaner import clean_records
from ai_agents.upload_models import CleanedRequisition, PipelineRecord, RecordStatus

logger = get_logger("pipeline")

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://meta-gateway:8080")

# Category short names for generating requisition IDs
CATEGORY_SHORT = {
    "ENGINEERING_CONTRACTORS": "ENG",
    "CONTENT_TRUST_SAFETY": "CTS",
    "DATA_OPERATIONS": "DOP",
    "MARKETING_CREATIVE": "MKT",
    "CORPORATE_SERVICES": "COR",
}


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


async def broadcast_progress(
    job_id: str, stage: str, records: list[PipelineRecord], message: str = ""
):
    """Send progress update to Go gateway for WebSocket broadcast."""
    summary = {
        "pending": sum(1 for r in records if r.status == RecordStatus.PENDING),
        "parsing": sum(1 for r in records if r.status == RecordStatus.PARSING),
        "cleaning": sum(1 for r in records if r.status == RecordStatus.CLEANING),
        "validated": sum(1 for r in records if r.status == RecordStatus.VALIDATED),
        "uploaded": sum(1 for r in records if r.status == RecordStatus.UPLOADED),
        "failed": sum(1 for r in records if r.status == RecordStatus.FAILED),
    }
    payload = {
        "jobId": job_id,
        "stage": stage,
        "total": len(records),
        "summary": summary,
        "message": message,
    }
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{GATEWAY_URL}/api/data-upload/progress", json=payload
            )
    except Exception as e:
        logger.warning(
            "broadcast_failed", extra={"extra_data": {"error": str(e)}}
        )


def generate_requisition_id(category: str, conn, cat_offset: int = 0) -> str:
    """Generate the next sequential requisition ID for a category (e.g. REQ-ENG-042).

    Queries the MAX numeric suffix currently in the table, then adds 1 plus
    cat_offset. cat_offset accounts for records already inserted in this batch
    but not yet visible to the MAX query (same transaction or concurrent uploads).
    """
    short = CATEGORY_SHORT.get(category, "GEN")
    cur = conn.cursor()
    cur.execute(
        """SELECT COALESCE(MAX(CAST(SUBSTRING("requisitionId" FROM '[0-9]+$') AS INTEGER)), 0)
           FROM "Requisition" WHERE category = %s""",
        (category,),
    )
    max_num = cur.fetchone()[0]
    return f"REQ-{short}-{max_num + 1 + cat_offset:03d}"


def upsert_record(validated: CleanedRequisition, conn, cat_created_counts: dict[str, int] | None = None) -> str:
    """Insert a validated record into the Requisition table and create an
    audit RequisitionChange row. Returns the generated requisitionId."""
    cat_offset = (cat_created_counts or {}).get(validated.category, 0)
    req_id = generate_requisition_id(validated.category, conn, cat_offset)
    rid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # Default budget = hourly rate * headcount * 2080 (standard work hours/year)
    budget = validated.budgetAllocated or (
        validated.billRateHourly * validated.headcountNeeded * 2080
    )

    cur = conn.cursor()
    cur.execute(
        """INSERT INTO "Requisition" (id, "requisitionId", team, department, "roleTitle", category,
               "headcountNeeded", "headcountFilled", vendor, "billRateHourly", location,
               status, priority, "budgetAllocated", "budgetSpent", notes, "createdAt", "updatedAt")
           VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s,%s,%s,0,%s,%s,%s)""",
        (
            rid,
            req_id,
            validated.team,
            validated.department,
            validated.roleTitle,
            validated.category,
            validated.headcountNeeded,
            validated.vendor,
            validated.billRateHourly,
            validated.location,
            validated.status,
            validated.priority,
            budget,
            validated.notes,
            now,
            now,
        ),
    )
    # Create change record
    change_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO "RequisitionChange" (id, "requisitionId", "changeType", "changedBy", summary, "createdAt")
           VALUES (%s, %s, 'BULK_IMPORT', 'data_upload_pipeline', %s, %s)""",
        (
            change_id,
            rid,
            f"Imported via AI pipeline: {validated.roleTitle} at {validated.location}",
            now,
        ),
    )
    return req_id


async def run_pipeline(
    job_id: str, file_content: str, file_type: str, raw_bytes: bytes = None
) -> dict:
    """Run the full multi-agent upload pipeline.

    Returns: {"created": int, "failed": int, "errors": [...], "records": [...]}
    """
    logger.info(
        "pipeline_started",
        extra={"extra_data": {"job_id": job_id, "file_type": file_type}},
    )
    start = time.time()
    records: list[PipelineRecord] = []

    # -- Stage 1: Parse --
    await broadcast_progress(
        job_id, "parsing", records, "Detecting format and extracting records..."
    )
    raw_records = await parse_file(file_content, file_type, raw_bytes)

    if not raw_records:
        await broadcast_progress(
            job_id, "failed", records, "No records could be extracted from the file"
        )
        return {
            "created": 0,
            "failed": 0,
            "errors": ["No records found in file"],
            "records": [],
        }

    records = [
        PipelineRecord(index=i, raw_data=r, status=RecordStatus.PARSING)
        for i, r in enumerate(raw_records)
    ]
    await broadcast_progress(
        job_id, "parsing", records, f"Extracted {len(records)} records"
    )
    logger.info(
        "parse_complete",
        extra={"extra_data": {"job_id": job_id, "records": len(records)}},
    )

    # -- Stage 2: Clean (parallel batches) --
    for r in records:
        r.status = RecordStatus.CLEANING
    await broadcast_progress(
        job_id, "cleaning", records, f"Cleaning {len(records)} records in parallel..."
    )

    cleaned_list = await clean_records([r.raw_data for r in records])

    # Map cleaned data back to records
    for i, r in enumerate(records):
        if i < len(cleaned_list) and cleaned_list[i]:
            r.cleaned_data = cleaned_list[i]
        else:
            r.status = RecordStatus.FAILED
            r.error = "Cleaning agent returned empty result for this record"

    await broadcast_progress(job_id, "cleaning", records, "Cleaning complete")

    # -- Stage 3: Validate with Pydantic --
    for r in records:
        if r.status == RecordStatus.FAILED:
            continue
        try:
            validated = CleanedRequisition.model_validate(r.cleaned_data)
            r.cleaned_data = validated.model_dump()
            r.validated = True
            r.status = RecordStatus.VALIDATED
        except Exception as e:
            r.status = RecordStatus.FAILED
            r.error = f"Validation failed: {str(e)}"

    await broadcast_progress(job_id, "validating", records, "Validation complete")
    logger.info(
        "validate_complete",
        extra={
            "extra_data": {
                "job_id": job_id,
                "valid": sum(1 for r in records if r.validated),
                "invalid": sum(1 for r in records if r.status == RecordStatus.FAILED),
            }
        },
    )

    # -- Stage 4: Upsert to DB --
    await broadcast_progress(
        job_id, "uploading", records, "Inserting records into database..."
    )

    # Insert each validated record individually so a single bad row
    # doesn't roll back the entire batch. On failure, reconnect and
    # continue with the next record.
    conn = _get_conn()
    created = 0
    cat_created_counts: dict[str, int] = {}  # tracks per-category insert count for ID generation
    try:
        for r in records:
            if r.status != RecordStatus.VALIDATED:
                continue
            try:
                validated = CleanedRequisition.model_validate(r.cleaned_data)
                req_id = upsert_record(validated, conn, cat_created_counts)
                conn.commit()
                r.requisition_id = req_id
                r.status = RecordStatus.UPLOADED
                created += 1
                cat_created_counts[validated.category] = cat_created_counts.get(validated.category, 0) + 1
            except Exception as e:
                r.status = RecordStatus.FAILED
                r.error = f"DB insert failed: {str(e)}"
                conn.rollback()
                # Reconnect for next record in case the connection is in a bad state
                try:
                    conn.close()
                except Exception:
                    pass
                conn = _get_conn()
    finally:
        conn.close()

    # -- Notify managers for affected categories --
    # Create an in-app Notification for each category that received new records
    affected_categories = set()
    for r in records:
        if r.status == RecordStatus.UPLOADED and r.cleaned_data:
            affected_categories.add(r.cleaned_data.get("category"))

    if affected_categories:
        try:
            notif_conn = _get_conn()
            cur = notif_conn.cursor()
            for cat in affected_categories:
                cat_count = sum(
                    1
                    for r in records
                    if r.status == RecordStatus.UPLOADED
                    and r.cleaned_data
                    and r.cleaned_data.get("category") == cat
                )
                cur.execute(
                    'SELECT id FROM "SourcingManager" WHERE category = %s', (cat,)
                )
                row = cur.fetchone()
                if row:
                    manager_id = row[0]
                    cur.execute(
                        """INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
                           VALUES (gen_random_uuid(), %s, 'CHANGE_SUMMARY', 'AI Data Upload Complete', %s, false, NOW())""",
                        (
                            manager_id,
                            f"{cat_count} new hiring requests imported via AI pipeline into {cat.replace('_', ' ').title()}",
                        ),
                    )
            notif_conn.commit()
            notif_conn.close()
        except Exception as e:
            logger.error(
                "notification_failed",
                extra={"extra_data": {"error": str(e)}},
            )

    failed = sum(1 for r in records if r.status == RecordStatus.FAILED)
    errors = [
        f"Record {r.index}: {r.error}"
        for r in records
        if r.status == RecordStatus.FAILED
    ]

    await broadcast_progress(
        job_id, "completed", records, f"Done: {created} created, {failed} failed"
    )

    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "pipeline_completed",
        extra={
            "extra_data": {
                "job_id": job_id,
                "created": created,
                "failed": failed,
                "duration_ms": duration_ms,
            }
        },
    )

    return {
        "created": created,
        "failed": failed,
        "errors": errors,
        "records": [r.model_dump() for r in records],
    }

"""Pure-Python change detector for unsummarized requisition changes.

Queries the RequisitionChange table for rows whose `summary` column is NULL
(i.e., not yet processed by the summarizer) within a given time window, and
groups them by workforce category. No LLM is involved here -- this is a
simple database scan that feeds into the AI summarizer.

Used by:
- The /api/ai/detect-changes endpoint (on-demand)
- The scheduled_summarize background task (every 15 minutes)
"""

import psycopg2
import os
import time
from datetime import datetime, timedelta

from logging_config import get_logger

logger = get_logger("agent.change_detector")


def detect_changes(since: datetime = None):
    """Find unsummarized changes, grouped by category."""
    if since is None:
        since = datetime.utcnow() - timedelta(hours=24)

    logger.info(
        "detect_changes_started",
        extra={"extra_data": {"since": str(since)}},
    )
    start = time.time()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT rc.id, rc."changeType", rc."fieldChanged", rc."oldValue", rc."newValue",
                   r."requisitionId", r."roleTitle", r.category
            FROM "RequisitionChange" rc
            JOIN "Requisition" r ON rc."requisitionId" = r.id
            WHERE rc.summary IS NULL AND rc."createdAt" >= %s
            ORDER BY rc."createdAt" DESC
        """,
            (since,),
        )

        changes = cur.fetchall()
        # Group changes by category (column index 7) so each category
        # can be summarized independently
        grouped = {}
        for change in changes:
            cat = change[7]
            if cat not in grouped:
                grouped[cat] = []
            grouped[cat].append(
                {
                    "id": change[0],
                    "changeType": change[1],
                    "fieldChanged": change[2],
                    "oldValue": change[3],
                    "newValue": change[4],
                    "requisitionId": change[5],
                    "roleTitle": change[6],
                }
            )

        duration_ms = round((time.time() - start) * 1000, 2)
        total = sum(len(v) for v in grouped.values())
        logger.info(
            "detect_changes_completed",
            extra={
                "extra_data": {
                    "total_changes": total,
                    "categories": list(grouped.keys()),
                    "duration_ms": duration_ms,
                }
            },
        )
        return grouped
    except Exception as e:
        logger.error(
            "detect_changes_failed",
            extra={"extra_data": {"error": str(e)}},
            exc_info=True,
        )
        raise
    finally:
        conn.close()

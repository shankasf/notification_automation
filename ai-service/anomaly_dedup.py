"""Anomaly deduplication helpers.

Uses an AnomalyFingerprint table to prevent sending duplicate notifications
and emails for the same anomaly within a configurable time window (default 24h).
"""

import hashlib
import os

import psycopg2

from logging_config import get_logger

logger = get_logger("anomaly_dedup")


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def ensure_table():
    """Create the AnomalyFingerprint table if it does not exist."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS "AnomalyFingerprint" (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                fingerprint TEXT NOT NULL,
                category TEXT NOT NULL,
                severity TEXT NOT NULL,
                "managerId" TEXT,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_anomaly_fp_lookup
            ON "AnomalyFingerprint" (fingerprint, "createdAt");
        """)
        conn.commit()
        logger.info("anomaly_fingerprint_table_ensured")
    except Exception as e:
        logger.error(
            "ensure_table_failed",
            extra={"extra_data": {"error": str(e)}},
            exc_info=True,
        )
        conn.rollback()
    finally:
        conn.close()


def compute_fingerprint(anomaly_type: str, requisition_id: str | None, category: str) -> str:
    """Return a SHA-256 hex digest of the anomaly's unique key.

    The key is composed of anomaly_type + requisition_id + category so that
    the same anomaly on the same requisition in the same category always
    produces the same fingerprint.
    """
    raw = f"{anomaly_type}:{requisition_id or ''}:{category}"
    return hashlib.sha256(raw.encode()).hexdigest()


def is_duplicate(fingerprint: str, hours: int = 24) -> bool:
    """Check whether a fingerprint was already recorded within the last *hours*."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT 1 FROM "AnomalyFingerprint"
            WHERE fingerprint = %s
              AND "createdAt" >= NOW() - INTERVAL '%s hours'
            LIMIT 1
            """,
            (fingerprint, hours),
        )
        exists = cur.fetchone() is not None
        logger.debug(
            "dedup_check",
            extra={"extra_data": {"fingerprint": fingerprint[:16], "is_dup": exists}},
        )
        return exists
    finally:
        conn.close()


def record_fingerprint(fingerprint: str, category: str, severity: str, manager_id: str | None) -> None:
    """Insert a new fingerprint record into the AnomalyFingerprint table."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO "AnomalyFingerprint" (id, fingerprint, category, severity, "managerId", "createdAt")
            VALUES (gen_random_uuid()::text, %s, %s, %s, %s, NOW())
            """,
            (fingerprint, category, severity, manager_id),
        )
        conn.commit()
        logger.info(
            "fingerprint_recorded",
            extra={
                "extra_data": {
                    "fingerprint": fingerprint[:16],
                    "category": category,
                    "severity": severity,
                }
            },
        )
    except Exception as e:
        logger.error(
            "record_fingerprint_failed",
            extra={"extra_data": {"error": str(e)}},
            exc_info=True,
        )
        conn.rollback()
    finally:
        conn.close()

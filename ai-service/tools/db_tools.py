from agents import function_tool
import psycopg2
import os
import json
import time

from logging_config import get_logger
from guardrails.data_classifier import classifier

logger = get_logger("tools.db")


def _safe_float(val, default=0.0):
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def get_conn():
    logger.debug("db_connection_opening")
    return psycopg2.connect(os.environ["DATABASE_URL"])


@function_tool
def query_requisitions(
    category: str = None,
    status: str = None,
    priority: str = None,
    vendor: str = None,
    location: str = None,
    limit: int = 50,
) -> str:
    """Search hiring requests with optional filters. Returns a list of matching requests with their details (role, rate, headcount, budget, status).
    category must be one of: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES.
    status must be one of: OPEN, SOURCING, INTERVIEWING, OFFER, ONBOARDING, ACTIVE, COMPLETED, CANCELLED.
    priority must be one of: CRITICAL, HIGH, MEDIUM, LOW."""
    logger.info(
        "tool_query_requisitions",
        extra={
            "extra_data": {
                "category": category,
                "status": status,
                "priority": priority,
                "vendor": vendor,
                "location": location,
                "limit": limit,
            }
        },
    )
    start = time.time()
    conn = get_conn()
    try:
        cur = conn.cursor()
        conditions = []
        params = []
        if category:
            conditions.append("category = %s")
            params.append(category)
        if status:
            conditions.append("status = %s")
            params.append(status)
        if priority:
            conditions.append("priority = %s")
            params.append(priority)
        if vendor:
            conditions.append("vendor ILIKE %s")
            params.append(f"%{vendor}%")
        if location:
            conditions.append("location ILIKE %s")
            params.append(f"%{location}%")

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        cur.execute(
            f"""SELECT "requisitionId", "roleTitle", category, status, priority, vendor, location,
                        "billRateHourly", "headcountNeeded", "headcountFilled", "budgetAllocated", "budgetSpent"
                        FROM "Requisition" {where} ORDER BY "updatedAt" DESC LIMIT %s""",
            params + [limit],
        )

        rows = cur.fetchall()
    finally:
        conn.close()

    result = [
        {
            "requisitionId": r[0],
            "roleTitle": r[1],
            "category": r[2],
            "status": r[3],
            "priority": r[4],
            "vendor": r[5],
            "location": r[6],
            "billRate": _safe_float(r[7]),
            "headcountNeeded": r[8],
            "headcountFilled": r[9],
            "budgetAllocated": _safe_float(r[10]),
            "budgetSpent": _safe_float(r[11]),
        }
        for r in rows
    ]
    result = classifier.filter_for_llm(result, "Requisition")
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "tool_query_requisitions_done",
        extra={
            "extra_data": {
                "rows_returned": len(result),
                "duration_ms": duration_ms,
            }
        },
    )
    return json.dumps(result)


@function_tool
def get_manager_stats(manager_category: str = None) -> str:
    """Get summary statistics for a manager's category or all categories (total requests, headcount, budget, average rate, critical count).
    manager_category must be one of: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES."""
    logger.info(
        "tool_get_manager_stats",
        extra={"extra_data": {"manager_category": manager_category}},
    )
    start = time.time()
    conn = get_conn()
    try:
        cur = conn.cursor()
        if manager_category:
            cur.execute(
                """SELECT category, COUNT(*),
                            SUM("headcountNeeded"), SUM("headcountFilled"),
                            SUM("budgetAllocated"), SUM("budgetSpent"),
                            AVG("billRateHourly"),
                            COUNT(*) FILTER (WHERE priority = 'CRITICAL'),
                            COUNT(*) FILTER (WHERE status = 'OPEN' OR status = 'SOURCING')
                            FROM "Requisition"
                            WHERE category = %s
                            GROUP BY category""",
                (manager_category,),
            )
        else:
            cur.execute(
                """SELECT category, COUNT(*),
                            SUM("headcountNeeded"), SUM("headcountFilled"),
                            SUM("budgetAllocated"), SUM("budgetSpent"),
                            AVG("billRateHourly"),
                            COUNT(*) FILTER (WHERE priority = 'CRITICAL'),
                            COUNT(*) FILTER (WHERE status = 'OPEN' OR status = 'SOURCING')
                            FROM "Requisition"
                            GROUP BY category"""
            )
        rows = cur.fetchall()
    finally:
        conn.close()

    result = [
        {
            "category": r[0],
            "totalReqs": r[1],
            "headcountNeeded": r[2],
            "headcountFilled": r[3],
            "budgetAllocated": _safe_float(r[4]),
            "budgetSpent": _safe_float(r[5]),
            "avgRate": _safe_float(r[6]),
            "criticalCount": r[7],
            "openSourcingCount": r[8],
        }
        for r in rows
    ]
    result = classifier.filter_for_llm(result, "Requisition")
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "tool_get_manager_stats_done",
        extra={
            "extra_data": {
                "categories_returned": len(result),
                "duration_ms": duration_ms,
            }
        },
    )
    return json.dumps(result)


@function_tool
def get_budget_overview(category: str = None) -> str:
    """Get budget usage overview by category (allocated vs spent, with percentage used).
    category must be one of: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES."""
    logger.info(
        "tool_get_budget_overview",
        extra={"extra_data": {"category": category}},
    )
    start = time.time()
    conn = get_conn()
    try:
        cur = conn.cursor()
        if category:
            cur.execute(
                """SELECT category,
                            SUM("budgetAllocated") as allocated,
                            SUM("budgetSpent") as spent,
                            ROUND((SUM("budgetSpent") / NULLIF(SUM("budgetAllocated"), 0) * 100)::numeric, 1) as utilization
                            FROM "Requisition"
                            WHERE category = %s
                            GROUP BY category ORDER BY utilization DESC""",
                (category,),
            )
        else:
            cur.execute(
                """SELECT category,
                            SUM("budgetAllocated") as allocated,
                            SUM("budgetSpent") as spent,
                            ROUND((SUM("budgetSpent") / NULLIF(SUM("budgetAllocated"), 0) * 100)::numeric, 1) as utilization
                            FROM "Requisition"
                            GROUP BY category ORDER BY utilization DESC"""
            )
        rows = cur.fetchall()
    finally:
        conn.close()

    result = [
        {
            "category": r[0],
            "allocated": _safe_float(r[1]),
            "spent": _safe_float(r[2]),
            "utilization": _safe_float(r[3]),
        }
        for r in rows
    ]
    result = classifier.filter_for_llm(result, "Requisition")
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "tool_get_budget_overview_done",
        extra={
            "extra_data": {
                "categories_returned": len(result),
                "duration_ms": duration_ms,
            }
        },
    )
    return json.dumps(result)


@function_tool
def get_headcount_gaps(category: str = None) -> str:
    """Get unfilled positions (positions needed minus positions filled) grouped by role and category. Only shows roles that still have openings.
    category must be one of: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES."""
    logger.info(
        "tool_get_headcount_gaps",
        extra={"extra_data": {"category": category}},
    )
    start = time.time()
    conn = get_conn()
    try:
        cur = conn.cursor()
        if category:
            cur.execute(
                """SELECT "roleTitle", category,
                            SUM("headcountNeeded") as needed, SUM("headcountFilled") as filled,
                            SUM("headcountNeeded") - SUM("headcountFilled") as gap
                            FROM "Requisition"
                            WHERE category = %s
                            GROUP BY "roleTitle", category
                            HAVING SUM("headcountNeeded") > SUM("headcountFilled")
                            ORDER BY gap DESC LIMIT 20""",
                (category,),
            )
        else:
            cur.execute(
                """SELECT "roleTitle", category,
                            SUM("headcountNeeded") as needed, SUM("headcountFilled") as filled,
                            SUM("headcountNeeded") - SUM("headcountFilled") as gap
                            FROM "Requisition"
                            GROUP BY "roleTitle", category
                            HAVING SUM("headcountNeeded") > SUM("headcountFilled")
                            ORDER BY gap DESC LIMIT 20"""
            )
        rows = cur.fetchall()
    finally:
        conn.close()

    result = [
        {
            "roleTitle": r[0],
            "category": r[1],
            "needed": r[2],
            "filled": r[3],
            "gap": r[4],
        }
        for r in rows
    ]
    result = classifier.filter_for_llm(result, "Requisition")
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "tool_get_headcount_gaps_done",
        extra={
            "extra_data": {
                "gaps_found": len(result),
                "duration_ms": duration_ms,
            }
        },
    )
    return json.dumps(result)


@function_tool
def get_vendor_analysis(category: str = None) -> str:
    """Get staffing vendor analysis — how many requests each vendor handles, their average bill rate, positions filled, and total spend.
    category must be one of: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES."""
    logger.info(
        "tool_get_vendor_analysis",
        extra={"extra_data": {"category": category}},
    )
    start = time.time()
    conn = get_conn()
    try:
        cur = conn.cursor()
        if category:
            cur.execute(
                """SELECT vendor, category, COUNT(*) as req_count,
                            AVG("billRateHourly") as avg_rate,
                            SUM("headcountFilled") as total_filled,
                            SUM("budgetSpent") as total_spend
                            FROM "Requisition"
                            WHERE category = %s
                            GROUP BY vendor, category ORDER BY req_count DESC""",
                (category,),
            )
        else:
            cur.execute(
                """SELECT vendor, category, COUNT(*) as req_count,
                            AVG("billRateHourly") as avg_rate,
                            SUM("headcountFilled") as total_filled,
                            SUM("budgetSpent") as total_spend
                            FROM "Requisition"
                            GROUP BY vendor, category ORDER BY req_count DESC"""
            )
        rows = cur.fetchall()
    finally:
        conn.close()

    result = [
        {
            "vendor": r[0],
            "category": r[1],
            "reqCount": r[2],
            "avgRate": _safe_float(r[3]),
            "totalFilled": r[4],
            "totalSpend": _safe_float(r[5]),
        }
        for r in rows
    ]
    result = classifier.filter_for_llm(result, "Requisition")
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "tool_get_vendor_analysis_done",
        extra={
            "extra_data": {
                "vendors_returned": len(result),
                "duration_ms": duration_ms,
            }
        },
    )
    return json.dumps(result)


@function_tool
def get_recent_changes(category: str = None, hours: int = 24) -> str:
    """Get recent changes to hiring requests (created, updated, status changes, rate changes, etc.) within the last N hours.
    Use this tool when the user asks what changed, what's new, what happened today, or about recent updates/activity.
    category must be one of: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES."""
    logger.info(
        "tool_get_recent_changes",
        extra={"extra_data": {"category": category, "hours": hours}},
    )
    start = time.time()
    conn = get_conn()
    try:
        cur = conn.cursor()
        conditions = ['rc."createdAt" >= NOW() - (%s * INTERVAL \'1 hour\')']
        params: list = [hours]
        if category:
            conditions.append("r.category = %s")
            params.append(category)

        where = "WHERE " + " AND ".join(conditions)
        cur.execute(
            f"""SELECT rc.id, rc."changeType", rc."fieldChanged", rc."oldValue", rc."newValue",
                       rc."changedBy", rc.summary, rc."createdAt",
                       r."requisitionId", r."roleTitle", r.category
                FROM "RequisitionChange" rc
                JOIN "Requisition" r ON rc."requisitionId" = r.id
                {where}
                ORDER BY rc."createdAt" DESC
                LIMIT 50""",
            params,
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    result = [
        {
            "changeType": r[1],
            "fieldChanged": r[2],
            "oldValue": r[3],
            "newValue": r[4],
            "changedBy": r[5],
            "summary": r[6],
            "changedAt": r[7].isoformat() if r[7] else None,
            "requisitionId": r[8],
            "roleTitle": r[9],
            "category": r[10],
        }
        for r in rows
    ]
    result = classifier.filter_for_llm(result, "Requisition")
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "tool_get_recent_changes_done",
        extra={
            "extra_data": {
                "changes_returned": len(result),
                "duration_ms": duration_ms,
            }
        },
    )
    return json.dumps(result, default=str)


@function_tool
def get_market_rates(role_title: str = None, category: str = None) -> str:
    """Get market rate data (min/max/median hourly rates from public sources) for comparing against your bill rates.
    category must be one of: ENGINEERING_CONTRACTORS, CONTENT_TRUST_SAFETY, DATA_OPERATIONS, MARKETING_CREATIVE, CORPORATE_SERVICES."""
    logger.info(
        "tool_get_market_rates",
        extra={"extra_data": {"role_title": role_title, "category": category}},
    )
    start = time.time()
    conn = get_conn()
    try:
        cur = conn.cursor()
        conditions = []
        params = []
        if role_title:
            conditions.append('"roleTitle" ILIKE %s')
            params.append(f"%{role_title}%")
        if category:
            conditions.append("category = %s")
            params.append(category)

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        cur.execute(
            f"""SELECT "roleTitle", category, location, "minRate", "maxRate", "medianRate", source
                        FROM "MarketRate" {where} ORDER BY "scrapedAt" DESC LIMIT 50""",
            params,
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    result = [
        {
            "roleTitle": r[0],
            "category": r[1],
            "location": r[2],
            "minRate": _safe_float(r[3]),
            "maxRate": _safe_float(r[4]),
            "medianRate": _safe_float(r[5]),
            "source": r[6],
        }
        for r in rows
    ]
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "tool_get_market_rates_done",
        extra={
            "extra_data": {
                "rates_returned": len(result),
                "duration_ms": duration_ms,
            }
        },
    )
    return json.dumps(result)

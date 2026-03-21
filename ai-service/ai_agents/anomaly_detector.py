"""AI-powered anomaly detection for hiring requisition data.

Fetches requisition records from PostgreSQL and sends them to an LLM agent
that flags unusual patterns: bill-rate spikes, headcount surges, budget
overruns, stale requests, below-market rates, and vendor concentration risk.

The agent returns a structured JSON array of findings which is parsed and
returned to the caller (the /api/ai/analyze endpoint or background scheduler).
"""

import os
import json
import time

from agents import Agent, Runner, trace
from agents.tracing import custom_span
import psycopg2

from logging_config import get_logger

logger = get_logger("agent.anomaly")

MINI_MODEL = os.environ.get("OPENAI_MINI_MODEL", "gpt-4.1-mini")

anomaly_agent = Agent(
    name="Anomaly Detector",
    model=MINI_MODEL,
    instructions="""You are a staffing data analyst. Analyze hiring request data for unusual patterns or potential issues.

Flag these unusual patterns:
1. Hourly bill rate spikes >10% above the category average
2. Headcount (positions needed) surges >50% increase
3. Budget used >90% of budget allocated
4. Stale hiring requests (in SOURCING or OPEN status for >30 days without progress)
5. Bill rate below market minimum (potential quality risk)
6. Single staffing vendor concentration >60% in a category

Return a JSON array of findings with: type, description, severity (critical/high/medium/low), requisitionId (if applicable).
Return ONLY the JSON array, no markdown formatting or code blocks.""",
)


async def detect_anomalies(category: str = None, manager_id: str = None) -> list:
    """Detect anomalies in requisition data."""
    logger.info(
        "detect_anomalies_started",
        extra={
            "extra_data": {
                "category": category,
                "manager_id": manager_id,
                "model": MINI_MODEL,
            }
        },
    )
    start = time.time()

    # Fetch requisition data
    with custom_span("anomaly_db_fetch"):
        db_start = time.time()
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        try:
            cur = conn.cursor()
        except Exception:
            conn.close()
            logger.error("db_cursor_failed", exc_info=True)
            raise

        if category:
            cur.execute(
                """SELECT "requisitionId", "roleTitle", category, "billRateHourly",
                            "headcountNeeded", "headcountFilled", status, "budgetAllocated",
                            "budgetSpent", vendor
                            FROM "Requisition" WHERE category = %s""",
                (category,),
            )
        else:
            cur.execute(
                """SELECT "requisitionId", "roleTitle", category, "billRateHourly",
                            "headcountNeeded", "headcountFilled", status, "budgetAllocated",
                            "budgetSpent", vendor
                            FROM "Requisition" """
            )

        rows = cur.fetchall()
        conn.close()
        db_ms = round((time.time() - db_start) * 1000, 2)

    logger.info(
        "anomaly_data_fetched",
        extra={
            "extra_data": {
                "row_count": len(rows),
                "category": category,
                "db_duration_ms": db_ms,
            }
        },
    )

    # Transform raw DB tuples into dicts for the LLM prompt
    data = [
        {
            "requisitionId": r[0],
            "roleTitle": r[1],
            "category": r[2],
            "billRate": float(r[3]) if r[3] else 0,
            "headcountNeeded": r[4],
            "headcountFilled": r[5],
            "status": r[6],
            "budgetAllocated": float(r[7]) if r[7] else 0,
            "budgetSpent": float(r[8]) if r[8] else 0,
            "vendor": r[9],
        }
        for r in rows
    ]

    if not data:
        logger.info(
            "no_data_for_anomaly_detection",
            extra={"extra_data": {"category": category}},
        )
        return []

    # Cap the prompt at 100 records to stay within LLM context limits;
    # append aggregate stats so the model is still aware of the full dataset
    prompt = f"Analyze these {len(data)} requisitions for anomalies:\n{json.dumps(data[:100], indent=2)}"
    if len(data) > 100:
        avg_rate = sum(d["billRate"] for d in data) / len(data)
        prompt += f"\n... and {len(data) - 100} more records (stats: avg rate ${avg_rate:.0f}/hr)"

    logger.debug(
        "anomaly_prompt_built",
        extra={
            "extra_data": {
                "prompt_length": len(prompt),
                "records_in_prompt": min(len(data), 100),
                "total_records": len(data),
            }
        },
    )

    with trace("Anomaly Detector Run", metadata={"category": category or "all", "record_count": len(data)}):
        with custom_span("anomaly_agent_execution"):
            result = await Runner.run(anomaly_agent, prompt)

    duration_ms = round((time.time() - start) * 1000, 2)

    # Strip markdown code fences the LLM may include despite instructions
    try:
        text = result.final_output
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        anomalies = json.loads(text.strip())
        logger.info(
            "detect_anomalies_completed",
            extra={
                "extra_data": {
                    "category": category,
                    "anomaly_count": len(anomalies),
                    "duration_ms": duration_ms,
                }
            },
        )
        return anomalies
    except (json.JSONDecodeError, IndexError) as e:
        # Graceful degradation: return the raw LLM text as a single finding
        # so the caller still gets something useful even if JSON parsing fails
        logger.warning(
            "anomaly_parse_failed",
            extra={
                "extra_data": {
                    "category": category,
                    "error": str(e),
                    "raw_output_length": len(result.final_output),
                }
            },
        )
        return [
            {
                "type": "analysis",
                "description": result.final_output,
                "severity": "medium",
            }
        ]

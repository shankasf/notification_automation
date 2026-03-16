import os
import json
import time
import asyncio

from agents import Agent, Runner
from logging_config import get_logger

logger = get_logger("agent.cleaner")
MINI_MODEL = os.environ.get("OPENAI_MINI_MODEL", "gpt-4.1-mini")

BATCH_SIZE = 10  # records per LLM call

cleaner_agent = Agent(
    name="Data Cleaner",
    model=MINI_MODEL,
    instructions="""You are a data cleaning specialist for staffing/hiring data. Clean and normalize each record.

CATEGORY MAPPING (use exact values):
- "eng", "engineering", "tech", "software" → "ENGINEERING_CONTRACTORS"
- "content", "cts", "trust", "safety", "moderation" → "CONTENT_TRUST_SAFETY"
- "data", "data ops", "dop", "analytics" → "DATA_OPERATIONS"
- "marketing", "creative", "mkt", "brand" → "MARKETING_CREATIVE"
- "corporate", "corp", "services", "hr", "finance", "legal" → "CORPORATE_SERVICES"

FIELD CLEANING:
- roleTitle: capitalize properly, fix typos
- billRateHourly: extract number from "$75/hr", "75.00/hour", "75" → 75.0
- headcountNeeded: extract integer, default 1
- status: uppercase enum → OPEN, SOURCING, INTERVIEWING, OFFER, ONBOARDING, ACTIVE, COMPLETED, CANCELLED. Default: OPEN
- priority: uppercase enum → CRITICAL, HIGH, MEDIUM, LOW. Default: MEDIUM
- location: normalize (e.g. "SF" → "San Francisco, CA", "NYC" → "New York, NY")
- dates: normalize to YYYY-MM-DD format
- team/department: capitalize properly
- vendor: capitalize properly

Return a JSON array of cleaned objects with EXACTLY these field names:
roleTitle, category, team, department, vendor, billRateHourly, headcountNeeded, location, status, priority, startDate, endDate, notes

Use null for fields that cannot be determined. roleTitle and category are required — if you truly cannot determine them, set roleTitle to the best guess and category to "CORPORATE_SERVICES" as fallback.

Return ONLY the JSON array.""",
)


async def clean_batch(records: list[dict], batch_index: int) -> list[dict]:
    """Clean a batch of records using the LLM."""
    logger.info(
        "clean_batch_started",
        extra={
            "extra_data": {"batch_index": batch_index, "record_count": len(records)}
        },
    )
    start = time.time()

    prompt = f"Clean and normalize these {len(records)} hiring records:\n{json.dumps(records, indent=2)}"
    result = await Runner.run(cleaner_agent, prompt)

    duration_ms = round((time.time() - start) * 1000, 2)

    try:
        text = result.final_output
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        cleaned = json.loads(text.strip())
        logger.info(
            "clean_batch_completed",
            extra={
                "extra_data": {
                    "batch_index": batch_index,
                    "cleaned_count": len(cleaned),
                    "duration_ms": duration_ms,
                }
            },
        )
        return cleaned if isinstance(cleaned, list) else [cleaned]
    except (json.JSONDecodeError, IndexError) as e:
        logger.error(
            "clean_batch_failed",
            extra={"extra_data": {"batch_index": batch_index, "error": str(e)}},
        )
        return []


async def clean_records(records: list[dict]) -> list[dict]:
    """Clean all records in parallel batches."""
    if not records:
        return []

    # Split into batches
    batches = [records[i : i + BATCH_SIZE] for i in range(0, len(records), BATCH_SIZE)]
    logger.info(
        "clean_records_started",
        extra={
            "extra_data": {
                "total_records": len(records),
                "batch_count": len(batches),
                "batch_size": BATCH_SIZE,
            }
        },
    )

    start = time.time()

    # Process all batches in parallel
    tasks = [clean_batch(batch, i) for i, batch in enumerate(batches)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Flatten results
    all_cleaned = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error(
                "batch_exception",
                extra={"extra_data": {"batch_index": i, "error": str(result)}},
            )
            # Return empty dicts for failed batch so indices stay aligned
            all_cleaned.extend([{}] * len(batches[i]))
        else:
            all_cleaned.extend(result)

    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "clean_records_completed",
        extra={
            "extra_data": {
                "total_cleaned": len(all_cleaned),
                "duration_ms": duration_ms,
            }
        },
    )
    return all_cleaned

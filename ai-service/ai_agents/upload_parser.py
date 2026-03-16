import csv
import json
import io
import os
import time
from typing import Optional

from agents import Agent, Runner
from logging_config import get_logger

logger = get_logger("agent.parser")
MINI_MODEL = os.environ.get("OPENAI_MINI_MODEL", "gpt-4.1-mini")

parser_agent = Agent(
    name="Data Parser",
    model=MINI_MODEL,
    instructions="""You are a data extraction specialist for staffing/hiring data. Given raw unstructured text, extract individual hiring request records.

For each record, extract these fields where available:
- roleTitle: the job title or role name
- category: the business area (engineering, content/trust safety, data ops, marketing, corporate)
- team: the team name
- department: the department
- vendor: the staffing agency name
- billRateHourly: the hourly bill rate (number only, no $ sign)
- headcountNeeded: number of positions needed
- location: work location
- status: current status (open, sourcing, interviewing, etc.)
- priority: urgency (critical, high, medium, low)
- startDate: start date if mentioned
- endDate: end date if mentioned
- notes: any additional notes

Return a JSON array of objects. Each object should have whatever fields you can identify. Use null for missing fields.
Return ONLY the JSON array, no markdown or explanation.""",
)


def parse_csv(content: str) -> list[dict]:
    """Parse CSV content into list of dicts."""
    reader = csv.DictReader(io.StringIO(content))
    return [dict(row) for row in reader]


def parse_json(content: str) -> list[dict]:
    """Parse JSON content — handles array or single object."""
    data = json.loads(content)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # Check if it has a nested array
        for key in ("data", "records", "items", "requisitions", "rows"):
            if key in data and isinstance(data[key], list):
                return data[key]
        return [data]
    return []


def parse_excel(content: bytes) -> list[dict]:
    """Parse Excel file content into list of dicts."""
    try:
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(content))
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) < 2:
            return []
        headers = [
            str(h).strip() if h else f"col_{i}" for i, h in enumerate(rows[0])
        ]
        records = []
        for row in rows[1:]:
            record = {}
            for i, val in enumerate(row):
                if i < len(headers) and val is not None:
                    record[headers[i]] = str(val).strip()
            if any(record.values()):
                records.append(record)
        return records
    except Exception as e:
        logger.error(
            "excel_parse_failed", extra={"extra_data": {"error": str(e)}}
        )
        return []


async def parse_unstructured(content: str) -> list[dict]:
    """Use LLM to extract records from unstructured text."""
    logger.info(
        "llm_parse_started",
        extra={"extra_data": {"content_length": len(content)}},
    )
    start = time.time()

    # Truncate if too long
    truncated = content[:8000] if len(content) > 8000 else content
    prompt = f"Extract hiring/staffing records from this data:\n\n{truncated}"

    result = await Runner.run(parser_agent, prompt)
    duration_ms = round((time.time() - start) * 1000, 2)

    try:
        text = result.final_output
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        records = json.loads(text.strip())
        logger.info(
            "llm_parse_completed",
            extra={
                "extra_data": {"records": len(records), "duration_ms": duration_ms}
            },
        )
        return records if isinstance(records, list) else [records]
    except (json.JSONDecodeError, IndexError) as e:
        logger.error(
            "llm_parse_json_failed", extra={"extra_data": {"error": str(e)}}
        )
        return []


async def parse_file(
    content: str, file_type: str, raw_bytes: bytes = None
) -> list[dict]:
    """Parse file content based on type. Returns list of raw record dicts."""
    logger.info(
        "parse_file_started",
        extra={
            "extra_data": {"file_type": file_type, "content_length": len(content)}
        },
    )

    file_type = file_type.lower().strip(".")

    if file_type in ("csv", "tsv"):
        records = parse_csv(content)
    elif file_type in ("json", "jsonl"):
        records = parse_json(content)
    elif file_type in ("xlsx", "xls") and raw_bytes:
        records = parse_excel(raw_bytes)
    elif file_type in ("xlsx", "xls"):
        # If only text content was sent, try to parse as CSV (Excel copy-paste)
        records = (
            parse_csv(content) if "," in content else await parse_unstructured(content)
        )
    else:
        # Unstructured text — use LLM
        records = await parse_unstructured(content)

    logger.info(
        "parse_file_completed",
        extra={
            "extra_data": {"records_found": len(records), "file_type": file_type}
        },
    )
    return records

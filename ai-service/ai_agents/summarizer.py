import os
import json
import time

from agents import Agent, Runner, trace
from agents.tracing import custom_span

from logging_config import get_logger

logger = get_logger("agent.summarizer")

MINI_MODEL = os.environ.get("OPENAI_MINI_MODEL", "gpt-4.1-mini")

summarizer_agent = Agent(
    name="Change Summarizer",
    model=MINI_MODEL,
    instructions="""You are a sourcing operations analyst. Summarize hiring request changes concisely for sourcing managers.

Rules:
- Be specific: mention role titles, rates, percentages
- Group related changes (e.g., "3 AR/VR hiring requests opened")
- Highlight significant changes: rate changes >5%, headcount changes, status transitions
- Use business language, not technical jargon
- Keep summaries under 3 sentences
- Format: Start with the most impactful change""",
)


async def summarize_changes(changes: list, category: str) -> str:
    """Summarize a list of changes for a category."""
    logger.info(
        "summarize_started",
        extra={
            "extra_data": {
                "category": category,
                "change_count": len(changes),
                "model": MINI_MODEL,
            }
        },
    )
    start = time.time()

    prompt = f"Summarize these {category} requisition changes:\n{json.dumps(changes, indent=2)}"
    logger.debug(
        "summarize_prompt_built",
        extra={"extra_data": {"prompt_length": len(prompt)}},
    )

    with trace("Summarizer Agent Run", metadata={"category": category, "change_count": len(changes)}):
        with custom_span("summarizer_execution"):
            result = await Runner.run(summarizer_agent, prompt)

    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "summarize_completed",
        extra={
            "extra_data": {
                "category": category,
                "duration_ms": duration_ms,
                "summary_length": len(result.final_output),
            }
        },
    )
    return result.final_output

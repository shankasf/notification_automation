import os
import time

from agents import Agent, Runner, trace
from agents.tracing import custom_span

from logging_config import get_logger
from tools.db_tools import (
    query_requisitions,
    get_manager_stats,
    get_budget_overview,
    get_headcount_gaps,
    get_vendor_analysis,
    get_market_rates,
)

logger = get_logger("agent.query")

CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4.1")

query_agent = Agent(
    name="Workforce Query Agent",
    model=CHAT_MODEL,
    instructions="""You are MetaSource AI, an intelligent assistant for sourcing managers who manage contractor hiring.

You help managers understand their hiring request data by querying the database and providing clear, actionable answers.

KEY TERMS (use these when talking to users):
- "Hiring request" = a formal request to fill contractor positions (stored as "Requisition" in the database)
- "Unfilled positions" = headcountNeeded minus headcountFilled
- "Hourly bill rate" = the dollar/hour rate a staffing vendor charges
- "Budget used" = budgetSpent / budgetAllocated as a percentage

IMPORTANT - Category mapping (users may use short names, always use the exact enum value in tool calls):
- "Engineering" or "Eng" → ENGINEERING_CONTRACTORS
- "Content" or "Trust & Safety" → CONTENT_TRUST_SAFETY
- "Data" or "Data Ops" → DATA_OPERATIONS
- "Marketing" or "Creative" → MARKETING_CREATIVE
- "Corporate" or "Corp Services" → CORPORATE_SERVICES

When answering:
- Use specific numbers and percentages
- Compare to averages when relevant
- Suggest actions when appropriate
- Format currency as $X.XX/hr or $X,XXX
- Be concise but thorough
- Use friendly category names (e.g., "Engineering Contractors" not "ENGINEERING_CONTRACTORS")
- Say "hiring requests" not "requisitions" when talking to users

You have access to tools that query the hiring request database. Use them to get accurate data before answering.""",
    tools=[
        query_requisitions,
        get_manager_stats,
        get_budget_overview,
        get_headcount_gaps,
        get_vendor_analysis,
        get_market_rates,
    ],
)


async def process_query(message: str, manager_id: str = None) -> str:
    """Process a natural language query about workforce data."""
    logger.info(
        "process_query_started",
        extra={
            "extra_data": {
                "manager_id": manager_id,
                "message_length": len(message),
                "model": CHAT_MODEL,
            }
        },
    )
    start = time.time()

    context = ""
    if manager_id:
        context = f"The user is a sourcing manager (ID: {manager_id}). Focus on their category when possible. "
        logger.debug(
            "query_context_added",
            extra={"extra_data": {"manager_id": manager_id}},
        )

    prompt = context + message

    with trace("Query Agent Run", metadata={"manager_id": manager_id or "anonymous"}):
        with custom_span("agent_execution"):
            result = await Runner.run(query_agent, prompt)

    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "process_query_completed",
        extra={
            "extra_data": {
                "duration_ms": duration_ms,
                "output_length": len(result.final_output),
            }
        },
    )
    return result.final_output

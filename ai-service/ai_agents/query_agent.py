import os
import time

from agents import Agent, Runner, trace
from agents.tracing import custom_span

import os as _os
import psycopg2 as _psycopg2

from logging_config import get_logger
from guardrails.output_sanitizer import sanitize_llm_output, validate_response_scope, hash_response
from tools.db_tools import (
    query_requisitions,
    get_manager_stats,
    get_budget_overview,
    get_headcount_gaps,
    get_vendor_analysis,
    get_market_rates,
    get_recent_changes,
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

IMPORTANT — When the user asks about changes, updates, what happened today, what's new, or recent activity:
- ALWAYS use the get_recent_changes tool first to look up actual change records
- Report specific changes (e.g., "REQ-COR-202 was created", "bill rate changed from $50 to $60")
- Do NOT just show current stats — the user wants to know what specifically changed

You have access to tools that query the hiring request database. Use them to get accurate data before answering.""",
    tools=[
        query_requisitions,
        get_manager_stats,
        get_budget_overview,
        get_headcount_gaps,
        get_vendor_analysis,
        get_market_rates,
        get_recent_changes,
    ],
)


async def process_query(message: str, manager_id: str = None, category: str = None) -> str:
    """Process a natural language query about workforce data."""
    logger.info(
        "process_query_started",
        extra={
            "extra_data": {
                "manager_id": manager_id,
                "message_length": len(message),
                "model": CHAT_MODEL,
                "category": category,
            }
        },
    )
    start = time.time()

    context = ""
    if manager_id:
        # Look up the manager's name and category so the agent queries the right data
        try:
            conn = _psycopg2.connect(_os.environ["DATABASE_URL"])
            cur = conn.cursor()
            cur.execute('SELECT name, category FROM "SourcingManager" WHERE id = %s', (manager_id,))
            row = cur.fetchone()
            conn.close()
            if row:
                manager_name, manager_category = row
                context = (
                    f"The user is {manager_name}, a sourcing manager for the {manager_category} category "
                    f"(manager ID: {manager_id}). Always use category={manager_category} when calling tools for this manager. "
                )
            else:
                context = f"The user is a sourcing manager (ID: {manager_id}). "
        except Exception:
            context = f"The user is a sourcing manager (ID: {manager_id}). "
        logger.debug(
            "query_context_added",
            extra={"extra_data": {"manager_id": manager_id, "context": context}},
        )

    prompt = context + message

    with trace("Query Agent Run", metadata={"manager_id": manager_id or "anonymous"}):
        with custom_span("agent_execution"):
            result = await Runner.run(query_agent, prompt)

    # Output guardrails
    output = sanitize_llm_output(result.final_output)
    if category:
        output = validate_response_scope(output, category)

    response_hash = hash_response(output)
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "process_query_completed",
        extra={
            "extra_data": {
                "duration_ms": duration_ms,
                "output_length": len(output),
                "response_hash": response_hash,
            }
        },
    )
    return output

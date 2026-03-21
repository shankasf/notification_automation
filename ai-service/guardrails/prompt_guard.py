"""Prompt injection defense and banned topic detection.

Provides two layers of input filtering:

1. **Prompt injection** -- Regex patterns that catch common jailbreak attempts
   (e.g., "ignore previous instructions", "you are now a", "DAN mode"). Any
   match causes the message to be rejected outright.

2. **Banned cross-category topics** -- Prevents non-admin managers from
   requesting sensitive financial data across categories (e.g., "show all
   vendor pricing"). Admin users (no category set) are exempt.
"""

import re

from logging_config import get_logger

logger = get_logger("guardrails.prompt")

# ── Prompt injection patterns ────────────────────────────────────────────
# Case-insensitive regexes covering known jailbreak/override phrasings.
# Compiled once at import time for performance.
INJECTION_PATTERNS = [
    r"(?i)ignore\s+(all\s+)?previous\s+instructions",
    r"(?i)forget\s+(your\s+)?(system\s+)?prompt",
    r"(?i)you\s+are\s+now\s+a",
    r"(?i)reveal\s+(your\s+)?(system\s+)?instructions",
    r"(?i)disregard\s+(all\s+)?prior",
    r"(?i)override\s+(your\s+)?programming",
    r"(?i)pretend\s+(you\s+are|to\s+be)",
    r"(?i)act\s+as\s+(if\s+you|a\s+different)",
    r"(?i)jailbreak",
    r"(?i)DAN\s+mode",
    r"(?i)bypass\s+(your\s+)?(safety|content|guard)",
]

_compiled_injection = [re.compile(p) for p in INJECTION_PATTERNS]

# ── Banned cross-category data requests ──────────────────────────────────
# Patterns that indicate a manager is trying to access data outside their
# own category. Only enforced for non-admin users.
BANNED_CROSS_CATEGORY_PATTERNS = [
    r"(?i)show\s+(me\s+)?all\s+(vendor|contract|pricing)",
    r"(?i)(every|all)\s+manager.*(data|rate|budget|contract)",
    r"(?i)compare\s+.*across\s+.*categor",
]

_compiled_banned = [re.compile(p) for p in BANNED_CROSS_CATEGORY_PATTERNS]


def check_prompt_injection(message: str) -> tuple[bool, str]:
    """Check if a message contains prompt injection attempts.

    Returns:
        (is_blocked, reason) — is_blocked is True if the message should be rejected.
    """
    for pattern in _compiled_injection:
        if pattern.search(message):
            reason = f"Potential prompt injection detected: {pattern.pattern[:60]}"
            logger.warning(
                "prompt_injection_detected",
                extra={
                    "extra_data": {
                        "pattern": pattern.pattern[:60],
                        "message_preview": message[:100],
                    }
                },
            )
            return True, reason

    return False, ""


def check_banned_topics(
    message: str, user_category: str | None
) -> tuple[bool, str]:
    """Check if a non-admin user is requesting cross-category sensitive data.

    Admin users (user_category is None or empty) are not restricted.

    Returns:
        (is_blocked, reason) — is_blocked is True if the request should be rejected.
    """
    # Admins can query across categories
    if not user_category:
        return False, ""

    for pattern in _compiled_banned:
        if pattern.search(message):
            reason = "Cross-category data requests are restricted to admin users"
            logger.warning(
                "banned_topic_blocked",
                extra={
                    "extra_data": {
                        "pattern": pattern.pattern[:60],
                        "user_category": user_category,
                        "message_preview": message[:100],
                    }
                },
            )
            return True, reason

    return False, ""


def validate_input_length(message: str, max_chars: int = 10000) -> bool:
    """Check that a message does not exceed the maximum allowed character count.

    Returns True if the message is within limits, False otherwise.
    """
    if len(message) > max_chars:
        logger.warning(
            "input_too_long",
            extra={
                "extra_data": {
                    "length": len(message),
                    "max_chars": max_chars,
                }
            },
        )
        return False
    return True

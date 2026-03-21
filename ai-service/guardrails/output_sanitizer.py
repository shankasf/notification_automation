"""LLM output sanitization -- strips dangerous content and enforces scope.

This is an *output* guardrail applied after the LLM generates a response but
before it is returned to the user. Two concerns are addressed:

1. **Sanitization** -- Removes script tags, HTML event handlers, and SQL
   injection patterns that a compromised or confused LLM might produce.
   Markdown formatting is preserved since it is safe for frontend rendering.

2. **Scope validation** -- For non-admin users (managers), checks each line
   of the response for references to *other* categories that also contain
   sensitive financial data (bill rates, budgets). Matching lines are
   replaced with a redaction notice so managers cannot see data outside
   their own category.
"""

import re
import hashlib

from logging_config import get_logger

logger = get_logger("guardrails.output")

# ── Dangerous content patterns stripped from LLM output ──────────────────
_SCRIPT_TAG_RE = re.compile(r"<script[^>]*>.*?</script>", re.DOTALL | re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_EVENT_HANDLER_RE = re.compile(r"\bon\w+\s*=\s*[\"'][^\"']*[\"']", re.IGNORECASE)
# Matches destructive SQL statements that could be injected into downstream systems
_SQL_INJECTION_RE = re.compile(
    r"(?i)(\b(DROP|ALTER|DELETE|INSERT|UPDATE|TRUNCATE)\s+(TABLE|DATABASE|FROM)\b"
    r"|;\s*--"
    r"|UNION\s+SELECT"
    r"|INTO\s+OUTFILE"
    r"|LOAD_FILE\s*\()",
)

# Maps each category enum to the friendly names the LLM might use in its
# response text. Used by validate_response_scope to detect cross-category leaks.
_CATEGORY_NAMES = {
    "ENGINEERING_CONTRACTORS": [
        "engineering contractor",
        "engineering_contractors",
        "eng contractor",
    ],
    "CONTENT_TRUST_SAFETY": [
        "content trust",
        "trust & safety",
        "trust and safety",
        "content_trust_safety",
    ],
    "DATA_OPERATIONS": [
        "data operations",
        "data ops",
        "data_operations",
    ],
    "MARKETING_CREATIVE": [
        "marketing creative",
        "marketing_creative",
    ],
    "CORPORATE_SERVICES": [
        "corporate services",
        "corp services",
        "corporate_services",
    ],
}

# Financial keywords that, when combined with another category name, indicate
# a cross-category data leak that should be redacted for non-admin users
_SENSITIVE_KEYWORDS = re.compile(
    r"(?i)(\$[\d,]+\.?\d*(/hr)?|\bbill\s*rate\b|\bbudget\s*(allocated|spent)\b|\bavg\s*rate\b|\btotal\s*spend\b)"
)


def sanitize_llm_output(text: str) -> str:
    """Strip dangerous content from LLM output.

    Removes: script tags, HTML tags, event handlers, SQL injection patterns.
    Preserves markdown formatting (which is safe for rendering).
    """
    original_len = len(text)

    # Remove script tags and their contents first
    text = _SCRIPT_TAG_RE.sub("", text)
    # Remove event handlers (onclick="...", etc.)
    text = _EVENT_HANDLER_RE.sub("", text)
    # Remove remaining HTML tags
    text = _HTML_TAG_RE.sub("", text)
    # Remove SQL injection patterns
    text = _SQL_INJECTION_RE.sub("[FILTERED]", text)

    if len(text) != original_len:
        logger.warning(
            "output_sanitized",
            extra={
                "extra_data": {
                    "original_length": original_len,
                    "sanitized_length": len(text),
                    "chars_removed": original_len - len(text),
                }
            },
        )

    return text


def validate_response_scope(response: str, user_category: str | None) -> str:
    """Validate that the response doesn't leak sensitive data from other categories.

    If the user is a manager (has a category), check that the response doesn't
    contain sensitive financial data referencing other categories. If it does,
    redact those references.

    Admin users (user_category is None or empty) are not restricted.
    """
    if not user_category:
        return response

    # Normalize to uppercase so header case doesn't matter
    user_cat_upper = user_category.upper() if user_category else ""

    # Build list of other categories
    other_categories: list[str] = []
    for cat_enum, cat_names in _CATEGORY_NAMES.items():
        if cat_enum != user_cat_upper:
            other_categories.extend(cat_names)

    if not other_categories:
        return response

    # Check each line — if it mentions another category AND contains sensitive data, redact
    lines = response.split("\n")
    redacted_lines: list[str] = []
    redaction_count = 0

    for line in lines:
        line_lower = line.lower()
        mentions_other = any(cat in line_lower for cat in other_categories)
        has_sensitive = bool(_SENSITIVE_KEYWORDS.search(line))

        if mentions_other and has_sensitive:
            redacted_lines.append("[Data redacted — outside your category scope]")
            redaction_count += 1
        else:
            redacted_lines.append(line)

    if redaction_count > 0:
        logger.warning(
            "response_scope_redacted",
            extra={
                "extra_data": {
                    "user_category": user_category,
                    "lines_redacted": redaction_count,
                }
            },
        )

    return "\n".join(redacted_lines)


def hash_response(text: str) -> str:
    """Compute SHA-256 hash of a response for audit logging."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

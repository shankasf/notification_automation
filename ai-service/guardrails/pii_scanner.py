"""PII detection and redaction using regex patterns.

Scans text for personally identifiable information (SSNs, credit cards,
emails, phone numbers) and cloud credentials (AWS access/secret keys).
Detected PII is replaced with tagged markers like [REDACTED_SSN] so that
sensitive data never reaches the LLM or appears in API responses.

This is an input guardrail -- applied to chat messages and uploaded file
content before any AI processing occurs.
"""

import re
from dataclasses import dataclass

from logging_config import get_logger

logger = get_logger("guardrails.pii")


@dataclass
class PIIFinding:
    pii_type: str  # SSN, CREDIT_CARD, EMAIL, PHONE, AWS_KEY, AWS_SECRET
    start: int
    end: int
    original: str


PII_PATTERNS = {
    "SSN": r"\b\d{3}-\d{2}-\d{4}\b",
    "CREDIT_CARD": r"\b(?:\d{4}[-\s]?){3}\d{4}\b",
    "EMAIL": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
    "PHONE": r"\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b",
    "AWS_KEY": r"\bAKIA[0-9A-Z]{16}\b",
    "AWS_SECRET": r"\b[A-Za-z0-9/+=]{40}\b",  # context-dependent, high false-positive rate
}

# AWS_SECRET is noisy — only flag it when near keywords that suggest it's a real secret
_AWS_SECRET_CONTEXT_KEYWORDS = re.compile(
    r"(?i)(aws|secret|key|credential|access)", re.IGNORECASE
)


def scan_text(text: str) -> list[PIIFinding]:
    """Find all PII matches in the given text.

    Returns a list of PIIFinding objects with type, position, and original text.
    AWS_SECRET matches are only included when they appear near context keywords
    to reduce false positives.
    """
    findings: list[PIIFinding] = []
    for pii_type, pattern in PII_PATTERNS.items():
        for match in re.finditer(pattern, text):
            # For AWS_SECRET, require nearby context keywords to avoid false positives
            if pii_type == "AWS_SECRET":
                window_start = max(0, match.start() - 50)
                window_end = min(len(text), match.end() + 50)
                window = text[window_start:window_end]
                if not _AWS_SECRET_CONTEXT_KEYWORDS.search(window):
                    continue

            findings.append(
                PIIFinding(
                    pii_type=pii_type,
                    start=match.start(),
                    end=match.end(),
                    original=match.group(),
                )
            )

    if findings:
        logger.warning(
            "pii_detected",
            extra={
                "extra_data": {
                    "finding_count": len(findings),
                    "types": list({f.pii_type for f in findings}),
                }
            },
        )
    return findings


def redact_text(text: str) -> str:
    """Replace all PII occurrences with type-tagged redaction markers.

    Example: '123-45-6789' -> '[REDACTED_SSN]'
    """
    findings = scan_text(text)
    if not findings:
        return text

    # Sort by position descending so earlier indices remain valid after replacement
    findings.sort(key=lambda f: f.start, reverse=True)

    result = text
    for finding in findings:
        replacement = f"[REDACTED_{finding.pii_type}]"
        result = result[: finding.start] + replacement + result[finding.end :]

    logger.info(
        "pii_redacted",
        extra={"extra_data": {"redaction_count": len(findings)}},
    )
    return result


def has_pii(text: str) -> bool:
    """Quick check whether the text contains any PII."""
    return len(scan_text(text)) > 0

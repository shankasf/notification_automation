"""Upload file validation -- extension allowlist, size limits, magic byte checks.

Provides a security gate for user-uploaded files before they enter the AI
pipeline. Prevents processing of disallowed file types (e.g., executables),
oversized files (>10 MB), and files whose binary headers don't match their
claimed extension (e.g., a .exe renamed to .xlsx). Also integrates with the
PII scanner to flag sensitive data in file content.
"""

from logging_config import get_logger
from guardrails.pii_scanner import scan_text, PIIFinding

logger = get_logger("guardrails.file")

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".txt"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# Magic bytes (file signatures) used to verify that binary content matches
# the claimed extension. CSV/TXT are excluded because they have no reliable
# magic bytes.
MAGIC_BYTES: dict[bytes, list[str]] = {
    b"PK": [".xlsx", ".xls"],  # ZIP-based (XLSX)
    b"\xd0\xcf\x11\xe0": [".xls"],  # OLE2 (old Excel)
    b"{": [".json"],  # JSON starts with {
    b"[": [".json"],  # JSON array
}


def _get_extension(filename: str) -> str:
    """Extract the lowercased file extension from a filename."""
    dot_index = filename.rfind(".")
    if dot_index == -1:
        return ""
    return filename[dot_index:].lower()


def validate_upload(content: bytes, filename: str) -> tuple[bool, str]:
    """Validate an uploaded file against security policies.

    Checks:
    1. File extension is in the allowlist
    2. File size is within limits
    3. Magic bytes match the claimed extension (when detectable)

    Returns:
        (is_valid, reason) — is_valid is False if the file should be rejected.
    """
    # 1. Extension check
    ext = _get_extension(filename)
    if not ext:
        logger.warning(
            "upload_rejected_no_extension",
            extra={"extra_data": {"filename": filename}},
        )
        return False, f"File has no extension. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"

    if ext not in ALLOWED_EXTENSIONS:
        logger.warning(
            "upload_rejected_extension",
            extra={"extra_data": {"filename": filename, "extension": ext}},
        )
        return False, f"File extension '{ext}' not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"

    # 2. Size check
    if len(content) > MAX_FILE_SIZE:
        size_mb = round(len(content) / (1024 * 1024), 1)
        logger.warning(
            "upload_rejected_size",
            extra={
                "extra_data": {
                    "filename": filename,
                    "size_bytes": len(content),
                    "max_bytes": MAX_FILE_SIZE,
                }
            },
        )
        return False, f"File too large ({size_mb}MB). Maximum allowed: {MAX_FILE_SIZE // (1024 * 1024)}MB"

    # 3. Magic bytes check (for binary formats)
    if content and ext in (".xlsx", ".xls", ".json"):
        magic_ok = False
        for magic, allowed_exts in MAGIC_BYTES.items():
            if content[:len(magic)] == magic and ext in allowed_exts:
                magic_ok = True
                break

        # For CSV/TXT, magic bytes aren't reliable — skip check
        # For JSON/XLSX/XLS, the file should match at least one magic pattern
        if not magic_ok:
            # Special case: .json files that don't start with { or [ might still be valid
            # (e.g., a number or string literal), but we'll be strict here
            logger.warning(
                "upload_rejected_magic_bytes",
                extra={
                    "extra_data": {
                        "filename": filename,
                        "extension": ext,
                        "first_bytes": content[:4].hex() if content else "empty",
                    }
                },
            )
            return False, f"File content does not match expected format for '{ext}'"

    logger.info(
        "upload_validated",
        extra={
            "extra_data": {
                "filename": filename,
                "extension": ext,
                "size_bytes": len(content),
            }
        },
    )
    return True, "OK"


def scan_file_pii(content: str) -> list[PIIFinding]:
    """Scan file text content for PII using the PII scanner.

    Returns a list of PIIFinding objects if PII is detected.
    """
    if not content:
        return []

    findings = scan_text(content)

    if findings:
        logger.warning(
            "pii_in_file_content",
            extra={
                "extra_data": {
                    "finding_count": len(findings),
                    "types": list({f.pii_type for f in findings}),
                }
            },
        )

    return findings

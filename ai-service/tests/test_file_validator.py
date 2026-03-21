"""Tests for the file upload validator (3 test cases)."""

from guardrails.file_validator import validate_upload, ALLOWED_EXTENSIONS, MAX_FILE_SIZE


# ── Test 29: rejects disallowed file extension ───────────────────────────
def test_rejects_disallowed_extension():
    is_valid, reason = validate_upload(b"MZ\x90\x00", "malware.exe")
    assert is_valid is False
    assert ".exe" in reason


# ── Test 30: accepts valid CSV file ──────────────────────────────────────
def test_accepts_csv_file():
    csv_content = b"name,role,rate\nJohn,Engineer,125.00\n"
    is_valid, reason = validate_upload(csv_content, "hiring_data.csv")
    assert is_valid is True
    assert reason == "OK"


# ── Test 31: rejects oversized file ──────────────────────────────────────
def test_rejects_oversized_file():
    big_content = b"x" * (MAX_FILE_SIZE + 1)
    is_valid, reason = validate_upload(big_content, "huge_data.csv")
    assert is_valid is False
    assert "too large" in reason.lower()

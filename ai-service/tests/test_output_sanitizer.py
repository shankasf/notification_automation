"""Tests for the output sanitizer guardrail (2 test cases)."""

from guardrails.output_sanitizer import sanitize_llm_output, hash_response


# ── Test 26: sanitize removes script tags from LLM output ────────────────
def test_sanitize_removes_script_tags():
    malicious = 'Here is the data: <script>alert("xss")</script> End.'
    result = sanitize_llm_output(malicious)
    assert "<script>" not in result
    assert "alert" not in result
    assert "End." in result


# ── Test 27: sanitize removes SQL injection patterns ─────────────────────
def test_sanitize_removes_sql_injection():
    malicious = "Results: DROP TABLE Requisition; -- done"
    result = sanitize_llm_output(malicious)
    assert "DROP TABLE" not in result
    assert "[FILTERED]" in result


# ── Test 28: hash_response produces consistent SHA-256 ───────────────────
def test_hash_response_deterministic():
    text = "Budget overview for engineering"
    h1 = hash_response(text)
    h2 = hash_response(text)
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex digest length

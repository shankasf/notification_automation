"""Tests for the PII scanner guardrail (3 test cases)."""

from guardrails.pii_scanner import scan_text, redact_text, has_pii


# ── Test 15: scan_text detects SSN pattern ───────────────────────────────
def test_scan_detects_ssn():
    text = "Employee SSN is 123-45-6789 on file"
    findings = scan_text(text)
    ssn_findings = [f for f in findings if f.pii_type == "SSN"]
    assert len(ssn_findings) == 1
    assert ssn_findings[0].original == "123-45-6789"


# ── Test 16: scan_text detects credit card pattern ───────────────────────
def test_scan_detects_credit_card():
    text = "Payment card: 4111-1111-1111-1111"
    findings = scan_text(text)
    cc_findings = [f for f in findings if f.pii_type == "CREDIT_CARD"]
    assert len(cc_findings) == 1
    assert "4111" in cc_findings[0].original


# ── Test 17: redact_text replaces PII with tagged markers ────────────────
def test_redact_replaces_ssn_with_marker():
    text = "SSN: 123-45-6789"
    result = redact_text(text)
    assert "123-45-6789" not in result
    assert "[REDACTED_SSN]" in result


# ── Test 18: has_pii returns False for clean text ────────────────────────
def test_no_pii_in_clean_text():
    assert has_pii("This is a clean hiring request for 5 engineers") is False


# ── Test 19: scan_text detects email addresses ──────────────────────────
def test_scan_detects_email():
    text = "Contact manager at sarah.chen@meta.com for details"
    findings = scan_text(text)
    email_findings = [f for f in findings if f.pii_type == "EMAIL"]
    assert len(email_findings) == 1
    assert email_findings[0].original == "sarah.chen@meta.com"

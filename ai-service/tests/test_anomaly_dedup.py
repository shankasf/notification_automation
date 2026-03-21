"""Tests for anomaly deduplication (1 test case)."""

from anomaly_dedup import compute_fingerprint


# ── Test 32: fingerprint is deterministic for same inputs ────────────────
def test_fingerprint_deterministic():
    fp1 = compute_fingerprint("RATE_SPIKE", "REQ-ENG-042", "ENGINEERING_CONTRACTORS")
    fp2 = compute_fingerprint("RATE_SPIKE", "REQ-ENG-042", "ENGINEERING_CONTRACTORS")
    assert fp1 == fp2
    assert len(fp1) == 64  # SHA-256 hex

    # Different inputs produce different fingerprints
    fp3 = compute_fingerprint("BUDGET_OVERRUN", "REQ-ENG-042", "ENGINEERING_CONTRACTORS")
    assert fp3 != fp1

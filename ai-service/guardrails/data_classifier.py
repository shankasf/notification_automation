"""Data tier enforcement — filters records before they reach the LLM.

Loads classification rules from the DataClassification table and strips
or anonymizes fields based on their tier:

- TIER1_NEVER_LLM: Field is removed entirely
- TIER2_ANONYMIZE: Field value is replaced with an anonymized version
- TIER3_SAFE: Field passes through unchanged (default)
"""

import os
import psycopg2
import threading
import time

from logging_config import get_logger

logger = get_logger("guardrails.classifier")


class DataClassifier:
    def __init__(self):
        self._rules: dict[tuple[str, str], str] = {}  # (table, field) -> tier
        self._lock = threading.Lock()
        self._last_refresh: float = 0
        self._refresh_interval: int = 300  # 5 minutes

    def _load_rules(self):
        """Load classification rules from the DataClassification database table."""
        try:
            conn = psycopg2.connect(os.environ["DATABASE_URL"])
            cur = conn.cursor()
            cur.execute(
                'SELECT "tableName", "fieldName", tier FROM "DataClassification"'
            )
            rows = cur.fetchall()
            conn.close()

            new_rules: dict[tuple[str, str], str] = {}
            for table_name, field_name, tier in rows:
                new_rules[(table_name, field_name)] = tier

            with self._lock:
                self._rules = new_rules
                self._last_refresh = time.time()

            logger.info(
                "classification_rules_loaded",
                extra={"extra_data": {"rule_count": len(new_rules)}},
            )
        except Exception as e:
            logger.error(
                "classification_rules_load_failed",
                extra={"extra_data": {"error": str(e)}},
            )
            # Keep using existing rules if refresh fails
            with self._lock:
                self._last_refresh = time.time()

    def _ensure_fresh(self):
        """Refresh rules if stale (older than refresh_interval)."""
        if time.time() - self._last_refresh > self._refresh_interval:
            self._load_rules()

    def filter_for_llm(
        self, records: list[dict], table_name: str = "Requisition"
    ) -> list[dict]:
        """Filter a list of record dicts based on data classification tiers.

        - TIER1_NEVER_LLM: Strip field entirely
        - TIER2_ANONYMIZE: Replace with anonymized version
        - TIER3_SAFE: Pass through unchanged (default for unknown fields)
        """
        self._ensure_fresh()

        filtered = []
        stripped_fields: set[str] = set()
        anonymized_fields: set[str] = set()

        for record in records:
            clean: dict = {}
            for field, value in record.items():
                with self._lock:
                    tier = self._rules.get((table_name, field), "TIER3_SAFE")

                if tier == "TIER1_NEVER_LLM":
                    stripped_fields.add(field)
                    continue  # strip entirely
                elif tier == "TIER2_ANONYMIZE":
                    clean[field] = self._anonymize(field, value)
                    anonymized_fields.add(field)
                else:
                    clean[field] = value
            filtered.append(clean)

        if stripped_fields or anonymized_fields:
            logger.info(
                "data_filtered_for_llm",
                extra={
                    "extra_data": {
                        "table": table_name,
                        "record_count": len(records),
                        "stripped_fields": list(stripped_fields),
                        "anonymized_fields": list(anonymized_fields),
                    }
                },
            )

        return filtered

    def _anonymize(self, field: str, value) -> str:
        """Anonymize a value based on field type/name."""
        if value is None:
            return "[ANONYMIZED]"

        if field in ("headcountNeeded", "headcountFilled"):
            # Convert to range: 5 -> "1-10", 15 -> "10-20"
            if isinstance(value, (int, float)):
                n = int(value)
                low = (n // 10) * 10
                return f"{low}-{low + 10}"

        if field in ("budgetAllocated", "budgetSpent", "billRate", "avgRate", "totalSpend"):
            # Convert dollar amounts to order-of-magnitude ranges
            if isinstance(value, (int, float)):
                v = float(value)
                if v < 100:
                    return "$0-$100"
                elif v < 1000:
                    return "$100-$1K"
                elif v < 10000:
                    return "$1K-$10K"
                elif v < 100000:
                    return "$10K-$100K"
                else:
                    return "$100K+"

        return "[ANONYMIZED]"


# Module-level singleton
classifier = DataClassifier()

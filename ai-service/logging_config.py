"""Structured JSON logging configuration for the MetaSource AI Service.

All application logs are emitted as single-line JSON objects to stdout,
making them easy to parse by log aggregators (CloudWatch, Datadog, ELK).
Each log entry includes timestamp, level, logger name, source location,
and an optional `data` dict for structured extra fields.

Usage:
    from logging_config import setup_logging, get_logger
    setup_logging("INFO")
    logger = get_logger("my_module")
    logger.info("event_name", extra={"extra_data": {"key": "value"}})
"""

import logging
import json
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """JSON log formatter for structured, machine-parseable logs.

    Produces one JSON object per log line. The `extra_data` convention is used
    throughout the codebase via `extra={"extra_data": {...}}` to attach
    structured fields without colliding with LogRecord's built-in attributes.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        # Merge caller-provided structured data under the "data" key
        if hasattr(record, "extra_data"):
            log_entry["data"] = record.extra_data
        # Attach exception info when logging with exc_info=True
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
            }
        return json.dumps(log_entry)


def setup_logging(level: str = "INFO") -> None:
    """Configure structured JSON logging for the entire application."""
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Remove existing handlers to avoid duplicates on reload
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root.addHandler(handler)

    # Suppress noisy third-party loggers that clutter output at INFO level
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Get a named logger prefixed with 'metasource.' for easy filtering."""
    return logging.getLogger(f"metasource.{name}")

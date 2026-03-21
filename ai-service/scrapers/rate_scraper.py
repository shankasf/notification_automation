"""Market rate scraper entry point.

In production this would call external salary APIs (Glassdoor, LinkedIn,
Levels.fyi, etc.) to collect current contractor market rates by role and
location. Since those APIs require authentication and rate-limit management,
this module currently delegates to the data_generator which produces realistic
synthetic data that is structurally identical to real scraped results.

Called by the /api/ai/scrape endpoint.
"""

import time

from logging_config import get_logger
from scrapers.data_generator import generate_market_rates

logger = get_logger("scraper")


async def scrape_market_rates():
    """Attempt to scrape market rates from public sources. Falls back to generated data.

    For demo purposes, we use the data generator which produces realistic market data.
    Real scraping would hit APIs like Glassdoor, LinkedIn, etc. which require auth.
    """
    logger.info("scrape_market_rates_started")
    start = time.time()
    result = generate_market_rates()
    duration_ms = round((time.time() - start) * 1000, 2)
    logger.info(
        "scrape_market_rates_completed",
        extra={
            "extra_data": {
                "roles_scraped": result["roles_scraped"],
                "duration_ms": duration_ms,
                "status": result["status"],
            }
        },
    )
    return result

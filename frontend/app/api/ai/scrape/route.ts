/**
 * POST /api/ai/scrape — triggers the AI-powered market rate scraping service.
 *
 * Proxies the request to the external AI service which collects current market
 * bill rates from various sources (Glassdoor, LinkedIn Salary, etc.) and stores
 * them in the MarketRate table for comparison against internal rates.
 *
 * Returns 502 if the scrape service is unavailable.
 */
import { NextResponse } from "next/server";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

export async function POST() {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Scrape service unavailable" },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error calling scrape service:", error);
    return NextResponse.json(
      { error: "Scrape service unavailable" },
      { status: 502 }
    );
  }
}

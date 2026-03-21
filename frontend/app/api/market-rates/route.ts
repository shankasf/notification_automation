/**
 * GET /api/market-rates — returns market rate benchmarks, internal rate averages,
 * and scrape log history for the Market Rates page.
 *
 * Optionally filtered by category. Internal rates are computed by grouping
 * requisitions by role title + category and averaging their bill rates, which
 * allows side-by-side comparison with external market data.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RequisitionCategory } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as RequisitionCategory | null;

    const where = category ? { category } : {};

    const [marketRates, scrapeLogs] = await Promise.all([
      prisma.marketRate.findMany({
        where,
        orderBy: [{ category: "asc" }, { roleTitle: "asc" }],
      }),
      prisma.scrapeLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    // Get internal rates for comparison
    const internalRates = await prisma.requisition.groupBy({
      by: ["roleTitle", "category"],
      where,
      _avg: { billRateHourly: true },
      _min: { billRateHourly: true },
      _max: { billRateHourly: true },
      _count: { id: true },
    });

    return NextResponse.json({
      marketRates,
      internalRates,
      scrapeLogs,
    });
  } catch (error) {
    console.error("Error fetching market rates:", error);
    return NextResponse.json(
      { error: "Failed to fetch market rates" },
      { status: 500 }
    );
  }
}

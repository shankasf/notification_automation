/**
 * GET /api/changes — returns a paginated, filterable list of requisition change records.
 *
 * Supports filtering by:
 *  - requisitionId: changes for a specific requisition
 *  - changeType: CREATED, UPDATED, STATUS_CHANGE, RATE_CHANGE, etc.
 *  - managerId: scoped to the manager's category
 *  - dateFrom/dateTo: date range filter
 *
 * Each change record includes the related requisition's ID, role title, and category.
 * Results are sorted by createdAt desc by default.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, ChangeType } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");
    const requisitionId = searchParams.get("requisitionId");
    const changeType = searchParams.get("changeType") as ChangeType | null;
    const managerId = searchParams.get("managerId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as Prisma.SortOrder;

    const where: Prisma.RequisitionChangeWhereInput = {};

    if (requisitionId) where.requisitionId = requisitionId;
    if (changeType) where.changeType = changeType;

    if (managerId) {
      const manager = await prisma.sourcingManager.findUnique({
        where: { id: managerId },
        select: { category: true },
      });
      if (manager) {
        where.requisition = { category: manager.category };
      }
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [changes, total] = await Promise.all([
      prisma.requisitionChange.findMany({
        where,
        include: {
          requisition: {
            select: {
              requisitionId: true,
              roleTitle: true,
              category: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.requisitionChange.count({ where }),
    ]);

    return NextResponse.json({
      changes,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Error fetching changes:", error);
    return NextResponse.json(
      { error: "Failed to fetch changes" },
      { status: 500 }
    );
  }
}

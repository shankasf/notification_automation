import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { Prisma, RequisitionCategory, RequisitionStatus, Priority } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");
    const category = searchParams.get("category") as RequisitionCategory | null;
    const status = searchParams.get("status") as RequisitionStatus | null;
    const priority = searchParams.get("priority") as Priority | null;
    const search = searchParams.get("search");
    const managerId = searchParams.get("managerId");
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as Prisma.SortOrder;

    const where: Prisma.RequisitionWhereInput = {};

    if (category) where.category = category;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    if (managerId) {
      const manager = await prisma.sourcingManager.findUnique({
        where: { id: managerId },
        select: { category: true },
      });
      if (manager) where.category = manager.category;
    }

    if (search) {
      where.OR = [
        { requisitionId: { contains: search, mode: "insensitive" } },
        { roleTitle: { contains: search, mode: "insensitive" } },
        { vendor: { contains: search, mode: "insensitive" } },
        { team: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    const [requisitions, total] = await Promise.all([
      prisma.requisition.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.requisition.count({ where }),
    ]);

    return NextResponse.json({
      requisitions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Error fetching requisitions:", error);
    return NextResponse.json(
      { error: "Failed to fetch requisitions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const changedBy = session?.user?.email || "system";

    const body = await request.json();

    // Auto-generate requisitionId using the category short name (e.g. REQ-ENG-001)
    const categoryShortName: Record<string, string> = {
      ENGINEERING_CONTRACTORS: "ENG",
      CONTENT_TRUST_SAFETY: "CTS",
      DATA_OPERATIONS: "DOP",
      MARKETING_CREATIVE: "MKT",
      CORPORATE_SERVICES: "COR",
    };

    const shortName = categoryShortName[body.category] || "GEN";
    const lastReq = await prisma.requisition.findFirst({
      where: { requisitionId: { startsWith: `REQ-${shortName}-` } },
      orderBy: { requisitionId: "desc" },
    });

    let nextNum = 1;
    if (lastReq) {
      const match = lastReq.requisitionId.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1]) + 1;
    }

    const requisitionId = `REQ-${shortName}-${String(nextNum).padStart(3, "0")}`;

    const budgetAllocated = body.billRateHourly * body.headcountNeeded * 2080;

    const requisition = await prisma.requisition.create({
      data: {
        requisitionId,
        team: body.team,
        department: body.department,
        roleTitle: body.roleTitle,
        category: body.category,
        headcountNeeded: body.headcountNeeded,
        headcountFilled: body.headcountFilled || 0,
        vendor: body.vendor,
        billRateHourly: body.billRateHourly,
        location: body.location,
        status: body.status || "OPEN",
        priority: body.priority || "MEDIUM",
        budgetAllocated,
        budgetSpent: 0,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        notes: body.notes,
      },
    });

    // Create CREATED change record
    await prisma.requisitionChange.create({
      data: {
        requisitionId: requisition.id,
        changeType: "CREATED",
        summary: `New requisition ${requisitionId} created for ${body.roleTitle} role`,
        changedBy,
      },
    });

    return NextResponse.json(requisition, { status: 201 });
  } catch (error) {
    console.error("Error creating requisition:", error);
    return NextResponse.json(
      { error: "Failed to create requisition" },
      { status: 500 }
    );
  }
}

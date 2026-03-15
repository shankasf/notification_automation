import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, NotificationType } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const managerId = searchParams.get("managerId");
    const type = searchParams.get("type") as NotificationType | null;
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const where: Prisma.NotificationWhereInput = {};

    if (managerId) where.managerId = managerId;
    if (type) where.type = type;
    if (unreadOnly) where.isRead = false;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: {
          manager: {
            select: { name: true, category: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where }),
    ]);

    return NextResponse.json({
      notifications,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, markAll, managerId } = body;

    if (markAll && managerId) {
      await prisma.notification.updateMany({
        where: { managerId, isRead: false },
        data: { isRead: true },
      });
    } else if (markAll) {
      await prisma.notification.updateMany({
        where: { isRead: false },
        data: { isRead: true },
      });
    } else if (ids && Array.isArray(ids)) {
      await prisma.notification.updateMany({
        where: { id: { in: ids } },
        data: { isRead: true },
      });
    } else {
      return NextResponse.json(
        { error: "Provide ids array or markAll flag" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating notifications:", error);
    return NextResponse.json(
      { error: "Failed to update notifications" },
      { status: 500 }
    );
  }
}

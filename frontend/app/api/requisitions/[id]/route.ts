import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ChangeType } from "@prisma/client";
import { publishChangeNotification } from "@/lib/sns";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requisition = await prisma.requisition.findUnique({
      where: { id },
      include: {
        changes: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!requisition) {
      return NextResponse.json(
        { error: "Requisition not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(requisition);
  } catch (error) {
    console.error("Error fetching requisition:", error);
    return NextResponse.json(
      { error: "Failed to fetch requisition" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.requisition.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Requisition not found" },
        { status: 404 }
      );
    }

    // Track changes
    const changeRecords: {
      changeType: ChangeType;
      fieldChanged: string;
      oldValue: string;
      newValue: string;
      summary: string;
    }[] = [];

    const trackableFields: Record<string, { changeType: ChangeType; label: string }> = {
      status: { changeType: "STATUS_CHANGE", label: "status" },
      billRateHourly: { changeType: "RATE_CHANGE", label: "bill rate" },
      headcountNeeded: { changeType: "HEADCOUNT_CHANGE", label: "headcount needed" },
      headcountFilled: { changeType: "HEADCOUNT_CHANGE", label: "headcount filled" },
      budgetAllocated: { changeType: "BUDGET_CHANGE", label: "budget allocated" },
      priority: { changeType: "UPDATED", label: "priority" },
      vendor: { changeType: "UPDATED", label: "vendor" },
      location: { changeType: "UPDATED", label: "location" },
      team: { changeType: "UPDATED", label: "team" },
    };

    for (const [field, config] of Object.entries(trackableFields)) {
      if (body[field] !== undefined) {
        const oldVal = String((existing as Record<string, unknown>)[field] ?? "");
        const newVal = String(body[field]);
        if (oldVal !== newVal) {
          changeRecords.push({
            changeType: config.changeType,
            fieldChanged: field,
            oldValue: oldVal,
            newValue: newVal,
            summary: `${existing.requisitionId}: ${config.label} changed from ${oldVal} to ${newVal}`,
          });
        }
      }
    }

    // Recalculate budget if rate or headcount changed
    if (body.billRateHourly !== undefined || body.headcountNeeded !== undefined) {
      const rate = body.billRateHourly ?? existing.billRateHourly;
      const hc = body.headcountNeeded ?? existing.headcountNeeded;
      body.budgetAllocated = rate * hc * 2080;
    }

    const updated = await prisma.requisition.update({
      where: { id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.priority && { priority: body.priority }),
        ...(body.billRateHourly !== undefined && { billRateHourly: body.billRateHourly }),
        ...(body.headcountNeeded !== undefined && { headcountNeeded: body.headcountNeeded }),
        ...(body.headcountFilled !== undefined && { headcountFilled: body.headcountFilled }),
        ...(body.vendor && { vendor: body.vendor }),
        ...(body.location && { location: body.location }),
        ...(body.team && { team: body.team }),
        ...(body.department && { department: body.department }),
        ...(body.roleTitle && { roleTitle: body.roleTitle }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.budgetAllocated !== undefined && { budgetAllocated: body.budgetAllocated }),
        ...(body.startDate && { startDate: new Date(body.startDate) }),
        ...(body.endDate && { endDate: new Date(body.endDate) }),
      },
    });

    // Create change records
    if (changeRecords.length > 0) {
      await prisma.requisitionChange.createMany({
        data: changeRecords.map((c) => ({
          requisitionId: id,
          changeType: c.changeType,
          fieldChanged: c.fieldChanged,
          oldValue: c.oldValue,
          newValue: c.newValue,
          summary: c.summary,
          changedBy: "admin",
        })),
      });

      // Create notification for affected manager
      const manager = await prisma.sourcingManager.findFirst({
        where: { category: existing.category },
      });

      if (manager) {
        const summaryText = changeRecords.map((c) => c.summary).join(". ");
        await prisma.notification.create({
          data: {
            managerId: manager.id,
            type: "CHANGE_SUMMARY",
            title: `${existing.requisitionId} Updated`,
            message: summaryText,
          },
        });
      }

      // Publish SNS notification for each change batch
      publishChangeNotification({
        type: "UPDATED",
        requisitionId: existing.requisitionId,
        roleTitle: updated.roleTitle,
        category: existing.category,
        changes: changeRecords.map((c) => ({
          field: c.fieldChanged,
          oldValue: c.oldValue,
          newValue: c.newValue,
        })),
        summary: changeRecords.map((c) => c.summary).join(". "),
        changedBy: "admin",
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating requisition:", error);
    return NextResponse.json(
      { error: "Failed to update requisition" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await prisma.requisition.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Requisition not found" },
        { status: 404 }
      );
    }

    await prisma.requisition.delete({ where: { id } });

    // Publish SNS notification for deletion
    publishChangeNotification({
      type: "DELETED",
      requisitionId: existing.requisitionId,
      roleTitle: existing.roleTitle,
      category: existing.category,
      summary: `Requisition ${existing.requisitionId} (${existing.roleTitle}) has been deleted`,
      changedBy: "admin",
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting requisition:", error);
    return NextResponse.json(
      { error: "Failed to delete requisition" },
      { status: 500 }
    );
  }
}

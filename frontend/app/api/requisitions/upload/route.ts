import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";

const CATEGORY_MAP: Record<string, string> = {
  engineering: "ENGINEERING_CONTRACTORS",
  "engineering contractors": "ENGINEERING_CONTRACTORS",
  eng: "ENGINEERING_CONTRACTORS",
  "content": "CONTENT_TRUST_SAFETY",
  "content & trust safety": "CONTENT_TRUST_SAFETY",
  "trust safety": "CONTENT_TRUST_SAFETY",
  cts: "CONTENT_TRUST_SAFETY",
  "data": "DATA_OPERATIONS",
  "data operations": "DATA_OPERATIONS",
  "data ops": "DATA_OPERATIONS",
  dop: "DATA_OPERATIONS",
  marketing: "MARKETING_CREATIVE",
  "marketing & creative": "MARKETING_CREATIVE",
  "marketing creative": "MARKETING_CREATIVE",
  mkt: "MARKETING_CREATIVE",
  corporate: "CORPORATE_SERVICES",
  "corporate services": "CORPORATE_SERVICES",
  cor: "CORPORATE_SERVICES",
};

/** Short names used in request IDs (e.g. REQ-ENG-001) */
const CATEGORY_SHORT_NAME: Record<string, string> = {
  ENGINEERING_CONTRACTORS: "ENG",
  CONTENT_TRUST_SAFETY: "CTS",
  DATA_OPERATIONS: "DOP",
  MARKETING_CREATIVE: "MKT",
  CORPORATE_SERVICES: "COR",
};

const COLUMN_ALIASES: Record<string, string> = {
  "role": "roleTitle",
  "role_title": "roleTitle",
  "roletitle": "roleTitle",
  "role title": "roleTitle",
  "title": "roleTitle",
  "job title": "roleTitle",
  "category": "category",
  "team": "team",
  "department": "department",
  "dept": "department",
  "vendor": "vendor",
  "supplier": "vendor",
  "location": "location",
  "loc": "location",
  "bill_rate": "billRateHourly",
  "billrate": "billRateHourly",
  "bill rate": "billRateHourly",
  "rate": "billRateHourly",
  "hourly_rate": "billRateHourly",
  "headcount": "headcountNeeded",
  "headcount_needed": "headcountNeeded",
  "hc": "headcountNeeded",
  "positions": "headcountNeeded",
  "status": "status",
  "priority": "priority",
  "start_date": "startDate",
  "startdate": "startDate",
  "start date": "startDate",
  "end_date": "endDate",
  "enddate": "endDate",
  "end date": "endDate",
  "notes": "notes",
  "requisition_id": "requisitionId",
  "req_id": "requisitionId",
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => {
        const normalized = header.trim().toLowerCase();
        return COLUMN_ALIASES[normalized] || normalized;
      },
    });

    if (parsed.errors.length > 0) {
      return NextResponse.json(
        { error: "CSV parsing errors", details: parsed.errors },
        { status: 400 }
      );
    }

    const rows = parsed.data as Record<string, string>[];
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Resolve category
        const rawCategory = (row.category || "").trim().toLowerCase();
        const category = CATEGORY_MAP[rawCategory] || rawCategory.toUpperCase();

        if (!CATEGORY_SHORT_NAME[category]) {
          errors.push(`Row ${i + 1}: Invalid category "${row.category}"`);
          continue;
        }

        const billRate = parseFloat(row.billRateHourly || "0");
        const headcount = parseInt(row.headcountNeeded || "1");

        if (!row.roleTitle) {
          errors.push(`Row ${i + 1}: Missing role title`);
          continue;
        }

        // Check if requisitionId exists for update
        if (row.requisitionId) {
          const existing = await prisma.requisition.findUnique({
            where: { requisitionId: row.requisitionId },
          });

          if (existing) {
            await prisma.requisition.update({
              where: { requisitionId: row.requisitionId },
              data: {
                roleTitle: row.roleTitle || existing.roleTitle,
                team: row.team || existing.team,
                department: row.department || existing.department,
                vendor: row.vendor || existing.vendor,
                location: row.location || existing.location,
                ...(billRate > 0 && { billRateHourly: billRate }),
                ...(headcount > 0 && { headcountNeeded: headcount }),
                ...(row.status && { status: row.status.toUpperCase() as never }),
                ...(row.priority && { priority: row.priority.toUpperCase() as never }),
              },
            });

            await prisma.requisitionChange.create({
              data: {
                requisitionId: existing.id,
                changeType: "BULK_IMPORT",
                summary: `Updated via CSV import`,
                changedBy: "csv_import",
              },
            });

            updated++;
            continue;
          }
        }

        // Generate new requisitionId (e.g. REQ-ENG-001)
        const shortName = CATEGORY_SHORT_NAME[category];
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
        const budgetAllocated = billRate * headcount * 2080;

        const req = await prisma.requisition.create({
          data: {
            requisitionId,
            roleTitle: row.roleTitle,
            team: row.team || "Unassigned",
            department: row.department || "General",
            category: category as never,
            headcountNeeded: headcount,
            vendor: row.vendor || "TBD",
            billRateHourly: billRate,
            location: row.location || "Remote",
            status: (row.status?.toUpperCase() as never) || "OPEN",
            priority: (row.priority?.toUpperCase() as never) || "MEDIUM",
            budgetAllocated,
            startDate: row.startDate ? new Date(row.startDate) : null,
            endDate: row.endDate ? new Date(row.endDate) : null,
            notes: row.notes || null,
          },
        });

        await prisma.requisitionChange.create({
          data: {
            requisitionId: req.id,
            changeType: "BULK_IMPORT",
            summary: `Created via CSV import: ${requisitionId} - ${row.roleTitle}`,
            changedBy: "csv_import",
          },
        });

        created++;
      } catch (err) {
        errors.push(`Row ${i + 1}: ${(err as Error).message}`);
      }
    }

    // Create notifications only for managers whose categories were affected
    const affectedCategories = [...new Set(
      rows
        .map((row) => {
          const rawCategory = (row.category || "").trim().toLowerCase();
          return CATEGORY_MAP[rawCategory] || rawCategory.toUpperCase();
        })
        .filter((cat) => CATEGORY_SHORT_NAME[cat])
    )];
    const affectedManagers = await prisma.sourcingManager.findMany({
      where: { category: { in: affectedCategories as never[] } },
    });
    for (const manager of affectedManagers) {
      await prisma.notification.create({
        data: {
          managerId: manager.id,
          type: "CHANGE_SUMMARY",
          title: "CSV Import Complete",
          message: `Bulk import processed: ${created} created, ${updated} updated, ${errors.length} errors`,
        },
      });
    }

    return NextResponse.json({
      created,
      updated,
      errors,
      total: rows.length,
    });
  } catch (error) {
    console.error("Error processing CSV upload:", error);
    return NextResponse.json(
      { error: "Failed to process CSV upload" },
      { status: 500 }
    );
  }
}

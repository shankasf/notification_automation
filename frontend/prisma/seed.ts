import {
  PrismaClient,
  RequisitionCategory,
  RequisitionStatus,
  Priority,
  ChangeType,
  NotificationType,
} from "@prisma/client";

const prisma = new PrismaClient();

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomDate(daysBack: number, daysForward: number = 0): Date {
  const now = Date.now();
  const min = now - daysBack * 86400000;
  const max = now + daysForward * 86400000;
  return new Date(min + Math.random() * (max - min));
}

const managers = [
  { name: "Sarah Chen", email: "sarah.chen@meta.com", category: RequisitionCategory.ENGINEERING_CONTRACTORS },
  { name: "Marcus Johnson", email: "marcus.johnson@meta.com", category: RequisitionCategory.CONTENT_TRUST_SAFETY },
  { name: "Priya Patel", email: "priya.patel@meta.com", category: RequisitionCategory.DATA_OPERATIONS },
  { name: "David Kim", email: "david.kim@meta.com", category: RequisitionCategory.MARKETING_CREATIVE },
  { name: "Lisa Martinez", email: "lisa.martinez@meta.com", category: RequisitionCategory.CORPORATE_SERVICES },
];

const locations = [
  "Menlo Park, CA",
  "Austin, TX",
  "New York, NY",
  "Seattle, WA",
  "Remote",
  "London, UK",
  "Singapore",
];

const statuses: RequisitionStatus[] = [
  RequisitionStatus.ACTIVE,
  RequisitionStatus.SOURCING,
  RequisitionStatus.OPEN,
  RequisitionStatus.INTERVIEWING,
  RequisitionStatus.ONBOARDING,
  RequisitionStatus.COMPLETED,
  RequisitionStatus.OFFER,
  RequisitionStatus.CANCELLED,
];
const statusWeights = [30, 20, 15, 15, 10, 5, 3, 2];

const priorities: Priority[] = [Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL, Priority.LOW];
const priorityWeights = [40, 30, 15, 15];

interface CategoryConfig {
  category: RequisitionCategory;
  /** 3-letter short name used in request IDs (e.g. REQ-ENG-001) */
  shortName: string;
  roles: string[];
  teams: string[];
  departments: string[];
  vendors: string[];
  rateMin: number;
  rateMax: number;
  count: number;
}

const categoryConfigs: CategoryConfig[] = [
  {
    category: RequisitionCategory.ENGINEERING_CONTRACTORS,
    shortName: "ENG",
    roles: [
      "ML Engineer", "AR/VR Developer", "iOS Developer", "DevOps Engineer",
      "Backend Engineer", "Frontend Engineer", "Data Engineer", "Security Engineer",
      "QA Automation Engineer", "Site Reliability Engineer",
    ],
    teams: ["AI Research", "Reality Labs", "Instagram Eng", "WhatsApp Eng", "Meta Platform"],
    departments: ["Engineering", "Research", "Infrastructure", "Product Engineering", "Platform"],
    vendors: ["Insight Global", "TEKsystems", "Robert Half", "Hays", "Randstad"],
    rateMin: 75,
    rateMax: 200,
    count: 200,
  },
  {
    category: RequisitionCategory.CONTENT_TRUST_SAFETY,
    shortName: "CTS",
    roles: [
      "Content Moderator", "T&S Analyst", "Policy Reviewer", "Content Classifier",
      "Appeals Specialist", "Community Standards Analyst", "Harm Prevention Specialist",
      "Counter-Terrorism Analyst", "CSAM Analyst", "Misinformation Reviewer",
    ],
    teams: ["Content Moderation", "Trust & Safety", "Policy", "Appeals", "Integrity"],
    departments: ["Trust & Safety", "Content Operations", "Policy", "Integrity", "Community"],
    vendors: ["Accenture", "Cognizant", "Genpact", "TaskUs", "Majorel"],
    rateMin: 25,
    rateMax: 55,
    count: 200,
  },
  {
    category: RequisitionCategory.DATA_OPERATIONS,
    shortName: "DOP",
    roles: [
      "Data Annotator", "Data Labeler", "QA Tester", "Data Quality Analyst",
      "Annotation Specialist", "Training Data Curator", "Ground Truth Analyst",
      "Data Pipeline Operator", "ML Data Specialist", "Corpus Manager",
    ],
    teams: ["AI Data Ops", "LLM Training", "Computer Vision", "NLP", "Responsible AI"],
    departments: ["Data Operations", "AI Training", "Machine Learning", "Research Data", "Applied AI"],
    vendors: ["Scale AI", "Appen", "Telus International", "CloudFactory", "Sama"],
    rateMin: 20,
    rateMax: 45,
    count: 200,
  },
  {
    category: RequisitionCategory.MARKETING_CREATIVE,
    shortName: "MKT",
    roles: [
      "Graphic Designer", "UX Designer", "Copywriter", "Campaign Manager",
      "Video Producer", "Motion Designer", "Brand Strategist", "Social Media Manager",
      "Creative Director", "Art Director",
    ],
    teams: ["Brand Marketing", "Product Marketing", "Creative", "Social", "Growth"],
    departments: ["Marketing", "Creative Services", "Brand", "Communications", "Growth"],
    vendors: ["Creative Circle", "Aquent", "24 Seven", "The Creative Group", "Vitamin T"],
    rateMin: 50,
    rateMax: 120,
    count: 200,
  },
  {
    category: RequisitionCategory.CORPORATE_SERVICES,
    shortName: "COR",
    roles: [
      "Executive Assistant", "Facilities Coordinator", "HR Operations", "Finance Analyst",
      "Legal Assistant", "Procurement Specialist", "Travel Coordinator", "Office Manager",
      "Benefits Administrator", "Payroll Specialist",
    ],
    teams: ["People Ops", "Finance", "Legal", "Facilities", "Procurement"],
    departments: ["Human Resources", "Finance & Accounting", "Legal", "Facilities", "Operations"],
    vendors: ["Adecco", "ManpowerGroup", "Kelly Services", "Spherion", "Express Employment"],
    rateMin: 35,
    rateMax: 85,
    count: 200,
  },
];

const changeTypeSummaries: Record<string, string[]> = {
  STATUS_CHANGE: [
    "Requisition status transitioned from {old} to {new} - workflow progressing normally",
    "Status updated to {new} (was {old}) - sourcing team aligned with timeline",
    "Moved to {new} stage. Previous status: {old}. On track for target fill date",
  ],
  RATE_CHANGE: [
    "Bill rate adjusted from ${old}/hr to ${new}/hr to align with market benchmarks",
    "Rate change from ${old} to ${new} per hour approved by procurement",
    "Competitive rate adjustment: ${old}/hr -> ${new}/hr based on vendor negotiation",
  ],
  HEADCOUNT_CHANGE: [
    "Headcount requirement updated from {old} to {new} based on team capacity planning",
    "Staffing need revised: {old} -> {new} positions per hiring manager request",
    "Headcount adjusted to {new} (from {old}) following scope reassessment",
  ],
  BUDGET_CHANGE: [
    "Budget allocation revised from ${old} to ${new} following quarterly review",
    "Budget updated: ${old} -> ${new} to accommodate rate and headcount changes",
    "Financial adjustment from ${old} to ${new} approved by finance team",
  ],
};

const notificationMessages = [
  { type: NotificationType.CHANGE_SUMMARY, title: "Daily Change Summary", message: "12 requisitions were updated today across your portfolio. 3 status changes, 2 rate adjustments, and 7 headcount updates." },
  { type: NotificationType.CHANGE_SUMMARY, title: "Weekly Digest", message: "This week: 45 changes across 28 requisitions. Notable: 5 new reqs opened, 3 moved to ACTIVE status." },
  { type: NotificationType.ANOMALY_ALERT, title: "Rate Anomaly Detected", message: "Bill rate for REQ-ENG-042 ($195/hr) exceeds the 90th percentile for ML Engineers in Menlo Park. Market median: $165/hr." },
  { type: NotificationType.ANOMALY_ALERT, title: "Unusual Activity", message: "15 requisitions were bulk-updated in the last hour. This is 3x the normal rate. Please verify changes." },
  { type: NotificationType.BUDGET_WARNING, title: "Budget Threshold Alert", message: "Engineering Contractors budget utilization has reached 85%. $2.4M remaining of $16M allocation." },
  { type: NotificationType.BUDGET_WARNING, title: "Overspend Warning", message: "Data Operations Q1 spending is 12% above forecast. Current run rate projects $850K overspend by quarter end." },
  { type: NotificationType.MILESTONE, title: "Headcount Milestone", message: "Content & Trust Safety has reached 90% fill rate across all active requisitions. 180 of 200 positions filled." },
  { type: NotificationType.MILESTONE, title: "Vendor Performance", message: "TEKsystems has filled 95% of assigned positions within SLA. Top performer for Engineering category this quarter." },
  { type: NotificationType.CHANGE_SUMMARY, title: "Bulk Import Complete", message: "CSV import processed successfully: 25 new requisitions created, 8 existing updated, 0 errors." },
  { type: NotificationType.ANOMALY_ALERT, title: "Vendor Rate Discrepancy", message: "Cognizant submitted rates 18% above contract terms for 3 Content Moderator positions. Review required." },
];

const marketRateData = [
  { roleTitle: "ML Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Menlo Park, CA", minRate: 120, maxRate: 220, medianRate: 165 },
  { roleTitle: "ML Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Austin, TX", minRate: 100, maxRate: 185, medianRate: 140 },
  { roleTitle: "ML Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Remote", minRate: 95, maxRate: 190, medianRate: 145 },
  { roleTitle: "Backend Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Menlo Park, CA", minRate: 90, maxRate: 180, medianRate: 135 },
  { roleTitle: "Backend Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "New York, NY", minRate: 95, maxRate: 185, medianRate: 140 },
  { roleTitle: "Frontend Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Seattle, WA", minRate: 85, maxRate: 170, medianRate: 125 },
  { roleTitle: "DevOps Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Menlo Park, CA", minRate: 95, maxRate: 185, medianRate: 140 },
  { roleTitle: "iOS Developer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Menlo Park, CA", minRate: 90, maxRate: 175, medianRate: 130 },
  { roleTitle: "AR/VR Developer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Menlo Park, CA", minRate: 110, maxRate: 210, medianRate: 160 },
  { roleTitle: "Security Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Menlo Park, CA", minRate: 100, maxRate: 200, medianRate: 150 },
  { roleTitle: "Content Moderator", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "Austin, TX", minRate: 22, maxRate: 42, medianRate: 32 },
  { roleTitle: "Content Moderator", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "Remote", minRate: 20, maxRate: 38, medianRate: 28 },
  { roleTitle: "T&S Analyst", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "Menlo Park, CA", minRate: 35, maxRate: 60, medianRate: 45 },
  { roleTitle: "Policy Reviewer", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "New York, NY", minRate: 30, maxRate: 55, medianRate: 42 },
  { roleTitle: "Appeals Specialist", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "Austin, TX", minRate: 28, maxRate: 48, medianRate: 38 },
  { roleTitle: "Content Classifier", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "Remote", minRate: 22, maxRate: 40, medianRate: 30 },
  { roleTitle: "Community Standards Analyst", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "London, UK", minRate: 30, maxRate: 52, medianRate: 40 },
  { roleTitle: "Data Annotator", category: RequisitionCategory.DATA_OPERATIONS, location: "Remote", minRate: 18, maxRate: 35, medianRate: 25 },
  { roleTitle: "Data Annotator", category: RequisitionCategory.DATA_OPERATIONS, location: "Austin, TX", minRate: 20, maxRate: 38, medianRate: 28 },
  { roleTitle: "Data Labeler", category: RequisitionCategory.DATA_OPERATIONS, location: "Remote", minRate: 16, maxRate: 30, medianRate: 22 },
  { roleTitle: "Data Quality Analyst", category: RequisitionCategory.DATA_OPERATIONS, location: "Menlo Park, CA", minRate: 30, maxRate: 50, medianRate: 40 },
  { roleTitle: "ML Data Specialist", category: RequisitionCategory.DATA_OPERATIONS, location: "Seattle, WA", minRate: 28, maxRate: 48, medianRate: 38 },
  { roleTitle: "Training Data Curator", category: RequisitionCategory.DATA_OPERATIONS, location: "Menlo Park, CA", minRate: 25, maxRate: 45, medianRate: 35 },
  { roleTitle: "Annotation Specialist", category: RequisitionCategory.DATA_OPERATIONS, location: "Singapore", minRate: 18, maxRate: 32, medianRate: 24 },
  { roleTitle: "Graphic Designer", category: RequisitionCategory.MARKETING_CREATIVE, location: "Menlo Park, CA", minRate: 45, maxRate: 95, medianRate: 70 },
  { roleTitle: "Graphic Designer", category: RequisitionCategory.MARKETING_CREATIVE, location: "New York, NY", minRate: 50, maxRate: 100, medianRate: 75 },
  { roleTitle: "UX Designer", category: RequisitionCategory.MARKETING_CREATIVE, location: "Menlo Park, CA", minRate: 55, maxRate: 120, medianRate: 85 },
  { roleTitle: "Copywriter", category: RequisitionCategory.MARKETING_CREATIVE, location: "Remote", minRate: 40, maxRate: 90, medianRate: 65 },
  { roleTitle: "Video Producer", category: RequisitionCategory.MARKETING_CREATIVE, location: "Menlo Park, CA", minRate: 50, maxRate: 110, medianRate: 80 },
  { roleTitle: "Campaign Manager", category: RequisitionCategory.MARKETING_CREATIVE, location: "New York, NY", minRate: 55, maxRate: 115, medianRate: 82 },
  { roleTitle: "Creative Director", category: RequisitionCategory.MARKETING_CREATIVE, location: "Menlo Park, CA", minRate: 80, maxRate: 150, medianRate: 115 },
  { roleTitle: "Motion Designer", category: RequisitionCategory.MARKETING_CREATIVE, location: "Austin, TX", minRate: 45, maxRate: 100, medianRate: 72 },
  { roleTitle: "Executive Assistant", category: RequisitionCategory.CORPORATE_SERVICES, location: "Menlo Park, CA", minRate: 35, maxRate: 65, medianRate: 48 },
  { roleTitle: "Executive Assistant", category: RequisitionCategory.CORPORATE_SERVICES, location: "New York, NY", minRate: 38, maxRate: 70, medianRate: 52 },
  { roleTitle: "Finance Analyst", category: RequisitionCategory.CORPORATE_SERVICES, location: "Menlo Park, CA", minRate: 45, maxRate: 85, medianRate: 62 },
  { roleTitle: "HR Operations", category: RequisitionCategory.CORPORATE_SERVICES, location: "Austin, TX", minRate: 35, maxRate: 65, medianRate: 48 },
  { roleTitle: "Legal Assistant", category: RequisitionCategory.CORPORATE_SERVICES, location: "Menlo Park, CA", minRate: 40, maxRate: 75, medianRate: 55 },
  { roleTitle: "Facilities Coordinator", category: RequisitionCategory.CORPORATE_SERVICES, location: "Menlo Park, CA", minRate: 30, maxRate: 55, medianRate: 42 },
  { roleTitle: "Procurement Specialist", category: RequisitionCategory.CORPORATE_SERVICES, location: "Menlo Park, CA", minRate: 40, maxRate: 78, medianRate: 58 },
  { roleTitle: "Office Manager", category: RequisitionCategory.CORPORATE_SERVICES, location: "Austin, TX", minRate: 32, maxRate: 60, medianRate: 45 },
  { roleTitle: "Site Reliability Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Seattle, WA", minRate: 105, maxRate: 195, medianRate: 150 },
  { roleTitle: "QA Automation Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Austin, TX", minRate: 70, maxRate: 140, medianRate: 105 },
  { roleTitle: "Data Engineer", category: RequisitionCategory.ENGINEERING_CONTRACTORS, location: "Menlo Park, CA", minRate: 95, maxRate: 185, medianRate: 140 },
  { roleTitle: "Harm Prevention Specialist", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "Menlo Park, CA", minRate: 35, maxRate: 58, medianRate: 45 },
  { roleTitle: "Misinformation Reviewer", category: RequisitionCategory.CONTENT_TRUST_SAFETY, location: "Austin, TX", minRate: 25, maxRate: 45, medianRate: 35 },
  { roleTitle: "QA Tester", category: RequisitionCategory.DATA_OPERATIONS, location: "Austin, TX", minRate: 22, maxRate: 42, medianRate: 32 },
  { roleTitle: "Corpus Manager", category: RequisitionCategory.DATA_OPERATIONS, location: "Menlo Park, CA", minRate: 30, maxRate: 50, medianRate: 40 },
  { roleTitle: "Brand Strategist", category: RequisitionCategory.MARKETING_CREATIVE, location: "Menlo Park, CA", minRate: 60, maxRate: 125, medianRate: 90 },
  { roleTitle: "Social Media Manager", category: RequisitionCategory.MARKETING_CREATIVE, location: "Remote", minRate: 40, maxRate: 85, medianRate: 60 },
  { roleTitle: "Benefits Administrator", category: RequisitionCategory.CORPORATE_SERVICES, location: "Menlo Park, CA", minRate: 35, maxRate: 65, medianRate: 48 },
];

async function main() {
  console.log("Seeding MetaSource database...");

  // Clean existing data
  await prisma.notification.deleteMany();
  await prisma.notificationRule.deleteMany();
  await prisma.requisitionChange.deleteMany();
  await prisma.requisition.deleteMany();
  await prisma.sourcingManager.deleteMany();
  await prisma.marketRate.deleteMany();
  await prisma.scrapeLog.deleteMany();
  await prisma.chatSession.deleteMany();

  // Create managers
  const createdManagers = await Promise.all(
    managers.map((m) =>
      prisma.sourcingManager.create({
        data: {
          name: m.name,
          email: m.email,
          category: m.category,
        },
      })
    )
  );
  console.log(`Created ${createdManagers.length} managers`);

  // Create requisitions — deterministic cycling for unique combos
  const allRequisitions: { id: string; requisitionId: string; category: RequisitionCategory }[] = [];

  // Seniority/level suffixes to make role titles more unique
  const levelSuffixes = ["I", "II", "III", "Senior", "Lead"];
  // Project note variations
  const projectNotes = [
    "Q1 hiring initiative", "Q2 expansion plan", "Backfill for departing contractor",
    "New project staffing", "Team scaling for product launch", "Compliance-driven hire",
    "Cost optimization restructure", "Vendor consolidation effort", "Urgent business need",
    "Strategic initiative staffing", "Platform migration support", "Headcount rebalancing",
    "Cross-functional project", "Interim coverage", "Pilot program staffing",
    "Performance improvement hire", "Innovation lab expansion", "Customer escalation support",
    "Regulatory requirement", "Partnership enablement",
  ];

  for (const config of categoryConfigs) {
    // Pre-compute all unique (role, team, dept, vendor, location) combos
    const combos: { role: string; team: string; dept: string; vendor: string; loc: string; level: string }[] = [];

    for (let r = 0; r < config.roles.length; r++) {
      for (let t = 0; t < config.teams.length; t++) {
        for (let v = 0; v < config.vendors.length; v++) {
          for (let l = 0; l < locations.length; l++) {
            // Each combo is unique by (role index, team index, vendor index, location index)
            const levelIdx = (r + t + v + l) % levelSuffixes.length;
            combos.push({
              role: config.roles[r],
              team: config.teams[t],
              dept: config.departments[t % config.departments.length],
              vendor: config.vendors[v],
              loc: locations[l],
              level: levelSuffixes[levelIdx],
            });
          }
        }
      }
    }

    // Shuffle and take first 200
    for (let i = combos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combos[i], combos[j]] = [combos[j], combos[i]];
    }

    const selected = combos.slice(0, config.count);

    for (let i = 0; i < selected.length; i++) {
      const combo = selected[i];
      const reqId = `REQ-${config.shortName}-${String(i + 1).padStart(3, "0")}`;
      // Vary rate based on level and a per-req seed
      const levelMultiplier = { "I": 0.85, "II": 0.95, "III": 1.0, "Senior": 1.12, "Lead": 1.25 };
      const baseRate = randomFloat(config.rateMin, config.rateMax);
      const billRate = parseFloat((baseRate * (levelMultiplier[combo.level as keyof typeof levelMultiplier] || 1.0)).toFixed(2));
      const clampedRate = Math.min(Math.max(billRate, config.rateMin), config.rateMax * 1.3);

      const headcountNeeded = randomInt(1, 10);
      const status = weightedPick(statuses, statusWeights);
      const headcountFilled =
        status === RequisitionStatus.COMPLETED
          ? headcountNeeded
          : status === RequisitionStatus.OPEN
          ? 0
          : randomInt(0, headcountNeeded);
      const budgetAllocated = parseFloat((clampedRate * headcountNeeded * 2080).toFixed(2));
      const fillRatio = headcountNeeded > 0 ? headcountFilled / headcountNeeded : 0;
      const budgetSpent = parseFloat((fillRatio * budgetAllocated * randomFloat(0.5, 1.0)).toFixed(2));
      const startDate = randomDate(180);
      const endDate = new Date(startDate.getTime() + randomInt(90, 365) * 86400000);

      const roleDisplay = `${combo.role} ${combo.level}`;

      const req = await prisma.requisition.create({
        data: {
          requisitionId: reqId,
          team: combo.team,
          department: combo.dept,
          roleTitle: roleDisplay,
          category: config.category,
          headcountNeeded,
          headcountFilled,
          vendor: combo.vendor,
          billRateHourly: clampedRate,
          location: combo.loc,
          status,
          priority: weightedPick(priorities, priorityWeights),
          budgetAllocated,
          budgetSpent,
          startDate,
          endDate,
          notes: Math.random() > 0.6 ? `${projectNotes[i % projectNotes.length]} — ${combo.team}` : null,
        },
      });

      allRequisitions.push({ id: req.id, requisitionId: req.requisitionId, category: config.category });
    }
  }
  console.log(`Created ${allRequisitions.length} requisitions`);

  // Create 100 change records
  const changeTypes: ChangeType[] = [
    ChangeType.STATUS_CHANGE,
    ChangeType.RATE_CHANGE,
    ChangeType.HEADCOUNT_CHANGE,
    ChangeType.BUDGET_CHANGE,
  ];

  for (let i = 0; i < 100; i++) {
    const req = pick(allRequisitions);
    const changeType = pick(changeTypes);
    let fieldChanged: string;
    let oldValue: string;
    let newValue: string;
    let summaryTemplate: string;

    switch (changeType) {
      case ChangeType.STATUS_CHANGE:
        fieldChanged = "status";
        oldValue = pick(statuses);
        newValue = pick(statuses.filter((s) => s !== oldValue));
        summaryTemplate = pick(changeTypeSummaries.STATUS_CHANGE);
        break;
      case ChangeType.RATE_CHANGE:
        fieldChanged = "billRateHourly";
        oldValue = String(randomFloat(50, 180));
        newValue = String(randomFloat(50, 180));
        summaryTemplate = pick(changeTypeSummaries.RATE_CHANGE);
        break;
      case ChangeType.HEADCOUNT_CHANGE:
        fieldChanged = "headcountNeeded";
        oldValue = String(randomInt(1, 8));
        newValue = String(randomInt(1, 10));
        summaryTemplate = pick(changeTypeSummaries.HEADCOUNT_CHANGE);
        break;
      case ChangeType.BUDGET_CHANGE:
        fieldChanged = "budgetAllocated";
        oldValue = String(randomInt(50000, 500000));
        newValue = String(randomInt(50000, 500000));
        summaryTemplate = pick(changeTypeSummaries.BUDGET_CHANGE);
        break;
      default:
        fieldChanged = "status";
        oldValue = "OPEN";
        newValue = "SOURCING";
        summaryTemplate = "Change recorded";
    }

    const summary = summaryTemplate.replace("{old}", oldValue).replace("{new}", newValue);

    await prisma.requisitionChange.create({
      data: {
        requisitionId: req.id,
        changeType,
        fieldChanged,
        oldValue,
        newValue,
        changedBy: pick(["system", "admin", "csv_import", "sarah.chen@meta.com", "marcus.johnson@meta.com"]),
        summary,
        createdAt: randomDate(30),
      },
    });
  }
  console.log("Created 100 change records");

  // Create 30 notifications
  const managersByCategory = new Map<RequisitionCategory, string>();
  for (const m of createdManagers) {
    managersByCategory.set(m.category, m.id);
  }

  for (let i = 0; i < 30; i++) {
    const template = pick(notificationMessages);
    const manager = pick(createdManagers);

    await prisma.notification.create({
      data: {
        managerId: manager.id,
        type: template.type,
        title: template.title,
        message: template.message,
        isRead: Math.random() > 0.6,
        createdAt: randomDate(14),
      },
    });
  }
  console.log("Created 30 notifications");

  // Create notification rules
  for (const manager of createdManagers) {
    await prisma.notificationRule.createMany({
      data: [
        { managerId: manager.id, ruleType: "rate_change_threshold", threshold: 10, isEnabled: true },
        { managerId: manager.id, ruleType: "budget_warning", threshold: 80, isEnabled: true },
        { managerId: manager.id, ruleType: "headcount_change", threshold: null, isEnabled: true },
        { managerId: manager.id, ruleType: "status_change", threshold: null, isEnabled: true },
      ],
    });
  }
  console.log("Created notification rules");

  // Create market rates
  for (const rate of marketRateData) {
    await prisma.marketRate.create({
      data: {
        roleTitle: rate.roleTitle,
        category: rate.category,
        location: rate.location,
        minRate: rate.minRate,
        maxRate: rate.maxRate,
        medianRate: rate.medianRate,
        source: pick(["Glassdoor", "LinkedIn Salary", "Levels.fyi", "Staffing Industry Analysts", "Bureau of Labor Statistics"]),
        scrapedAt: randomDate(30),
      },
    });
  }
  console.log(`Created ${marketRateData.length} market rate records`);

  // Create scrape logs
  for (let i = 0; i < 5; i++) {
    await prisma.scrapeLog.create({
      data: {
        source: pick(["Glassdoor", "LinkedIn Salary", "Levels.fyi", "Indeed", "Staffing Industry Analysts"]),
        rolesScraped: randomInt(20, 100),
        status: weightedPick(["success", "success", "partial", "failed"], [40, 30, 20, 10]),
        duration: randomInt(2000, 30000),
        error: Math.random() > 0.8 ? "Rate limit exceeded, retrying..." : null,
        createdAt: randomDate(30),
      },
    });
  }
  console.log("Created scrape logs");

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Change Log page — paginated, filterable audit trail of all requisition changes.
 *
 * Each row shows timestamp, requisition ID, change type (badge), field changed,
 * old -> new values, and who made the change. Rows expand on click to show full
 * detail including role title, category, AI summary, and navigation links.
 *
 * Supports filtering by change type and date range. Can also be pre-filtered
 * to a specific requisition via the "requisitionId" URL parameter (linked from
 * the requisition table's "View Change Log" action).
 *
 * Auto-refetches via WebSocket change events.
 */
"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { CHANGE_TYPE_COLORS } from "@/lib/managers";
import { formatDateTime } from "@/lib/utils";
import { useLiveUpdates } from "@/lib/ws-context";

interface Change {
  id: string;
  requisitionId: string;
  changeType: string;
  fieldChanged: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  summary: string | null;
  createdAt: string;
  requisition: {
    requisitionId: string;
    roleTitle: string;
    category: string;
  };
}

const changeTypes = [
  "CREATED",
  "UPDATED",
  "STATUS_CHANGE",
  "RATE_CHANGE",
  "HEADCOUNT_CHANGE",
  "BUDGET_CHANGE",
  "BULK_IMPORT",
];

function ChangesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const managerId = searchParams.get("manager");
  const reqIdFilter = searchParams.get("requisitionId");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { changeSequence } = useLiveUpdates();

  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [changeType, setChangeType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchChanges = (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", "25");
    if (managerId) params.set("managerId", managerId);
    if (reqIdFilter) params.set("requisitionId", reqIdFilter);
    if (changeType && changeType !== "all") params.set("changeType", changeType);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    fetch(`/api/changes?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setChanges(data.changes || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchChanges();
  }, [page, managerId, reqIdFilter, changeType, dateFrom, dateTo]);

  // Auto-refetch silently when WS change event arrives
  useEffect(() => {
    if (changeSequence > 0) fetchChanges(true);
  }, [changeSequence]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Change Log</h1>
        <p className="text-sm text-gray-500 mt-1">
          {total} total changes recorded
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={changeType} onValueChange={(v) => { setChangeType(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {changeTypes.map((ct) => (
              <SelectItem key={ct} value={ct}>
                {ct.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">From:</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="w-[160px]"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">To:</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="w-[160px]"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-xl border bg-white h-96 animate-pulse" />
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="text-xs uppercase w-[14%]">Timestamp</TableHead>
                <TableHead className="text-xs uppercase w-[12%]">Req ID</TableHead>
                <TableHead className="text-xs uppercase w-[14%]">Type</TableHead>
                <TableHead className="text-xs uppercase w-[12%]">Field</TableHead>
                <TableHead className="text-xs uppercase w-[34%]">Change</TableHead>
                <TableHead className="text-xs uppercase w-[14%]">Changed By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-gray-500 py-10">
                    No changes found
                  </TableCell>
                </TableRow>
              ) : (
                changes.map((change) => (
                  <React.Fragment key={change.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-primary-50 transition-colors"
                      onClick={() => setExpandedId(expandedId === change.id ? null : change.id)}
                    >
                      <TableCell className="text-xs text-gray-500">
                        {formatDateTime(change.createdAt)}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-primary-600 break-all">
                          {change.requisition.requisitionId}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-[11px] ${
                            CHANGE_TYPE_COLORS[change.changeType] ||
                            "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {change.changeType.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600 truncate">
                        {change.fieldChanged || "-"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {change.oldValue || change.newValue ? (
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-red-600 truncate max-w-[45%]" title={change.oldValue || "-"}>
                              {change.oldValue || "-"}
                            </span>
                            <span className="text-gray-400 shrink-0">&rarr;</span>
                            <span className="text-green-600 truncate max-w-[45%]" title={change.newValue || "-"}>
                              {change.newValue || "-"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-gray-600 truncate">
                        {change.changedBy}
                      </TableCell>
                    </TableRow>
                    {expandedId === change.id && (
                      <TableRow className="bg-gray-50 border-l-4 border-l-primary-500">
                        <TableCell colSpan={6}>
                          <div className="py-3 px-2 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-gray-400 text-xs uppercase font-medium">Requisition</p>
                                <p className="font-semibold text-gray-900">{change.requisition.requisitionId}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 text-xs uppercase font-medium">Role</p>
                                <p className="text-gray-700">{change.requisition.roleTitle}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 text-xs uppercase font-medium">Category</p>
                                <p className="text-gray-700">{change.requisition.category.replace(/_/g, " ")}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 text-xs uppercase font-medium">Changed By</p>
                                <p className="text-gray-700">{change.changedBy}</p>
                              </div>
                            </div>
                            {(change.oldValue || change.newValue) && (
                              <div className="bg-white rounded-lg p-3 border border-gray-200">
                                <p className="text-xs text-gray-400 uppercase font-medium mb-1">Full Change Detail</p>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-mono">
                                  <span className="text-red-600">Old: {change.oldValue || "-"}</span>
                                  <span className="text-green-600">New: {change.newValue || "-"}</span>
                                </div>
                              </div>
                            )}
                            {change.summary && (
                              <div className="bg-white rounded-lg p-3 border border-gray-200">
                                <p className="text-xs text-gray-400 uppercase font-medium mb-1">AI Summary</p>
                                <p className="text-sm text-gray-700">{change.summary}</p>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const mParam = managerId ? `&manager=${managerId}` : "";
                                  router.push(`/requisitions?search=${change.requisition.requisitionId}${mParam}`);
                                }}
                              >
                                View Hiring Request
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const mParam = managerId ? `&manager=${managerId}` : "";
                                  router.push(`/changes?requisitionId=${change.requisitionId}${mParam}`);
                                }}
                              >
                                All Changes for This Request
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Page {page} of {totalPages} ({total} results)
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ChangesPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-10 w-48 bg-gray-200 animate-pulse rounded" />
          <div className="h-96 rounded-xl border bg-white animate-pulse" />
        </div>
      }
    >
      <ChangesContent />
    </Suspense>
  );
}

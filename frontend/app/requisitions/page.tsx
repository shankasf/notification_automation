"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Plus, Upload, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { RequisitionTable } from "./components/req-table";
import { FilterBar } from "./components/filter-bar";
import { RequisitionForm } from "./components/req-form";
import { useLiveUpdates } from "@/lib/ws-context";

interface Requisition {
  id: string;
  requisitionId: string;
  roleTitle: string;
  category: string;
  status: string;
  priority: string;
  vendor: string;
  location: string;
  billRateHourly: number;
  headcountNeeded: number;
  headcountFilled: number;
  budgetAllocated: number;
  budgetSpent: number;
  team: string;
  department: string;
}

function RequisitionsContent() {
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");
  const { data: session } = useSession();
  const { changeSequence } = useLiveUpdates();

  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");

  // Form dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editingReq, setEditingReq] = useState<Record<string, unknown> | null>(null);

  const userHeaders = (): HeadersInit => ({
    "Content-Type": "application/json",
    "X-Changed-By": session?.user?.email || "user",
  });

  const fetchData = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", "20");
    if (managerId) params.set("managerId", managerId);
    if (search) params.set("search", search);
    if (category && category !== "all") params.set("category", category);
    if (status && status !== "all") params.set("status", status);
    if (priority && priority !== "all") params.set("priority", priority);

    fetch(`/api/requisitions?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setRequisitions(data.requisitions || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, managerId, search, category, status, priority]);

  // Auto-refetch silently when WS change event arrives
  useEffect(() => {
    if (changeSequence > 0) fetchData(true);
  }, [changeSequence, fetchData]);

  useEffect(() => {
    const timer = setTimeout(fetchData, 300);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const authQuery = managerId ? `?managerId=${managerId}` : "";

  const handleCreate = async (data: Record<string, unknown>) => {
    const res = await fetch(`/api/requisitions${authQuery}`, {
      method: "POST",
      headers: userHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to create requisition");
      return;
    }
    fetchData();
  };

  const handleEdit = (req: Requisition) => {
    setEditingReq(req as unknown as Record<string, unknown>);
    setFormOpen(true);
  };

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (!editingReq?.id) return;
    const res = await fetch(`/api/requisitions/${editingReq.id}${authQuery}`, {
      method: "PUT",
      headers: userHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to update requisition");
      return;
    }
    setEditingReq(null);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this requisition?")) return;
    const res = await fetch(`/api/requisitions/${id}${authQuery}`, {
      method: "DELETE",
      headers: userHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to delete requisition");
      return;
    }
    fetchData();
  };

  const handleInlineUpdate = async (
    id: string,
    field: string,
    value: string | number
  ) => {
    const res = await fetch(`/api/requisitions/${id}${authQuery}`, {
      method: "PUT",
      headers: userHeaders(),
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Update not permitted");
      return;
    }
    fetchData();
  };

  const clearFilters = () => {
    setSearch("");
    setCategory("");
    setStatus("");
    setPriority("");
    setPage(1);
  };

  const managerQuery = managerId ? `?manager=${managerId}` : "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hiring Requests</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total.toLocaleString()} total requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/requisitions/upload${managerQuery}`}>
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={() => {
              setEditingReq(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Request
          </Button>
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        category={category}
        onCategoryChange={(v) => {
          setCategory(v);
          setPage(1);
        }}
        status={status}
        onStatusChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        priority={priority}
        onPriorityChange={(v) => {
          setPriority(v);
          setPage(1);
        }}
        onClear={clearFilters}
        hideCategory={!!managerId}
      />

      {/* Table */}
      {loading ? (
        <div className="rounded-xl border bg-white h-96 animate-pulse" />
      ) : (
        <RequisitionTable
          data={requisitions}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onInlineUpdate={handleInlineUpdate}
        />
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

      {/* Form Dialog */}
      <RequisitionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingReq(null);
        }}
        onSubmit={editingReq ? handleUpdate : handleCreate}
        initialData={editingReq}
      />
    </div>
  );
}

export default function RequisitionsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-10 w-48 bg-gray-200 animate-pulse rounded" />
          <div className="h-96 rounded-xl border bg-white animate-pulse" />
        </div>
      }
    >
      <RequisitionsContent />
    </Suspense>
  );
}

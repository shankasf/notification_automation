"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from "@tanstack/react-table";
import { MoreHorizontal, ArrowUpDown, Pencil, Trash2, History } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/app/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Input } from "@/app/components/ui/input";
import { MANAGER_CONFIG, STATUS_COLORS, PRIORITY_COLORS } from "@/lib/managers";
import { formatRate, calculatePercentage } from "@/lib/utils";

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

interface RequisitionTableProps {
  data: Requisition[];
  onEdit: (req: Requisition) => void;
  onDelete: (id: string) => void;
  onInlineUpdate: (id: string, field: string, value: string | number) => void;
}

export function RequisitionTable({ data, onEdit, onDelete, onInlineUpdate }: RequisitionTableProps) {
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: string;
  } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const startEditing = (id: string, field: string, currentValue: string | number) => {
    setEditingCell({ id, field });
    setEditValue(String(currentValue));
  };

  const saveEdit = (id: string, field: string) => {
    const value = field === "billRateHourly" || field === "headcountNeeded" || field === "headcountFilled"
      ? Number(editValue)
      : editValue;
    onInlineUpdate(id, field, value);
    setEditingCell(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
  };

  const columns: ColumnDef<Requisition, unknown>[] = [
    {
      accessorKey: "requisitionId",
      header: "Request ID",
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium text-primary-600">
          {row.original.requisitionId}
        </span>
      ),
      size: 130,
    },
    {
      accessorKey: "roleTitle",
      header: "Role",
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-gray-900">{row.original.roleTitle}</p>
          <p className="text-xs text-gray-500">{row.original.team}</p>
        </div>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => {
        const config = MANAGER_CONFIG[row.original.category as keyof typeof MANAGER_CONFIG];
        return (
          <Badge
            className="text-white text-[10px]"
            style={{ backgroundColor: config?.color || "#6B7280" }}
          >
            {config?.shortName || row.original.category}
          </Badge>
        );
      },
      size: 80,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const currentStatus = row.original.status;
        const colorClass = STATUS_COLORS[currentStatus] || "bg-gray-100 text-gray-800";
        return (
          <Select
            value={currentStatus}
            onValueChange={(v) => {
              onInlineUpdate(row.original.id, "status", v);
            }}
          >
            <SelectTrigger className={`h-7 text-xs w-[130px] border-0 font-semibold rounded-full px-3 ${colorClass}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(STATUS_COLORS).map((s) => (
                <SelectItem key={s} value={s}>
                  <span className={`inline-flex items-center gap-1.5`}>
                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[s]?.split(" ")[0] || "bg-gray-100"}`} />
                    {s}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
      size: 140,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => {
        const isEditing =
          editingCell?.id === row.original.id &&
          editingCell?.field === "priority";

        if (isEditing) {
          return (
            <Select
              value={editValue}
              onValueChange={(v) => {
                setEditValue(v);
                onInlineUpdate(row.original.id, "priority", v);
                setEditingCell(null);
              }}
            >
              <SelectTrigger className="h-7 text-xs w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(PRIORITY_COLORS).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }

        return (
          <Badge
            className={`cursor-pointer ${PRIORITY_COLORS[row.original.priority] || "bg-gray-100 text-gray-800"}`}
            onClick={() => startEditing(row.original.id, "priority", row.original.priority)}
          >
            {row.original.priority}
          </Badge>
        );
      },
      size: 100,
    },
    {
      accessorKey: "vendor",
      header: "Vendor",
      cell: ({ row }) => (
        <span className="text-sm text-gray-700">{row.original.vendor}</span>
      ),
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => (
        <span className="text-sm text-gray-600">{row.original.location}</span>
      ),
    },
    {
      accessorKey: "billRateHourly",
      header: "Hourly Rate",
      cell: ({ row }) => {
        const isEditing =
          editingCell?.id === row.original.id &&
          editingCell?.field === "billRateHourly";

        if (isEditing) {
          return (
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit(row.original.id, "billRateHourly")}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit(row.original.id, "billRateHourly");
                if (e.key === "Escape") cancelEdit();
              }}
              className="h-7 w-20 text-xs"
              autoFocus
            />
          );
        }

        return (
          <span
            className="text-sm font-medium cursor-pointer hover:text-primary-600"
            onClick={() =>
              startEditing(row.original.id, "billRateHourly", row.original.billRateHourly)
            }
          >
            {formatRate(row.original.billRateHourly)}
          </span>
        );
      },
      size: 90,
    },
    {
      id: "headcount",
      header: "Headcount",
      cell: ({ row }) => {
        const filled = row.original.headcountFilled;
        const needed = row.original.headcountNeeded;
        const pct = calculatePercentage(filled, needed);
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {filled}/{needed}
            </span>
            <div className="w-12 h-1.5 rounded-full bg-gray-200">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: pct >= 80 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444",
                }}
              />
            </div>
          </div>
        );
      },
      size: 110,
    },
    {
      id: "budget",
      header: "Budget",
      cell: ({ row }) => {
        const pct = calculatePercentage(
          row.original.budgetSpent,
          row.original.budgetAllocated
        );
        return (
          <div className="w-20">
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span className="text-gray-600">{pct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-gray-200">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(pct, 100)}%`,
                  backgroundColor: pct > 90 ? "#EF4444" : pct > 70 ? "#F59E0B" : "#10B981",
                }}
              />
            </div>
          </div>
        );
      },
      size: 100,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(row.original)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                window.location.href = `/changes?requisitionId=${row.original.id}`;
              }}
            >
              <History className="h-4 w-4 mr-2" />
              View Change Log
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600"
              onClick={() => onDelete(row.original.id)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      size: 50,
    },
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-gray-50">
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-xs uppercase tracking-wider">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center text-gray-500 py-10">
                No hiring requests found
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

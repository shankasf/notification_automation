"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { MANAGER_CONFIG } from "@/lib/managers";

const requisitionSchema = z.object({
  roleTitle: z.string().min(1, "Role title is required"),
  category: z.string().min(1, "Category is required"),
  team: z.string().min(1, "Team is required"),
  department: z.string().min(1, "Department is required"),
  vendor: z.string().min(1, "Vendor is required"),
  location: z.string().min(1, "Location is required"),
  billRateHourly: z.number().positive("Bill rate must be positive"),
  headcountNeeded: z.number().int().positive("Headcount must be positive"),
  priority: z.string().optional(),
  notes: z.string().optional(),
});

interface RequisitionFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  initialData?: Record<string, unknown> | null;
}

const locations = [
  "Menlo Park, CA",
  "Austin, TX",
  "New York, NY",
  "Seattle, WA",
  "Remote",
  "London, UK",
  "Singapore",
];

export function RequisitionForm({ open, onClose, onSubmit, initialData }: RequisitionFormProps) {
  const [formData, setFormData] = useState<Record<string, string | number>>({
    roleTitle: (initialData?.roleTitle as string) || "",
    category: (initialData?.category as string) || "",
    team: (initialData?.team as string) || "",
    department: (initialData?.department as string) || "",
    vendor: (initialData?.vendor as string) || "",
    location: (initialData?.location as string) || "",
    billRateHourly: (initialData?.billRateHourly as number) || 0,
    headcountNeeded: (initialData?.headcountNeeded as number) || 1,
    priority: (initialData?.priority as string) || "MEDIUM",
    notes: (initialData?.notes as string) || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Reset form when dialog opens or initialData changes
  useEffect(() => {
    if (open) {
      setFormData({
        roleTitle: (initialData?.roleTitle as string) || "",
        category: (initialData?.category as string) || "",
        team: (initialData?.team as string) || "",
        department: (initialData?.department as string) || "",
        vendor: (initialData?.vendor as string) || "",
        location: (initialData?.location as string) || "",
        billRateHourly: (initialData?.billRateHourly as number) || 0,
        headcountNeeded: (initialData?.headcountNeeded as number) || 1,
        priority: (initialData?.priority as string) || "MEDIUM",
        notes: (initialData?.notes as string) || "",
      });
      setErrors({});
    }
  }, [open, initialData]);

  const handleChange = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async () => {
    const data = {
      ...formData,
      billRateHourly: Number(formData.billRateHourly),
      headcountNeeded: Number(formData.headcountNeeded),
    };

    const result = requisitionSchema.safeParse(data);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        fieldErrors[issue.path[0] as string] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    await onSubmit(data);
    setSubmitting(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData ? "Edit Hiring Request" : "Add Hiring Request"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 mt-4">
          {/* Role Title */}
          <div className="col-span-2">
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Role Title *
            </label>
            <Input
              value={formData.roleTitle}
              onChange={(e) => handleChange("roleTitle", e.target.value)}
              placeholder="e.g. ML Engineer"
            />
            {errors.roleTitle && (
              <p className="text-xs text-red-500 mt-1">{errors.roleTitle}</p>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Category *
            </label>
            <Select
              value={formData.category as string}
              onValueChange={(v) => handleChange("category", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MANAGER_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.category && (
              <p className="text-xs text-red-500 mt-1">{errors.category}</p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Priority
            </label>
            <Select
              value={formData.priority as string}
              onValueChange={(v) => handleChange("priority", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Team */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Team *
            </label>
            <Input
              value={formData.team}
              onChange={(e) => handleChange("team", e.target.value)}
              placeholder="e.g. AI Research"
            />
            {errors.team && (
              <p className="text-xs text-red-500 mt-1">{errors.team}</p>
            )}
          </div>

          {/* Department */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Department *
            </label>
            <Input
              value={formData.department}
              onChange={(e) => handleChange("department", e.target.value)}
              placeholder="e.g. Engineering"
            />
            {errors.department && (
              <p className="text-xs text-red-500 mt-1">{errors.department}</p>
            )}
          </div>

          {/* Vendor */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Vendor *
            </label>
            <Input
              value={formData.vendor}
              onChange={(e) => handleChange("vendor", e.target.value)}
              placeholder="e.g. Insight Global"
            />
            {errors.vendor && (
              <p className="text-xs text-red-500 mt-1">{errors.vendor}</p>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Location *
            </label>
            <Select
              value={formData.location as string}
              onValueChange={(v) => handleChange("location", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.location && (
              <p className="text-xs text-red-500 mt-1">{errors.location}</p>
            )}
          </div>

          {/* Bill Rate */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Hourly Bill Rate ($) *
            </label>
            <Input
              type="number"
              value={formData.billRateHourly === 0 ? "" : formData.billRateHourly}
              onChange={(e) =>
                handleChange("billRateHourly", e.target.value === "" ? 0 : parseFloat(e.target.value))
              }
              onFocus={(e) => {
                if (Number(e.target.value) === 0) handleChange("billRateHourly", "" as unknown as number);
              }}
              min={0}
              step={0.01}
              placeholder="0.00"
            />
            {errors.billRateHourly && (
              <p className="text-xs text-red-500 mt-1">{errors.billRateHourly}</p>
            )}
          </div>

          {/* Headcount */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Positions Needed *
            </label>
            <Input
              type="number"
              value={formData.headcountNeeded}
              onChange={(e) =>
                handleChange("headcountNeeded", e.target.value === "" ? 0 : parseInt(e.target.value))
              }
              min={1}
            />
            {errors.headcountNeeded && (
              <p className="text-xs text-red-500 mt-1">{errors.headcountNeeded}</p>
            )}
          </div>

          {/* Notes */}
          <div className="col-span-2">
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Notes
            </label>
            <textarea
              className="flex w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-[80px]"
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              placeholder="Additional notes..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving..." : initialData ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

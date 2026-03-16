"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
  X,
  FileSpreadsheet,
  FileJson,
  File,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";

interface PipelineStage {
  name: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
}

interface UploadRecord {
  index: number;
  raw_data: Record<string, unknown>;
  cleaned_data: Record<string, unknown> | null;
  validated: boolean;
  status: string;
  error: string | null;
  requisition_id: string | null;
}

interface UploadResult {
  jobId: string;
  status: string;
  created: number;
  failed: number;
  errors: string[];
  records?: UploadRecord[];
}

interface ProgressUpdate {
  jobId: string;
  stage: string;
  total: number;
  summary: Record<string, number>;
  message: string;
}

const FILE_ICONS: Record<string, React.ReactNode> = {
  csv: <FileSpreadsheet className="h-8 w-8 text-green-500" />,
  xlsx: <FileSpreadsheet className="h-8 w-8 text-green-600" />,
  xls: <FileSpreadsheet className="h-8 w-8 text-green-600" />,
  json: <FileJson className="h-8 w-8 text-yellow-500" />,
  txt: <FileText className="h-8 w-8 text-blue-500" />,
};

const STAGE_LABELS: Record<string, string> = {
  parsing: "Parsing",
  cleaning: "Cleaning",
  validating: "Validating",
  uploading: "Uploading",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  PARSING: "bg-blue-100 text-blue-700",
  CLEANING: "bg-yellow-100 text-yellow-700",
  VALIDATED: "bg-indigo-100 text-indigo-700",
  UPLOADED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

export default function DataUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([
    { name: "parsing", label: "Parse", status: "pending" },
    { name: "cleaning", label: "Clean", status: "pending" },
    { name: "validating", label: "Validate", status: "pending" },
    { name: "uploading", label: "Upload", status: "pending" },
  ]);

  // Listen for WebSocket progress updates
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!uploading) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/notifications?managerId=admin`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "upload_progress") {
            const p = msg.payload as ProgressUpdate;
            setProgress(p);
            updateStages(p.stage);
          }
        } catch {}
      };

      return () => {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      };
    } catch {}
  }, [uploading]);

  const updateStages = (currentStage: string) => {
    const order = ["parsing", "cleaning", "validating", "uploading", "completed"];
    const currentIdx = order.indexOf(currentStage);

    setStages((prev) =>
      prev.map((s, i) => ({
        ...s,
        status:
          currentStage === "failed"
            ? i <= currentIdx
              ? "error"
              : "pending"
            : i < currentIdx
            ? "done"
            : i === currentIdx
            ? "active"
            : currentIdx >= order.length - 1
            ? "done"
            : "pending",
      }))
    );
  };

  const getFileExt = (name: string) => {
    const parts = name.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "txt";
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);
    setProgress(null);
    setStages((prev) => prev.map((s) => ({ ...s, status: "pending" })));

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/data-upload", {
        method: "POST",
        body: formData,
      });
      const data: UploadResult = await res.json();
      setResult(data);
      updateStages("completed");
    } catch {
      setResult({
        jobId: "",
        status: "failed",
        created: 0,
        failed: 0,
        errors: ["Upload failed — check if the AI service is running"],
      });
      updateStages("failed");
    }

    setUploading(false);
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    setProgress(null);
    setStages((prev) => prev.map((s) => ({ ...s, status: "pending" })));
  };

  const fileExt = file ? getFileExt(file.name) : "";

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Data Upload</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload any format (CSV, Excel, JSON, plain text) — the AI pipeline will
          clean, validate, and import the data automatically
        </p>
      </div>

      {/* Upload zone */}
      {!file && !result && (
        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
            dragOver
              ? "border-primary-400 bg-primary-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Drag & drop your file here
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Supports CSV, Excel (.xlsx), JSON, and plain text files
          </p>
          <label>
            <Button variant="outline" asChild>
              <span>Choose File</span>
            </Button>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.json,.txt,.tsv"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
          <div className="mt-6 text-xs text-gray-400">
            <p>
              The AI pipeline will automatically detect the format, extract
              records, clean messy data, validate fields, and import into the
              system
            </p>
          </div>
        </div>
      )}

      {/* File selected — ready to process */}
      {file && !uploading && !result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {FILE_ICONS[fileExt] || <File className="h-8 w-8 text-gray-400" />}
                <div>
                  <CardTitle className="text-base">{file.name}</CardTitle>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB — {fileExt.toUpperCase()} file
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={clearFile}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button onClick={handleUpload}>
                <Upload className="h-4 w-4 mr-2" />
                Start AI Pipeline
              </Button>
              <Button variant="outline" onClick={clearFile}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline progress */}
      {(uploading || result) && (
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-6">
              {stages.map((stage, i) => (
                <div key={stage.name} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                        stage.status === "done"
                          ? "bg-green-500 border-green-500 text-white"
                          : stage.status === "active"
                          ? "bg-primary-500 border-primary-500 text-white"
                          : stage.status === "error"
                          ? "bg-red-500 border-red-500 text-white"
                          : "bg-white border-gray-300 text-gray-400"
                      }`}
                    >
                      {stage.status === "done" ? (
                        <CheckCircle className="h-5 w-5" />
                      ) : stage.status === "active" ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : stage.status === "error" ? (
                        <AlertCircle className="h-5 w-5" />
                      ) : (
                        <span className="text-sm font-medium">{i + 1}</span>
                      )}
                    </div>
                    <span
                      className={`text-xs mt-1.5 font-medium ${
                        stage.status === "active"
                          ? "text-primary-600"
                          : stage.status === "done"
                          ? "text-green-600"
                          : stage.status === "error"
                          ? "text-red-600"
                          : "text-gray-400"
                      }`}
                    >
                      {stage.label}
                    </span>
                  </div>
                  {i < stages.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-gray-300 mx-4 mt-[-18px]" />
                  )}
                </div>
              ))}
            </div>

            {/* Progress message */}
            {progress && (
              <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-4">
                {progress.message}
                {progress.summary && (
                  <div className="flex gap-4 mt-2 text-xs">
                    {Object.entries(progress.summary).map(([key, val]) =>
                      val > 0 ? (
                        <span key={key} className="text-gray-500">
                          {key}: <strong>{val}</strong>
                        </span>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            )}

            {uploading && !progress && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting AI pipeline...
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5 text-center">
                <p className="text-3xl font-bold text-green-600">{result.created}</p>
                <p className="text-sm text-gray-500 mt-1">Created</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 text-center">
                <p className="text-3xl font-bold text-red-600">{result.failed}</p>
                <p className="text-sm text-gray-500 mt-1">Failed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 text-center">
                <p className="text-3xl font-bold text-gray-900">
                  {(result.records || []).length}
                </p>
                <p className="text-sm text-gray-500 mt-1">Total Processed</p>
              </CardContent>
            </Card>
          </div>

          {/* Errors */}
          {result.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Errors ({result.errors.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-red-600 max-h-48 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <li key={i} className="py-1 border-b border-red-100 last:border-0">
                      {err}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Per-record table */}
          {result.records && result.records.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Processed Records</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-auto max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="text-xs uppercase w-16">#</TableHead>
                        <TableHead className="text-xs uppercase">Role</TableHead>
                        <TableHead className="text-xs uppercase">Category</TableHead>
                        <TableHead className="text-xs uppercase">Rate</TableHead>
                        <TableHead className="text-xs uppercase">Status</TableHead>
                        <TableHead className="text-xs uppercase">Request ID</TableHead>
                        <TableHead className="text-xs uppercase">Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.records.map((rec) => (
                        <TableRow key={rec.index}>
                          <TableCell className="text-xs text-gray-500">
                            {rec.index + 1}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {(rec.cleaned_data?.roleTitle as string) ||
                              (rec.raw_data?.roleTitle as string) ||
                              (rec.raw_data?.role_title as string) ||
                              "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {(rec.cleaned_data?.category as string)?.replace(/_/g, " ") || "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {rec.cleaned_data?.billRateHourly
                              ? `$${rec.cleaned_data.billRateHourly}/hr`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                STATUS_COLORS[rec.status] || "bg-gray-100 text-gray-700"
                              }
                            >
                              {rec.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-primary-600">
                            {rec.requisition_id || "-"}
                          </TableCell>
                          <TableCell className="text-xs text-red-500 max-w-[200px] truncate">
                            {rec.error || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={clearFile}>Upload Another File</Button>
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/requisitions")}
            >
              View Hiring Requests
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

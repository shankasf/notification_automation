"use client";

import { useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  X,
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

interface UploadResult {
  created: number;
  updated: number;
  errors: string[];
  total: number;
}

function UploadContent() {
  const searchParams = useSearchParams();
  const managerId = searchParams.get("manager");
  const managerQuery = managerId ? `?manager=${managerId}` : "";

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const parseFile = (f: File) => {
    setFile(f);
    setResult(null);

    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      preview: 10,
      complete: (results) => {
        setHeaders(results.meta.fields || []);
        setPreview(results.data as Record<string, string>[]);
      },
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "text/csv" || droppedFile?.name.endsWith(".csv")) {
      parseFile(droppedFile);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) parseFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/requisitions/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ created: 0, updated: 0, errors: ["Upload failed"], total: 0 });
    }

    setUploading(false);
  };

  const clearFile = () => {
    setFile(null);
    setPreview([]);
    setHeaders([]);
    setResult(null);
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/requisitions${managerQuery}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Upload CSV</h1>
          <p className="text-sm text-gray-500 mt-1">
            Import hiring requests from a CSV file
          </p>
        </div>
      </div>

      {/* Upload zone */}
      {!file && (
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
            Drag & drop your CSV file here
          </h3>
          <p className="text-sm text-gray-500 mb-4">or click to browse</p>
          <label>
            <Button variant="outline" asChild>
              <span>Choose File</span>
            </Button>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
          <div className="mt-6 text-xs text-gray-400">
            <p>Expected columns: role_title, category, team, department, vendor, location, bill_rate, headcount, status, priority</p>
          </div>
        </div>
      )}

      {/* File selected */}
      {file && !result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary-500" />
                <div>
                  <CardTitle className="text-base">{file.name}</CardTitle>
                  <p className="text-sm text-gray-500">
                    {preview.length} rows previewed, {headers.length} columns detected
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={clearFile}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Column mapping info */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                Detected Columns
              </h4>
              <div className="flex flex-wrap gap-2">
                {headers.map((h) => (
                  <Badge key={h} variant="secondary">
                    {h}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Preview table */}
            <div className="border rounded-lg overflow-auto max-h-64">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    {headers.map((h) => (
                      <TableHead key={h} className="text-xs whitespace-nowrap">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row, i) => (
                    <TableRow key={i}>
                      {headers.map((h) => (
                        <TableCell key={h} className="text-xs whitespace-nowrap">
                          {row[h] || "-"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Actions */}
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={handleUpload} disabled={uploading}>
                {uploading ? "Importing..." : "Import"}
              </Button>
              <Button variant="outline" onClick={clearFile}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.errors.length === 0 ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-yellow-500" />
              )}
              Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 rounded-lg bg-green-50">
                <p className="text-2xl font-bold text-green-700">
                  {result.created}
                </p>
                <p className="text-sm text-green-600">Created</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-blue-50">
                <p className="text-2xl font-bold text-blue-700">
                  {result.updated}
                </p>
                <p className="text-sm text-blue-600">Updated</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-red-50">
                <p className="text-2xl font-bold text-red-700">
                  {result.errors.length}
                </p>
                <p className="text-sm text-red-600">Errors</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h4 className="text-sm font-medium text-red-800 mb-2">
                  Errors
                </h4>
                <ul className="space-y-1 text-sm text-red-700">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <Link href={`/requisitions${managerQuery}`}>
                <Button>View Hiring Requests</Button>
              </Link>
              <Button variant="outline" onClick={clearFile}>
                Upload Another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl space-y-6">
          <div className="h-10 w-48 bg-gray-200 animate-pulse rounded" />
          <div className="h-64 border-2 border-dashed rounded-xl animate-pulse" />
        </div>
      }
    >
      <UploadContent />
    </Suspense>
  );
}

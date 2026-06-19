"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CHUNK = 4 * 1024 * 1024;
const ENDPOINT = "/api/corporate-docs/analyze";

const DOC_TYPES = [
  { value: "", label: "Auto-detect" },
  { value: "ARTICLES", label: "Articles of Organization/Incorporation" },
  { value: "OPERATING_AGREEMENT", label: "Operating Agreement" },
  { value: "ANNUAL_REPORT", label: "Annual Report (Sunbiz)" },
  { value: "CERTIFICATE", label: "Certificate of Status" },
  { value: "EIN_LETTER", label: "EIN / FEI letter" },
  { value: "OTHER", label: "Other" },
];

type UploadResult = { id?: string; error?: string };

async function uploadFile(
  file: File,
  companyId: string,
  docType: string,
  docName: string,
  onProgress: (sent: number, total: number) => void,
): Promise<UploadResult> {
  const base: Record<string, string> = {
    "content-type": "application/pdf",
    "x-filename": encodeURIComponent(file.name),
    "x-doc-type": docType,
    "x-doc-name": encodeURIComponent(docName),
    "x-company-id": companyId,
  };

  if (file.size <= CHUNK) {
    const res = await fetch(ENDPOINT, { method: "POST", body: file, headers: base });
    const j = (await res.json().catch(() => ({}))) as UploadResult;
    return res.ok ? j : { error: j.error ?? `Upload failed (${res.status}).` };
  }

  const total = Math.ceil(file.size / CHUNK);
  const uploadId = crypto.randomUUID();
  let last: UploadResult = {};
  for (let i = 0; i < total; i++) {
    const blob = file.slice(i * CHUNK, Math.min((i + 1) * CHUNK, file.size));
    const res = await fetch(ENDPOINT, {
      method: "POST",
      body: blob,
      headers: { ...base, "x-upload-id": uploadId, "x-chunk-index": String(i), "x-total-chunks": String(total) },
    });
    const j = (await res.json().catch(() => ({}))) as UploadResult;
    if (!res.ok) return { error: j.error ?? `Upload failed (${res.status}).` };
    onProgress(i + 1, total);
    last = j;
  }
  return last;
}

export function CorporateUpload({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState("");
  const [docName, setDocName] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setError("Choose a PDF file first.");
      return;
    }
    if (docType === "OTHER" && !docName.trim()) {
      setError("Give the document a name.");
      return;
    }
    setPending(true);
    setProgress(null);
    try {
      const res = await uploadFile(file, companyId, docType, docName.trim(), (sent, total) =>
        setProgress({ sent, total }),
      );
      if (res.error) setError(res.error);
      else {
        form.reset();
        setDocType("");
        setDocName("");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPending(false);
      setProgress(null);
    }
  }

  const inputClass =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="mb-1 block text-sm font-medium text-slate-700">
        Upload a corporate document (PDF)
      </label>
      <p className="mb-3 text-sm text-slate-500">
        Articles, Operating Agreement, Sunbiz annual report, etc. Claude reads it and registers the
        registered agent, managers/members, addresses and the registration number.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select
          name="docType"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className={inputClass}
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {docType === "OTHER" && (
          <input
            type="text"
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="Document name (e.g. Lease, Resolution)"
            className={`${inputClass} min-w-56`}
          />
        )}
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Analyzing…" : "Analyze"}
        </button>
      </div>
      {pending && (
        <p className="mt-3 text-sm text-slate-500">
          {progress ? `Uploading… ${progress.sent}/${progress.total} chunks` : "Reading the document…"}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </form>
  );
}

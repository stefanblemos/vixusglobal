"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// O dev server do Next limita o corpo de uploads a ~10 MiB. Deixamos margem.
const MAX_UPLOAD_MB = 9.5;

export function IrUpload() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizeMsg, setSizeMsg] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setSizeMsg(null);
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    const mb = f.size / (1024 * 1024);
    if (mb > MAX_UPLOAD_MB) {
      setSizeMsg(
        `This PDF is ${mb.toFixed(1)} MB — over the ~${MAX_UPLOAD_MB} MB upload limit. Compress it (e.g. Acrobat “Reduce File Size” or an online PDF compressor) and try again.`,
      );
    }
  }

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
    if (file.size / (1024 * 1024) > MAX_UPLOAD_MB) return; // bloqueado pelo aviso de tamanho

    setPending(true);
    try {
      const res = await fetch("/api/tax-returns/analyze", {
        method: "POST",
        body: file,
        headers: {
          "content-type": "application/pdf",
          "x-filename": encodeURIComponent(file.name),
        },
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? `Upload failed (${res.status}).`);
      } else {
        form.reset();
        setSizeMsg(null);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="mb-1 block text-sm font-medium text-slate-700">
        Upload an income tax return (PDF)
      </label>
      <p className="mb-3 text-sm text-slate-500">
        Claude reads it and extracts the partners (sócios) and the tax treatment — no tax experience
        needed. Returns over 100 pages are read up to the first 100; max ~{MAX_UPLOAD_MB} MB
        (compress scanned PDFs).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          onChange={onPick}
          className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <button
          type="submit"
          disabled={pending || sizeMsg != null}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Analyzing with Claude…" : "Analyze"}
        </button>
      </div>
      {pending && (
        <p className="mt-3 text-sm text-slate-500">
          Reading the document and extracting partners and tax treatment — this can take up to a
          minute for large returns.
        </p>
      )}
      {sizeMsg && <p className="mt-3 text-sm text-amber-600">{sizeMsg}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </form>
  );
}

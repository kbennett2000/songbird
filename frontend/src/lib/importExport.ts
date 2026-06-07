import { apiRequest } from "@/lib/api";
import {
  type ExportDocument,
  type ImportSummary,
  exportDocumentSchema,
  importSummarySchema,
} from "@/schemas";

/** The current user's notes as a portable document (Zod-validated like every other response). */
export async function fetchExport(): Promise<ExportDocument> {
  const data = await apiRequest<unknown>("GET", "/export");
  return exportDocumentSchema.parse(data);
}

/**
 * Download the user's annotations + sermon notes as a single portable JSON file. The round-trip
 * format (re-importable). Markdown note bodies travel verbatim inside it (invariant 6). The
 * browser picks no server filename, so we name it here.
 */
export async function downloadExport(): Promise<void> {
  const doc = await fetchExport();
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `songbird-notes-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Send a parsed export document to the server; it merges, skipping duplicates, and tallies. */
export async function importNotes(payload: unknown): Promise<ImportSummary> {
  const data = await apiRequest<unknown>("POST", "/import", payload);
  return importSummarySchema.parse(data);
}

/** Read a user-picked file as parsed JSON (the import payload). Throws on malformed JSON. */
export async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

"use server";

import Anthropic from "@anthropic-ai/sdk";
import { buildReportFindings, type ReportFindings } from "@/lib/ir/accountant-report";

export interface AccountantReportResult {
  findings: ReportFindings;
  emailText: string;
}

function findingsToPrompt(f: ReportFindings): string {
  const lines: string[] = [];
  lines.push(`Company: ${f.companyName}${f.taxId ? ` (EIN ${f.taxId})` : ""}`);
  lines.push(`Tax year: ${f.year} · Form: ${f.taxForm ?? "—"} · Currency: ${f.currency}`);
  if (f.preparer) lines.push(`Preparer (accountant): ${f.preparer}`);
  lines.push("\nWhat reconciles cleanly:");
  if (f.reconciles.length) f.reconciles.forEach((r) => lines.push(`- ${r}`));
  else lines.push("- (nothing computed)");
  lines.push("\nOpen questions to ask the accountant:");
  if (f.questions.length)
    f.questions.forEach((q, i) =>
      lines.push(`${i + 1}. [${q.title}]${q.formRef ? ` (${q.formRef})` : ""}: ${q.detail}`),
    );
  else lines.push("- None — the return reconciles to the books with no open items.");
  return lines.join("\n");
}

export async function generateAccountantReport(
  companyId: string,
  year: number,
): Promise<AccountantReportResult> {
  const findings = await buildReportFindings(companyId, year);
  if (!findings.hasData) {
    return { findings, emailText: `No income tax return on file for ${findings.companyName} (${year}) to report on.` };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  const PROMPT = `You are writing a short, professional email on behalf of a company to its tax accountant about a filed income tax return. Use ONLY the findings below — do NOT invent any figure, issue, or fact not present. The numbers are already verified; your job is wording, not analysis.

Write the email:
- Start with a "Subject:" line.
- One-sentence opener (we reviewed the {year} {form} against our books).
- A brief "What ties out" line (one or two sentences, not a long list).
- A numbered list "Questions / items to confirm" — one per open question, each precise and polite, KEEPING the figures and the form-line references exactly as given.
- A short professional closing.
Keep it concise and businesslike. Plain text only (no markdown). Output ONLY the email.

FINDINGS:
${findingsToPrompt(findings)}`;

  const client = new Anthropic({ maxRetries: 4 });
  let text: string;
  try {
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: PROMPT }],
    });
    text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status;
    const type = (e as { error?: { error?: { type?: string } } })?.error?.error?.type;
    if ((typeof status === "number" && status >= 500) || type === "overloaded_error") {
      throw new Error(
        "AI service temporarily unavailable (Anthropic overloaded) — please try again in a few minutes.",
      );
    }
    throw e;
  }

  return { findings, emailText: text };
}

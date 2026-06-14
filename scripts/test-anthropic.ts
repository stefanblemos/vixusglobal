import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// Carrega o .env (tsx não faz isso sozinho).
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const key = process.env.ANTHROPIC_API_KEY;
console.log(
  "ANTHROPIC_API_KEY present:",
  !!key,
  key ? `(${key.length} chars, ${key.slice(0, 7)}…)` : "",
);
if (!key) {
  console.log("→ Add ANTHROPIC_API_KEY to .env and re-run.");
  process.exit(1);
}

async function main() {
  const client = new Anthropic();
  const r = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 50,
    messages: [{ role: "user", content: "Reply with exactly: VIXUS OK" }],
  });
  const text = r.content.find((b) => b.type === "text");
  console.log("API reply:", text && "text" in text ? text.text : "(no text)");
  console.log("✓ Key works. Model:", r.model);
}

main().catch((e) => {
  console.error("✗ API call failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

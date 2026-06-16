import { z } from "zod";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

export const ownershipCreateSchema = z
  .object({
    ownedCompanyId: z.string().min(1, "Invalid company"),
    // Owner reference in the form "party:<id>" or "company:<id>".
    owner: z.string().regex(/^(party|company):.+/, "Select an owner"),
    percentage: z.coerce
      .number()
      .gt(0, "Percentage must be greater than 0")
      .max(100, "Percentage cannot exceed 100"),
    shareClass: z.preprocess(emptyToNull, z.string().trim().nullable()),
    // Data de entrada do sócio (YYYY-MM-DD). Vazio = vigente desde sempre.
    effectiveDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  })
  .refine((d) => d.owner !== `company:${d.ownedCompanyId}`, {
    message: "A company cannot own itself",
    path: ["owner"],
  });

export type OwnershipCreateInput = z.infer<typeof ownershipCreateSchema>;

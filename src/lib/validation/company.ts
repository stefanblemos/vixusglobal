import { z } from "zod";
import { ALL_ENTITY_TYPE_VALUES, isEntityTypeValidFor } from "@/lib/catalog";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

export const companyCreateSchema = z
  .object({
    legalName: z.string().trim().min(1, "Legal name is required"),
    tradeName: z.preprocess(emptyToNull, z.string().trim().nullable()),
    // Comma-separated former/alternate names (for QBO matching).
    aliases: z.preprocess(
      (v) =>
        typeof v === "string"
          ? v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      z.array(z.string()),
    ),
    jurisdiction: z.enum(["US", "BR", "PT", "OTHER"]),
    state: z.preprocess(emptyToNull, z.string().trim().nullable()),
    entityType: z.enum(ALL_ENTITY_TYPE_VALUES),
    taxId: z.preprocess(emptyToNull, z.string().trim().nullable()),
    formationDate: z.preprocess(emptyToNull, z.string().trim().nullable()),
    closedDate: z.preprocess(emptyToNull, z.string().trim().nullable()),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    fiscalYearEnd: z
      .string()
      .regex(/^\d{2}-\d{2}$/, "Use the MM-DD format")
      .default("12-31"),
    baseCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Use the 3-letter ISO code (e.g. USD)")
      .default("USD"),
    relationship: z.enum(["GROUP_MEMBER", "MANAGED_ONLY"]),
    collectsSalesTax: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
    hasEmployees: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
    // Ausente (formulário sem o campo) = controlado por padrão; "false" explícito desliga.
    monitored: z.preprocess(
      (v) => (v === undefined || v === null ? true : v === "on" || v === "true" || v === true),
      z.boolean(),
    ),
    notes: z.preprocess(emptyToNull, z.string().trim().nullable()),
  })
  .refine((d) => isEntityTypeValidFor(d.jurisdiction, d.entityType), {
    message: "Entity type is not valid for the selected jurisdiction",
    path: ["entityType"],
  });

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

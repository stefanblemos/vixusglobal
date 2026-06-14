import { z } from "zod";
import { ALL_ENTITY_TYPE_VALUES, isEntityTypeValidFor } from "@/lib/catalog";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

export const companyCreateSchema = z
  .object({
    legalName: z.string().trim().min(1, "Razão social é obrigatória"),
    tradeName: z.preprocess(emptyToNull, z.string().trim().nullable()),
    jurisdiction: z.enum(["US", "BR", "PT", "OTHER"]),
    state: z.preprocess(emptyToNull, z.string().trim().nullable()),
    entityType: z.enum(ALL_ENTITY_TYPE_VALUES),
    taxId: z.preprocess(emptyToNull, z.string().trim().nullable()),
    fiscalYearEnd: z
      .string()
      .regex(/^\d{2}-\d{2}$/, "Use o formato MM-DD")
      .default("12-31"),
    baseCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Use o código ISO de 3 letras (ex.: USD)")
      .default("USD"),
    relationship: z.enum(["GROUP_MEMBER", "MANAGED_ONLY"]),
    notes: z.preprocess(emptyToNull, z.string().trim().nullable()),
  })
  .refine((d) => isEntityTypeValidFor(d.jurisdiction, d.entityType), {
    message: "Tipologia inválida para a jurisdição selecionada",
    path: ["entityType"],
  });

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

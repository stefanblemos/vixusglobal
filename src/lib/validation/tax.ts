import { z } from "zod";
import { ALL_ENTITY_TYPE_VALUES, ALL_TAX_TREATMENT_VALUES } from "@/lib/catalog";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

export const taxStatusSchema = z.object({
  year: z.coerce.number().int().min(1990, "Invalid year").max(2100, "Invalid year"),
  entityType: z.enum(ALL_ENTITY_TYPE_VALUES),
  taxTreatment: z.enum(ALL_TAX_TREATMENT_VALUES),
  notes: z.preprocess(emptyToNull, z.string().trim().nullable()),
});

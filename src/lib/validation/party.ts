import { z } from "zod";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

export const partyCreateSchema = z.object({
  kind: z.enum(["PERSON", "ENTITY"]),
  name: z.string().trim().min(1, "Nome é obrigatório"),
  taxJurisdiction: z.enum(["US", "BR", "PT", "OTHER"]).default("OTHER"),
  taxId: z.preprocess(emptyToNull, z.string().trim().nullable()),
  notes: z.preprocess(emptyToNull, z.string().trim().nullable()),
});

export type PartyCreateInput = z.infer<typeof partyCreateSchema>;

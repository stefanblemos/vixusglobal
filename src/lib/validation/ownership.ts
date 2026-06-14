import { z } from "zod";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

export const ownershipCreateSchema = z
  .object({
    ownedCompanyId: z.string().min(1, "Empresa inválida"),
    // Referência ao dono no formato "party:<id>" ou "company:<id>".
    owner: z.string().regex(/^(party|company):.+/, "Selecione um dono"),
    percentage: z.coerce
      .number()
      .gt(0, "O percentual deve ser maior que 0")
      .max(100, "O percentual não pode passar de 100"),
    shareClass: z.preprocess(emptyToNull, z.string().trim().nullable()),
  })
  .refine((d) => d.owner !== `company:${d.ownedCompanyId}`, {
    message: "Uma empresa não pode ser dona de si mesma",
    path: ["owner"],
  });

export type OwnershipCreateInput = z.infer<typeof ownershipCreateSchema>;

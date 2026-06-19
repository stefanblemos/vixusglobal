import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CompanyEditForm } from "@/components/company-edit-form";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href={`/companies/${id}`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← {company.legalName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Edit company</h1>
      </div>
      <CompanyEditForm
        company={{
          id: company.id,
          legalName: company.legalName,
          tradeName: company.tradeName,
          aliases: company.aliases,
          jurisdiction: company.jurisdiction,
          state: company.state,
          entityType: company.entityType,
          taxId: company.taxId,
          formationDate: company.formationDate,
          closedDate: company.closedDate,
          fiscalYearEnd: company.fiscalYearEnd,
          baseCurrency: company.baseCurrency,
          relationship: company.relationship,
          status: company.status,
          collectsSalesTax: company.collectsSalesTax,
          hasEmployees: company.hasEmployees,
          monitored: company.monitored,
          notes: company.notes,
        }}
      />
    </div>
  );
}

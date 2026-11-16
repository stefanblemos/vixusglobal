import { redirect } from "next/navigation";

export default async function InventoryIndex({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  redirect(`/inventory/invoices${company ? `?company=${company}` : ""}`);
}

import { Construction } from "lucide-react";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-16 text-center">
        <Construction className="mb-3 text-slate-300" size={40} />
        <p className="max-w-md text-sm text-slate-500">{description}</p>
        <span className="mt-3 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
          Coming soon
        </span>
      </div>
    </div>
  );
}

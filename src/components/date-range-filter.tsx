// Filtro de intervalo de datas reutilizável (form GET, sem JS de cliente).
// `hidden` preserva outros parâmetros da URL (ex.: company).
export function DateRangeFilter({
  hidden = {},
  from,
  to,
  clearHref,
}: {
  hidden?: Record<string, string | undefined>;
  from?: string;
  to?: string;
  clearHref?: string;
}) {
  const inputClass = "rounded-lg border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <form className="flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
        <input type="date" name="from" defaultValue={from} className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
        <input type="date" name="to" defaultValue={to} className={inputClass} />
      </div>
      <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
        Filter
      </button>
      {(from || to) && clearHref && (
        <a href={clearHref} className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-700">
          Clear
        </a>
      )}
    </form>
  );
}

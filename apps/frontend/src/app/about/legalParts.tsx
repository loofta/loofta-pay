import type { ReactNode } from "react";

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h3 className="mb-4 font-display text-2xl font-medium text-slate-100">{title}</h3>
      <div className="flex flex-col gap-4 text-lg leading-relaxed text-slate-400 [&_strong]:text-slate-200 [&_strong]:font-medium">
        {children}
      </div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

export function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-4">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-[12px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-base">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th className="p-4 text-left font-medium text-slate-100">Third Party</th>
            <th className="p-4 text-left font-medium text-slate-100">Purpose</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([party, purpose]) => (
            <tr key={party} className="border-b border-white/5 last:border-0">
              <td className="p-4 font-medium text-slate-300 whitespace-nowrap">{party}</td>
              <td className="p-4 text-slate-400">{purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

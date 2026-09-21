import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export default function Breadcrumbs({ items, dark = false }: { items: BreadcrumbItem[]; dark?: boolean }) {
  return (
    <nav aria-label="Breadcrumb" className={`mx-auto max-w-7xl px-5 pt-6 sm:px-8 lg:px-10 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
      <ol className="flex flex-wrap items-center gap-2 text-xs font-bold">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true" className={dark ? 'text-slate-600' : 'text-slate-300'}>/</span>}
            {item.href ? <Link href={item.href} className="transition hover:text-amber-300">{item.label}</Link> : <span aria-current="page" className={dark ? 'text-slate-200' : 'text-slate-900'}>{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

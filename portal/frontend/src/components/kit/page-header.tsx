import type { ReactNode } from 'react';

export type Crumb = { label: string; onClick?: () => void };

/** "Companies › Kerchanshe Coffee": where this page sits. The last item is the page itself. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="kit-crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} aria-current={last ? 'page' : undefined}>
              {item.onClick && !last ? (
                <button type="button" className="text-link" onClick={item.onClick}>
                  {item.label}
                </button>
              ) : (
                <span>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The top of a screen: breadcrumbs (on a detail page), a title, one plain sentence, the main actions on
 * the right and, under them, short facts about the thing (status chips, ids). Replaces `PageTitle` where a
 * screen needs more than a heading.
 */
export function PageHeader({
  eyebrow = 'DCC workspace',
  title,
  description,
  crumbs,
  actions,
  meta,
  tabs,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  meta?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className="kit-header">
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      <div className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
          {meta && <div className="kit-meta">{meta}</div>}
        </div>
        {actions && <div className="heading-actions">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}

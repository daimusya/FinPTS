import Link from "next/link";
import { pageHref, type PageWindow } from "@/lib/paging";

/** «← Новее · Страница 2 из 7 · Старее →» под списком; ничего, если страница одна. */
export function Pager({ window, basePath, params }: { window: PageWindow; basePath: string; params: Record<string, string | undefined> }) {
  if (window.pages <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
      {window.page > 1 ? (
        <Link href={pageHref(basePath, params, window.page - 1)} className="btn btn-secondary btn-sm">
          ← Новее
        </Link>
      ) : null}
      <span className="text-muted" style={{ fontSize: 12 }}>
        Страница {window.page} из {window.pages}
      </span>
      {window.page < window.pages ? (
        <Link href={pageHref(basePath, params, window.page + 1)} className="btn btn-secondary btn-sm">
          Старее →
        </Link>
      ) : null}
    </div>
  );
}

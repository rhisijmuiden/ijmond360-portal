import { ApiError, cx, get, put, Spinner, useSession } from "@portal/ui";
import { BellRing, CircleCheck, Info, Plus, Search, Star, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Tile } from "../components/Tile";
import { CalendarWidget, MailWidget, TvWidget } from "../components/Widgets";
import { iconFor } from "../icons";
import { pick, type Notice, type PortalApp, type PortalData, type Tab } from "../types";

export function usePortal() {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    get<PortalData>("/api/portal")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.code : "error"));
  }, []);
  useEffect(() => {
    load();
    // Status lights and notices change by themselves.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);
  return { data, setData, error, reload: load };
}

function greetingKey(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

const NOTICE_STYLE: Record<string, { box: string; icon: typeof Info }> = {
  info: { box: "border-[color-mix(in_srgb,var(--tvsm-info)_35%,transparent)] bg-[color-mix(in_srgb,var(--tvsm-info)_10%,var(--tvsm-surface))]", icon: BellRing },
  warning: { box: "border-warn/40 bg-[color-mix(in_srgb,var(--tvsm-warning)_12%,var(--tvsm-surface))]", icon: TriangleAlert },
  success: { box: "border-ok/35 bg-[color-mix(in_srgb,var(--tvsm-success)_10%,var(--tvsm-surface))]", icon: CircleCheck },
};

function Notices({ notices }: { notices: Notice[] }) {
  const { t, i18n } = useTranslation();
  const [hidden, setHidden] = useState<number[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("portal.notices.hidden") ?? "[]") as number[];
    } catch {
      return [];
    }
  });
  const hide = (id: number) => {
    const next = [...hidden, id];
    setHidden(next);
    try {
      sessionStorage.setItem("portal.notices.hidden", JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  const shown = notices.filter((n) => !hidden.includes(n.id));
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {shown.map((n) => {
        const s = NOTICE_STYLE[n.level] ?? NOTICE_STYLE.info!;
        const Icon = s.icon;
        return (
          <div key={n.id} className={cx("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", s.box)}>
            <Icon className="mt-0.5 size-5 shrink-0" style={{ color: n.level === "info" ? "var(--tvsm-info)" : n.level === "warning" ? "var(--tvsm-warning)" : "var(--tvsm-success)" }} />
            <p className="flex-1 whitespace-pre-line">{pick(i18n.language, n.textEn, n.textNl)}</p>
            <button type="button" onClick={() => hide(n.id)} className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t("portal.hideNotice")}>
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TabBar({ tabs, current }: { tabs: Tab[]; current: Tab }) {
  const { i18n, t } = useTranslation();
  const { user } = useSession();
  return (
    <nav aria-label={t("portal.tabs")} className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((tab) => {
        const Icon = iconFor(tab.icon);
        const active = tab.id === current.id;
        return (
          <Link
            key={tab.id}
            to={tab.isHome ? "/" : `/tab/${tab.id}`}
            aria-current={active ? "page" : undefined}
            className={cx(
              "-mb-px flex h-12 shrink-0 items-center gap-2 border-b-3 px-4 text-[15px] font-semibold transition",
              active ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg",
            )}
          >
            <Icon className="size-[18px]" />
            {pick(i18n.language, tab.nameEn, tab.nameNl)}
          </Link>
        );
      })}
      {user?.role === "admin" && (
        <Link to="/admin/apps" className="grid w-11 shrink-0 place-items-center text-muted hover:text-brand" title={t("portal.manageTabs")} aria-label={t("portal.manageTabs")}>
          <Plus className="size-[18px]" />
        </Link>
      )}
    </nav>
  );
}

/** Buttons of one tab, grouped by section (buttons without a section first). */
function TabApps({ data, tab, favorites, toggle }: { data: PortalData; tab: Tab; favorites: Set<number>; toggle: (id: number) => void }) {
  const { t, i18n } = useTranslation();
  const apps = data.apps.filter((a) => a.tabId === tab.id);
  const sections = data.sections.filter((s) => s.tabId === tab.id);
  const groups = [
    { id: 0, title: null as string | null, apps: apps.filter((a) => a.sectionId === null || !sections.some((s) => s.id === a.sectionId)) },
    ...sections.map((s) => ({ id: s.id, title: pick(i18n.language, s.nameEn, s.nameNl), apps: apps.filter((a) => a.sectionId === s.id) })),
  ].filter((g) => g.apps.length);
  if (!groups.length) return tab.isHome ? null : <p className="rounded-lg border border-dashed border-line p-10 text-center text-muted">{t("portal.emptyTab")}</p>;
  return (
    <div className="flex flex-col gap-7">
      {groups.map((g) => (
        <section key={g.id} className="flex flex-col gap-3">
          {g.title && <h2 className="font-display text-lg font-bold">{g.title}</h2>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
            {g.apps.map((a) => (
              <Tile key={a.id} app={a} favorite={favorites.has(a.id)} onToggleFavorite={() => toggle(a.id)} restricted={a.groups.length > 0} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatusSummary({ apps }: { apps: PortalApp[] }) {
  const { t } = useTranslation();
  const checked = apps.filter((a) => a.health && a.health.status !== "unknown");
  if (!checked.length) return null;
  const down = checked.filter((a) => a.health!.status === "down");
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm shadow-card">
      <span className={cx("size-2.5 rounded-full", down.length ? "bg-danger" : "bg-ok")} />
      <span className="font-semibold">{down.length ? t("portal.someDown", { count: down.length }) : t("portal.allUp")}</span>
      {down.length > 0 && <span className="text-muted">{down.map((a) => a.name).join(", ")}</span>}
    </div>
  );
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { id } = useParams();
  const { data, setData, error } = usePortal();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // "/" jumps to the search field.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const favorites = useMemo(() => new Set(data?.favorites ?? []), [data]);
  const toggle = (appId: number) => {
    if (!data) return;
    const next = favorites.has(appId) ? data.favorites.filter((x) => x !== appId) : [...data.favorites, appId];
    setData({ ...data, favorites: next });
    put<{ favorites: number[] }>("/api/portal/favorites", { appIds: next })
      .then((r) => setData((d) => (d ? { ...d, favorites: r.favorites } : d)))
      .catch(() => setData((d) => (d ? { ...d, favorites: data.favorites } : d)));
  };

  if (error) return <p className="text-danger">{t("portal.loadFailed")}</p>;
  if (!data)
    return (
      <div className="grid h-64 place-items-center">
        <Spinner />
      </div>
    );

  const home = data.tabs.find((x) => x.isHome) ?? data.tabs[0]!;
  const tab = (id && data.tabs.find((x) => x.id === Number(id))) || home;
  const isHome = tab.id === home.id;
  const q = query.trim().toLowerCase();
  const tabName = (tid: number) => {
    const x = data.tabs.find((y) => y.id === tid);
    return x ? pick(i18n.language, x.nameEn, x.nameNl) : "";
  };
  const results = q
    ? data.apps.filter((a) => [a.name, a.descriptionEn, a.descriptionNl, tabName(a.tabId), a.url].some((v) => v.toLowerCase().includes(q)))
    : [];
  const favApps = data.favorites.map((fid) => data.apps.find((a) => a.id === fid)).filter((a): a is PortalApp => !!a);
  const firstName = (user?.displayName || user?.username || "").split(/[\s@]/)[0];
  const showMail = data.settings.m365.mail;
  const showCal = data.settings.m365.calendar;
  const showTv = data.settings.tv.enabled;
  const widgets = [showMail, showCal, showTv].filter(Boolean).length;

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">
            {isHome ? new Date().toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" }) : t("portal.workplace")}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            {isHome ? t(`portal.greeting.${greetingKey()}`, { name: firstName }) : pick(i18n.language, tab.nameEn, tab.nameNl)}
          </h1>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          {!isHome && <StatusSummary apps={data.apps.filter((a) => a.tabId === tab.id)} />}
          <label className="flex h-12 w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-4 shadow-card focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/20 md:w-[420px]">
            <Search className="size-5 text-muted" aria-hidden />
            <span className="sr-only">{t("portal.search")}</span>
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && results[0]) window.open(results[0].url, results[0].newWindow ? "_blank" : "_self", "noopener");
              }}
              placeholder={t("portal.searchPlaceholder")}
              className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/80"
            />
            <kbd className="hidden rounded-sm border border-line px-1.5 font-mono text-xs text-muted md:block">/</kbd>
          </label>
        </div>
      </header>

      <TabBar tabs={data.tabs} current={tab} />
      <Notices notices={data.notices} />

      {q ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">{t("portal.results", { count: results.length, query })}</h2>
          {results.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              {results.map((a) => (
                <Tile key={a.id} app={a} favorite={favorites.has(a.id)} onToggleFavorite={() => toggle(a.id)} />
              ))}
            </div>
          ) : (
            <p className="text-muted">{t("portal.noResults")}</p>
          )}
        </section>
      ) : isHome ? (
        <>
          {widgets > 0 && (
            <div className={cx("grid gap-5", widgets === 1 ? "lg:grid-cols-2" : widgets === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3")}>
              {showMail && <MailWidget settings={data.settings.m365} signedIn={data.microsoft.signedIn} />}
              {showCal && <CalendarWidget settings={data.settings.m365} signedIn={data.microsoft.signedIn} />}
              {showTv && <TvWidget settings={data.settings.tv} />}
            </div>
          )}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Star className="size-5 text-warn" fill="currentColor" />
              <h2 className="font-display text-xl font-bold">{t("portal.favorites")}</h2>
              <span className="text-[13px] text-muted">{t("portal.favoritesHint")}</span>
            </div>
            {favApps.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {favApps.map((a) => (
                  <Tile key={a.id} app={a} variant="compact" favorite onToggleFavorite={() => toggle(a.id)} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{t("portal.noFavorites")}</p>
            )}
          </section>
          <TabApps data={data} tab={tab} favorites={favorites} toggle={toggle} />
        </>
      ) : (
        <TabApps data={data} tab={tab} favorites={favorites} toggle={toggle} />
      )}
    </div>
  );
}

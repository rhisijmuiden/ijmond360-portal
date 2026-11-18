import { cx } from "@portal/ui";
import { ExternalLink, Lock, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { iconFor, tileColor } from "../icons";
import { pick, type PortalApp } from "../types";

export function AppIcon({ app, size = "md" }: { app: Pick<PortalApp, "icon" | "color" | "logo" | "name">; size?: "sm" | "md" | "lg" }) {
  const c = tileColor(app.color);
  const Icon = iconFor(app.icon);
  const box = size === "lg" ? "size-13 rounded-lg" : size === "md" ? "size-12 rounded-lg" : "size-9 rounded-md";
  const ico = size === "sm" ? "size-[18px]" : "size-6";
  if (app.logo)
    return (
      <span className={cx("grid shrink-0 place-items-center overflow-hidden border border-line bg-white", box)}>
        <img src={app.logo} alt="" className="size-[78%] object-contain" />
      </span>
    );
  return (
    <span className={cx("grid shrink-0 place-items-center", box)} style={{ background: c.bg, color: c.fg }}>
      <Icon className={ico} />
    </span>
  );
}

export function StatusDot({ app }: { app: Pick<PortalApp, "health"> }) {
  const { t } = useTranslation();
  if (!app.health) return null;
  const s = app.health.status;
  const color = s === "up" ? "bg-ok" : s === "down" ? "bg-danger" : "bg-line";
  const label = t(`portal.health.${s}`);
  return (
    <span title={label} className="relative inline-flex size-2.5 shrink-0">
      {s === "down" && <span className="absolute inset-0 animate-ping rounded-full bg-danger/60" />}
      <span className={cx("relative size-2.5 rounded-full", color)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** One button: opens the app; the star sets it as favourite. */
export function Tile({
  app,
  favorite,
  onToggleFavorite,
  variant = "large",
  restricted,
}: {
  app: PortalApp;
  favorite: boolean;
  onToggleFavorite?: () => void;
  variant?: "large" | "compact";
  /** Admins see buttons limited to groups; mark them. */
  restricted?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const desc = pick(i18n.language, app.descriptionEn, app.descriptionNl);
  const target = app.newWindow ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <div className="group relative">
      <a
        href={app.url}
        {...target}
        className={cx(
          "flex h-full rounded-lg border border-line bg-surface shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand",
          variant === "large" ? "min-h-[150px] flex-col gap-3.5 p-5" : "min-h-[96px] items-start gap-3.5 p-4 pr-10",
        )}
      >
        <AppIcon app={app} size={variant === "large" ? "lg" : "md"} />
        <span className={cx("flex min-w-0 flex-col gap-1", variant === "large" && app.newWindow && "pr-6")}>
          <span className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <span className="truncate">{app.name}</span>
            <StatusDot app={app} />
            {restricted && <Lock className="size-3.5 text-muted" aria-label={t("portal.restricted")} />}
          </span>
          {desc && <span className="line-clamp-2 text-[13px] leading-snug text-muted">{desc}</span>}
        </span>
        {app.newWindow && variant === "large" && <ExternalLink className="absolute right-5 bottom-5 size-4 text-muted/60 transition group-hover:text-brand" aria-hidden />}
      </a>
      {onToggleFavorite && (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={t(favorite ? "portal.unfavorite" : "portal.favorite", { name: app.name })}
          title={t(favorite ? "portal.unfavorite" : "portal.favorite", { name: app.name })}
          className={cx(
            "absolute top-3 right-3 grid size-9 place-items-center rounded-md transition hover:bg-surface-2 focus-visible:opacity-100",
            favorite ? "text-warn" : "text-muted opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          <Star className="size-[18px]" fill={favorite ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}

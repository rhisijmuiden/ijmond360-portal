import { ApiError, cx, get, Spinner } from "@portal/ui";
import { CalendarDays, Mail, Tv, Video } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PublicSettings } from "../types";

function useLoad<T>(url: string | null, everyMs: number) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!url });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = () =>
      get<T>(url)
        .then((data) => alive && setState({ data, loading: false }))
        .catch((e) => alive && setState((s) => ({ ...s, error: e instanceof ApiError ? e.code : "error", loading: false })));
    void load();
    const timer = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url, everyMs]);
  return state;
}

function WidgetCard({ icon, title, badge, footer, dark, children }: { icon: ReactNode; title: string; badge?: ReactNode; footer?: ReactNode; dark?: boolean; children: ReactNode }) {
  return (
    <section className={cx("flex min-h-[300px] flex-col gap-3 rounded-lg border p-5 shadow-card", dark ? "border-transparent bg-sidebar text-white" : "border-line bg-surface")}>
      <header className="flex items-center gap-2.5">
        <span className={cx("grid size-9 place-items-center rounded-md", dark ? "bg-white/10" : "bg-brand/10 text-brand")}>{icon}</span>
        <h2 className="flex-1 font-display text-lg font-bold">{title}</h2>
        {badge}
      </header>
      <div className="flex flex-1 flex-col gap-1.5">{children}</div>
      {footer && <div className="pt-1">{footer}</div>}
    </section>
  );
}

const time = (iso: string | null, lang: string) => (iso ? new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) : "");
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function Problem({ code }: { code: string }) {
  const { t } = useTranslation();
  const reconnect = code === "microsoft_not_connected" || code === "microsoft_consent_missing";
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 text-sm text-muted">
      <p>{t(`portal.m365.errors.${code}`, { defaultValue: t("portal.m365.errors.generic") })}</p>
      {reconnect && (
        <a href="/api/auth/sso/login?returnTo=/" className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark">
          {t("portal.m365.reconnect")}
        </a>
      )}
    </div>
  );
}

interface MailData {
  unread: number;
  messages: { id: string; subject: string; from: string; receivedAt: string | null; unread: boolean; preview: string; link: string | null }[];
}
export function MailWidget({ settings, signedIn }: { settings: PublicSettings["m365"]; signedIn: boolean }) {
  const { t, i18n } = useTranslation();
  const { data, error, loading } = useLoad<MailData>(signedIn ? "/api/portal/m365/mail" : null, 120_000);
  return (
    <WidgetCard
      icon={<Mail className="size-5" />}
      title={t("portal.m365.mail")}
      badge={data && data.unread > 0 && <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">{t("portal.m365.unread", { count: data.unread })}</span>}
      footer={settings.outlookUrl && <a href={settings.outlookUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:text-brand-dark">{t("portal.m365.openOutlook")}</a>}
    >
      {!signedIn ? (
        <Problem code="microsoft_not_connected" />
      ) : loading ? (
        <div className="grid flex-1 place-items-center"><Spinner /></div>
      ) : error && !data ? (
        <Problem code={error} />
      ) : data && data.messages.length === 0 ? (
        <p className="flex flex-1 items-center text-sm text-muted">{t("portal.m365.noMail")}</p>
      ) : (
        data?.messages.slice(0, 5).map((m) => (
          <a
            key={m.id}
            href={m.link ?? settings.outlookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cx("flex flex-col gap-0.5 rounded-md px-2.5 py-2 transition hover:bg-surface-2", m.unread && "bg-bg")}
          >
            <span className="flex justify-between gap-3 text-[13px]">
              <span className={cx("truncate", m.unread ? "font-bold" : "font-medium")}>{m.from}</span>
              <span className="shrink-0 text-muted">{m.receivedAt && (isToday(m.receivedAt) ? time(m.receivedAt, i18n.language) : new Date(m.receivedAt).toLocaleDateString(i18n.language, { day: "numeric", month: "short" }))}</span>
            </span>
            <span className="truncate text-[13px] text-muted">{m.subject || t("portal.m365.noSubject")}</span>
          </a>
        ))
      )}
    </WidgetCard>
  );
}

interface CalendarData {
  events: { id: string; subject: string; start: string | null; end: string | null; allDay: boolean; location: string; joinUrl: string | null; link: string | null }[];
}
export function CalendarWidget({ settings, signedIn }: { settings: PublicSettings["m365"]; signedIn: boolean }) {
  const { t, i18n } = useTranslation();
  const [range] = useState(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  });
  const { data, error, loading } = useLoad<CalendarData>(signedIn ? `/api/portal/m365/calendar?${range}` : null, 300_000);
  const now = Date.now();
  return (
    <WidgetCard
      icon={<CalendarDays className="size-5" />}
      title={t("portal.m365.today")}
      footer={settings.calendarUrl && <a href={settings.calendarUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:text-brand-dark">{t("portal.m365.openCalendar")}</a>}
    >
      {!signedIn ? (
        <Problem code="microsoft_not_connected" />
      ) : loading ? (
        <div className="grid flex-1 place-items-center"><Spinner /></div>
      ) : error && !data ? (
        <Problem code={error} />
      ) : data && data.events.length === 0 ? (
        <p className="flex flex-1 items-center text-sm text-muted">{t("portal.m365.noEvents")}</p>
      ) : (
        data?.events.slice(0, 5).map((e) => {
          const past = !!e.end && Date.parse(e.end) < now;
          const live = !!e.start && !!e.end && Date.parse(e.start) <= now && Date.parse(e.end) > now;
          return (
            <div key={e.id} className={cx("flex gap-3 rounded-md bg-bg px-2.5 py-2", past && "opacity-55")}>
              <span className={cx("w-1 shrink-0 rounded-full", live ? "bg-onair" : "bg-brand")} />
              <a href={e.link ?? settings.calendarUrl} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-semibold">{e.subject || t("portal.m365.noSubject")}</span>
                <span className="truncate text-xs text-muted">
                  {e.allDay ? t("portal.m365.allDay") : `${time(e.start, i18n.language)} – ${time(e.end, i18n.language)}`}
                  {e.location && ` · ${e.location}`}
                </span>
              </a>
              {e.joinUrl && !past && (
                <a href={e.joinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 self-center rounded-md bg-brand px-2.5 text-xs font-semibold text-white hover:bg-brand-dark">
                  <Video className="size-3.5" />
                  {t("portal.m365.join")}
                </a>
              )}
            </div>
          );
        })
      )}
    </WidgetCard>
  );
}

interface TvData {
  channelName: string | null;
  now: { title: string; description: string | null; start: string; stop: string } | null;
  next: { title: string; start: string; stop: string } | null;
}
const isVideoFile = (u: string) => /\.(m3u8|mp4|webm)(\?|$)/i.test(u);

export function TvWidget({ settings }: { settings: PublicSettings["tv"] }) {
  const { t, i18n } = useTranslation();
  const { data, error, loading } = useLoad<TvData>("/api/portal/tv", 60_000);
  const progress = data?.now ? Math.min(100, Math.max(0, ((Date.now() - Date.parse(data.now.start)) / (Date.parse(data.now.stop) - Date.parse(data.now.start))) * 100)) : 0;
  return (
    <WidgetCard
      dark
      icon={<Tv className="size-5" />}
      title={t("portal.tv.title")}
      badge={
        data?.now && (
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-onair px-2 py-1 text-[11px] font-bold tracking-wider">
            <span className="size-1.5 animate-pulse rounded-full bg-white" />
            {t("portal.tv.live")}
          </span>
        )
      }
      footer={settings.linkUrl && <a href={settings.linkUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-white/80 hover:text-white">{t("portal.tv.open")}</a>}
    >
      {settings.streamUrl && (
        <div className="aspect-video overflow-hidden rounded-md border border-white/10 bg-black">
          {isVideoFile(settings.streamUrl) ? (
            <video src={settings.streamUrl} muted autoPlay playsInline controls className="size-full object-cover" />
          ) : (
            <iframe src={settings.streamUrl} title={t("portal.tv.preview")} allow="autoplay; fullscreen" sandbox="allow-scripts allow-same-origin allow-presentation" className="size-full border-0" />
          )}
        </div>
      )}
      {loading ? (
        <Spinner />
      ) : error && !data ? (
        <p className="text-sm text-white/70">{t("portal.tv.unavailable")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">{data?.now?.title ?? t("portal.tv.nothing")}</span>
          {data?.now && (
            <span className="mt-1 h-1 overflow-hidden rounded-full bg-white/15">
              <span className="block h-full rounded-full bg-onair" style={{ width: `${progress}%` }} />
            </span>
          )}
          {data?.next && (
            <span className="mt-1 text-[13px] text-sidebar-fg">
              {t("portal.tv.next", { title: data.next.title, time: time(data.next.start, i18n.language) })}
            </span>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

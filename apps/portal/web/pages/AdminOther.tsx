import { Alert, Badge, Button, Card, CardBody, CardHeader, del, Dialog, Field, Input, Mono, PageHeader, post, put, Select, Spinner, Switch, Textarea } from "@portal/ui";
import { CalendarClock, KeyRound, Mail, Megaphone, Pencil, Plus, Trash2, Tv, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { pick, type Group, type Notice, type PortalSettings } from "../types";
import { errorText, useAdmin } from "./AdminApps";

const Loading = () => (
  <div className="grid h-64 place-items-center">
    <Spinner />
  </div>
);

// ---- notices --------------------------------------------------------------------------------------------

/** datetime-local value (local time) <-> ISO string. */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function NoticeDialog({ notice, onClose, onSaved }: { notice: Notice | "new"; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const isNew = notice === "new";
  const [f, setF] = useState(() =>
    isNew ? { textNl: "", textEn: "", level: "info", startsAt: "", endsAt: "" } : { ...notice, startsAt: toLocal(notice.startsAt), endsAt: toLocal(notice.endsAt) },
  );
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const body = { textNl: f.textNl, textEn: f.textEn, level: f.level, startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt) };
    try {
      if (isNew) await post("/api/portal/admin/notices", body);
      else await put(`/api/portal/admin/notices/${notice.id}`, body);
      onSaved();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t("admin.newNotice") : t("admin.editNotice")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={!f.textNl.trim() && !f.textEn.trim()}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("admin.textNl")}>{(id) => <Textarea id={id} className="font-sans text-sm" maxLength={400} value={f.textNl} onChange={(e) => setF({ ...f, textNl: e.target.value })} />}</Field>
        <Field label={t("admin.textEn")} hint={t("admin.textEnHint")}>{(id) => <Textarea id={id} className="font-sans text-sm" maxLength={400} value={f.textEn} onChange={(e) => setF({ ...f, textEn: e.target.value })} />}</Field>
        <Field label={t("admin.level")}>
          {(id) => (
            <Select id={id} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
              {(["info", "warning", "success"] as const).map((l) => (
                <option key={l} value={l}>{t(`admin.levels.${l}`)}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.startsAt")} hint={t("admin.startsAtHint")}>{(id) => <Input id={id} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
          <Field label={t("admin.endsAt")} hint={t("admin.endsAtHint")}>{(id) => <Input id={id} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

export function AdminNoticesPage() {
  const { t, i18n } = useTranslation();
  const { data, reload } = useAdmin();
  const [edit, setEdit] = useState<Notice | "new" | null>(null);
  if (!data) return <Loading />;
  const now = Date.now();
  const state = (n: Notice) => (n.endsAt && Date.parse(n.endsAt) <= now ? "ended" : n.startsAt && Date.parse(n.startsAt) > now ? "planned" : "active");
  const tone = { active: "ok", planned: "brand", ended: "neutral" } as const;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }) : "–");
  return (
    <>
      <PageHeader title={t("admin.noticesTitle")} description={t("admin.noticesIntro")} actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>{t("admin.newNotice")}</Button>} />
      <Card>
        {data.notices.length === 0 && <CardBody className="text-center text-sm text-muted">{t("admin.noNotices")}</CardBody>}
        {data.notices.map((n) => (
          <div key={n.id} className="flex flex-wrap items-start gap-4 border-b border-line px-5 py-4 last:border-b-0">
            <Megaphone className="mt-0.5 size-5 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="text-sm whitespace-pre-line">{pick(i18n.language, n.textEn, n.textNl)}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <CalendarClock className="size-3.5" />
                {fmt(n.startsAt)} → {fmt(n.endsAt)}
                {n.createdBy && ` · ${n.createdBy}`}
              </p>
            </div>
            <Badge tone={tone[state(n)]}>{t(`admin.noticeState.${state(n)}`)}</Badge>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(n)} aria-label={t("admin.editNotice")} />
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-4" />}
                aria-label={t("common.delete")}
                onClick={async () => {
                  if (!confirm(t("admin.confirmDeleteNotice"))) return;
                  await del(`/api/portal/admin/notices/${n.id}`);
                  void reload();
                }}
              />
            </div>
          </div>
        ))}
      </Card>
      {edit && <NoticeDialog notice={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </>
  );
}

// ---- groups ---------------------------------------------------------------------------------------------

export function AdminGroupsPage() {
  const { t } = useTranslation();
  const { data, reload } = useAdmin();
  const [edit, setEdit] = useState<Group | "new" | null>(null);
  const [f, setF] = useState({ name: "", objectId: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setF(edit && edit !== "new" ? { name: edit.name, objectId: edit.objectId } : { name: "", objectId: "" });
    setError(null);
  }, [edit]);
  if (!data) return <Loading />;
  const used = (id: number) => [...data.tabs, ...data.apps].filter((x) => x.groups.includes(id)).length;
  const save = async () => {
    try {
      if (edit === "new") await post("/api/portal/admin/groups", f);
      else if (edit) await put(`/api/portal/admin/groups/${edit.id}`, f);
      setEdit(null);
      void reload();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <>
      <PageHeader title={t("admin.groupsTitle")} description={t("admin.groupsIntro")} actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>{t("admin.newGroup")}</Button>} />
      <Alert tone="brand" className="mb-5">{t("admin.groupsClaimHint")}</Alert>
      <Card>
        {data.groups.length === 0 && <CardBody className="text-center text-sm text-muted">{t("admin.noGroups")}</CardBody>}
        {data.groups.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
            <Users className="size-5 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{g.name}</p>
              <Mono>{g.objectId}</Mono>
            </div>
            <span className="text-xs text-muted">{t("admin.groupUsed", { count: used(g.id) })}</span>
            <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(g)} aria-label={t("admin.editGroup")} />
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              disabled={used(g.id) > 0}
              title={used(g.id) ? t("admin.errors.group_in_use") : undefined}
              aria-label={t("common.delete")}
              onClick={async () => {
                if (!confirm(t("admin.confirmDeleteGroup", { name: g.name }))) return;
                await del(`/api/portal/admin/groups/${g.id}`);
                void reload();
              }}
            />
          </div>
        ))}
      </Card>
      {edit && (
        <Dialog
          open
          onClose={() => setEdit(null)}
          title={edit === "new" ? t("admin.newGroup") : t("admin.editGroup")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>{t("common.cancel")}</Button>
              <Button onClick={save} disabled={!f.name.trim() || !f.objectId.trim()}>{t("common.save")}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label={t("admin.groupName")}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Techniek" />}</Field>
            <Field label={t("admin.objectId")} hint={t("admin.objectIdHint")}>
              {(id) => <Input id={id} className="font-mono" value={f.objectId} onChange={(e) => setF({ ...f, objectId: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" />}
            </Field>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---- settings -------------------------------------------------------------------------------------------

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const { data, reload } = useAdmin();
  const [f, setF] = useState<PortalSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setF(data.settings);
  }, [data]);
  if (!f) return <Loading />;
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await put("/api/portal/admin/settings", f);
      setSaved(true);
      void reload();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const m = (k: keyof PortalSettings["m365"], v: unknown) => setF({ ...f, m365: { ...f.m365, [k]: v } });
  const tv = (k: keyof PortalSettings["tv"], v: unknown) => setF({ ...f, tv: { ...f.tv, [k]: v } });
  return (
    <>
      <PageHeader title={t("admin.settingsTitle")} description={t("admin.settingsIntro")} actions={<Button onClick={save}>{t("common.save")}</Button>} />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {saved && <Alert tone="ok" className="mb-4">{t("admin.saved")}</Alert>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<KeyRound className="size-4" />} title={t("admin.general")} />
          <CardBody className="flex flex-col gap-4">
            <Field label={t("admin.portalTitle")}>{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
            <p className="text-sm text-muted">{t("admin.ssoHint")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Mail className="size-4" />} title={t("admin.m365Title")} description={t("admin.m365Intro")} />
          <CardBody className="flex flex-col gap-4">
            <Switch checked={f.m365.mail} onChange={(v) => m("mail", v)} label={t("admin.showMail")} />
            <Switch checked={f.m365.calendar} onChange={(v) => m("calendar", v)} label={t("admin.showCalendar")} />
            <Field label={t("admin.outlookUrl")}>{(id) => <Input id={id} type="url" value={f.m365.outlookUrl} onChange={(e) => m("outlookUrl", e.target.value)} />}</Field>
            <Field label={t("admin.calendarUrl")}>{(id) => <Input id={id} type="url" value={f.m365.calendarUrl} onChange={(e) => m("calendarUrl", e.target.value)} />}</Field>
            <Alert tone="neutral">{t("admin.m365Consent")}</Alert>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader icon={<Tv className="size-4" />} title={t("admin.tvTitle")} description={t("admin.tvIntro")} />
          <CardBody className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Switch checked={f.tv.enabled} onChange={(v) => tv("enabled", v)} label={t("admin.tvEnabled")} />
            </div>
            <Field label={t("admin.xmltvUrl")} hint={t("admin.xmltvHint")}>{(id) => <Input id={id} type="url" value={f.tv.xmltvUrl} onChange={(e) => tv("xmltvUrl", e.target.value)} placeholder="https://tv.ijmond360.loc/epg/xmltv.xml?token=…" />}</Field>
            <Field label={t("admin.tvChannel")} hint={t("admin.tvChannelHint")}>{(id) => <Input id={id} value={f.tv.channel} onChange={(e) => tv("channel", e.target.value)} placeholder="tvsm.1" />}</Field>
            <Field label={t("admin.streamUrl")} hint={t("admin.streamUrlHint")}>{(id) => <Input id={id} type="url" value={f.tv.streamUrl} onChange={(e) => tv("streamUrl", e.target.value)} />}</Field>
            <Field label={t("admin.tvLink")} hint={t("admin.tvLinkHint")}>{(id) => <Input id={id} type="url" value={f.tv.linkUrl} onChange={(e) => tv("linkUrl", e.target.value)} />}</Field>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

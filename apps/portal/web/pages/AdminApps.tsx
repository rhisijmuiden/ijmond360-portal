import { Alert, ApiError, Button, Card, cx, del, Dialog, Field, get, Input, PageHeader, post, put, Select, Spinner, Switch } from "@portal/ui";
import { FolderPlus, GripVertical, ImageUp, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { ColorPicker, GroupPicker, IconPicker } from "../components/Pickers";
import { AppIcon, Tile } from "../components/Tile";
import { iconFor } from "../icons";
import { pick, type AdminData, type PortalApp, type Section, type Tab } from "../types";

export function useAdmin() {
  const [data, setData] = useState<AdminData | null>(null);
  const reload = useCallback(() => get<AdminData>("/api/portal/admin").then(setData), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, reload };
}

export const errorText = (t: (k: string, o?: Record<string, unknown>) => string, e: unknown) =>
  e instanceof ApiError ? t(`admin.errors.${e.code}`, { defaultValue: e.message }) : String(e);

// ---- tab dialog -----------------------------------------------------------------------------------------

function TabDialog({ tab, data, onClose, onSaved }: { tab: Tab | "new"; data: AdminData; onClose: () => void; onSaved: (id?: number) => void }) {
  const { t } = useTranslation();
  const isNew = tab === "new";
  const [f, setF] = useState(() => (isNew ? { nameEn: "", nameNl: "", icon: "layout-grid", groups: [] as number[] } : { nameEn: tab.nameEn, nameNl: tab.nameNl, icon: tab.icon, groups: tab.groups }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = isNew ? await post<Tab>("/api/portal/admin/tabs", f) : await put<Tab>(`/api/portal/admin/tabs/${tab.id}`, f);
      onSaved(r.id);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (isNew || !confirm(t("admin.confirmDeleteTab"))) return;
    await del(`/api/portal/admin/tabs/${tab.id}`);
    onSaved();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t("admin.newTab") : t("admin.editTab")}
      footer={
        <>
          {!isNew && !tab.isHome && (
            <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={remove}>
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={busy} onClick={save} disabled={!f.nameEn.trim() && !f.nameNl.trim()}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.nameNl")}>{(id) => <Input id={id} value={f.nameNl} onChange={(e) => setF({ ...f, nameNl: e.target.value })} placeholder="Televisie" />}</Field>
          <Field label={t("admin.nameEn")}>{(id) => <Input id={id} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} placeholder="Television" />}</Field>
        </div>
        <Field label={t("admin.icon")}>{() => <IconPicker value={f.icon} onChange={(icon) => setF({ ...f, icon })} />}</Field>
        {!(tab !== "new" && tab.isHome) && <Field label={t("admin.whoSees")}>{() => <GroupPicker groups={data.groups} value={f.groups} onChange={(groups) => setF({ ...f, groups })} />}</Field>}
      </div>
    </Dialog>
  );
}

// ---- section dialog -------------------------------------------------------------------------------------

function SectionDialog({ section, tabId, onClose, onSaved }: { section: Section | "new"; tabId: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const isNew = section === "new";
  const [f, setF] = useState(() => (isNew ? { nameEn: "", nameNl: "" } : { nameEn: section.nameEn, nameNl: section.nameNl }));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      // The English name is required by the API; fall back to the Dutch one.
      const body = { nameEn: f.nameEn.trim() || f.nameNl, nameNl: f.nameNl };
      if (isNew) await post("/api/portal/admin/sections", { ...body, tabId });
      else await put(`/api/portal/admin/sections/${section.id}`, body);
      onSaved();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const remove = async () => {
    if (isNew || !confirm(t("admin.confirmDeleteSection"))) return;
    await del(`/api/portal/admin/sections/${section.id}`);
    onSaved();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t("admin.newSection") : t("admin.editSection")}
      footer={
        <>
          {!isNew && (
            <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={remove}>
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={!f.nameEn.trim() && !f.nameNl.trim()}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm text-muted">{t("admin.sectionHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.nameNl")}>{(id) => <Input id={id} value={f.nameNl} onChange={(e) => setF({ ...f, nameNl: e.target.value })} placeholder="Uitzending" />}</Field>
          <Field label={t("admin.nameEn")}>{(id) => <Input id={id} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} placeholder="Broadcast" />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

// ---- app (button) dialog --------------------------------------------------------------------------------

type AppForm = Omit<PortalApp, "id" | "logo" | "sort" | "health"> & { healthUrl: string };
const emptyApp = (tabId: number, sectionId: number | null): AppForm => ({
  tabId,
  sectionId,
  name: "",
  descriptionEn: "",
  descriptionNl: "",
  url: "https://",
  icon: "app-window",
  color: "purple",
  newWindow: true,
  checkHealth: true,
  healthUrl: "",
  groups: [],
});

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

function AppDialog({ app, data, defaults, onClose, onSaved }: { app: PortalApp | "new"; data: AdminData; defaults: { tabId: number; sectionId: number | null }; onClose: () => void; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const isNew = app === "new";
  const [f, setF] = useState<AppForm>(() => (isNew ? emptyApp(defaults.tabId, defaults.sectionId) : { ...app, healthUrl: app.healthUrl ?? "" }));
  const [logo, setLogo] = useState<string | null>(isNew ? null : app.logo);
  const [newLogo, setNewLogo] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof AppForm>(k: K, v: AppForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const sections = data.sections.filter((s) => s.tabId === f.tabId);

  const pickLogo = async (fl?: File) => {
    if (!fl) return;
    if (fl.size > 1_000_000) return setError(t("admin.errors.logo_too_large"));
    const url = await readFile(fl);
    setNewLogo(url);
    setLogo(url);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, sectionId: sections.some((s) => s.id === f.sectionId) ? f.sectionId : null };
      const saved = isNew ? await post<PortalApp>("/api/portal/admin/apps", body) : await put<PortalApp>(`/api/portal/admin/apps/${app.id}`, body);
      if (newLogo) await post(`/api/portal/admin/apps/${saved.id}/logo`, { dataUrl: newLogo });
      else if (newLogo === null && !isNew) await del(`/api/portal/admin/apps/${saved.id}/logo`);
      onSaved();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (isNew || !confirm(t("admin.confirmDeleteApp", { name: app.name }))) return;
    await del(`/api/portal/admin/apps/${app.id}`);
    onSaved();
  };
  const preview: PortalApp = { ...f, id: 0, sort: 0, logo, health: f.checkHealth ? { status: "up", httpStatus: 200, latencyMs: 20, checkedAt: null } : null };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={isNew ? t("admin.newApp") : t("admin.editApp")}
      footer={
        <>
          {!isNew && (
            <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={remove}>
              {t("common.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={busy} onClick={save} disabled={!f.name.trim() || f.url.length < 10}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label={t("admin.appName")}>{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="TV Planning" autoFocus />}</Field>
          <Field label={t("admin.link")} hint={t("admin.linkHint")}>{(id) => <Input id={id} type="url" value={f.url} onChange={(e) => set("url", e.target.value)} />}</Field>
          <Field label={t("admin.descriptionNl")}>{(id) => <Input id={id} value={f.descriptionNl} maxLength={240} onChange={(e) => set("descriptionNl", e.target.value)} placeholder={t("admin.descriptionPlaceholder")} />}</Field>
          <Field label={t("admin.descriptionEn")}>{(id) => <Input id={id} value={f.descriptionEn} maxLength={240} onChange={(e) => set("descriptionEn", e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("admin.tab")}>
              {(id) => (
                <Select id={id} value={f.tabId} onChange={(e) => setF((x) => ({ ...x, tabId: Number(e.target.value), sectionId: null }))}>
                  {data.tabs.map((tb) => (
                    <option key={tb.id} value={tb.id}>{pick(i18n.language, tb.nameEn, tb.nameNl)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("admin.section")}>
              {(id) => (
                <Select id={id} value={f.sectionId ?? ""} onChange={(e) => set("sectionId", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{t("admin.noSection")}</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{pick(i18n.language, s.nameEn, s.nameNl)}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label={t("admin.color")}>{() => <ColorPicker value={f.color} onChange={(c) => set("color", c)} />}</Field>
          <Field label={t("admin.icon")} hint={t("admin.iconHint")}>{() => <IconPicker value={f.icon} onChange={(v) => set("icon", v)} />}</Field>
          <Field label={t("admin.whoSees")}>{() => <GroupPicker groups={data.groups} value={f.groups} onChange={(g) => set("groups", g)} />}</Field>
          <Switch checked={f.newWindow} onChange={(v) => set("newWindow", v)} label={t("admin.newWindow")} />
          <Switch checked={f.checkHealth} onChange={(v) => set("checkHealth", v)} label={t("admin.checkHealth")} description={t("admin.checkHealthHint")} />
          {f.checkHealth && (
            <Field label={t("admin.healthUrl")} hint={t("admin.healthUrlHint")}>
              {(id) => <Input id={id} type="url" value={f.healthUrl} onChange={(e) => set("healthUrl", e.target.value)} placeholder={f.url} />}
            </Field>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          <div className="rounded-lg bg-bg p-4">
            <p className="mb-2 text-xs font-semibold text-muted">{t("admin.preview")}</p>
            <div className="pointer-events-none">
              <Tile app={preview} favorite={false} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium">{t("admin.logo")}</p>
            <div className="flex items-center gap-3">
              <AppIcon app={{ ...f, logo }} />
              <input ref={file} type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" className="hidden" onChange={(e) => void pickLogo(e.target.files?.[0])} />
              <Button size="sm" variant="secondary" icon={<ImageUp className="size-4" />} onClick={() => file.current?.click()}>{t("admin.uploadLogo")}</Button>
              {logo && (
                <Button size="sm" variant="ghost" onClick={() => { setLogo(null); setNewLogo(null); }}>{t("admin.removeLogo")}</Button>
              )}
            </div>
            <p className="text-xs text-muted">{t("admin.logoHint")}</p>
          </div>
        </aside>
      </div>
    </Dialog>
  );
}

// ---- page ---------------------------------------------------------------------------------------------

type Drag = { kind: "tab"; id: number } | { kind: "app"; id: number };

export function AdminAppsPage() {
  const { t, i18n } = useTranslation();
  const { data, reload } = useAdmin();
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabDialog, setTabDialog] = useState<Tab | "new" | null>(null);
  const [sectionDialog, setSectionDialog] = useState<Section | "new" | null>(null);
  const [appDialog, setAppDialog] = useState<{ app: PortalApp | "new"; sectionId: number | null } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data)
    return (
      <div className="grid h-64 place-items-center">
        <Spinner />
      </div>
    );
  const tab = data.tabs.find((x) => x.id === tabId) ?? data.tabs[0]!;
  const sections = data.sections.filter((s) => s.tabId === tab.id);
  const apps = data.apps.filter((a) => a.tabId === tab.id);
  const groupsOf = (sid: number | null) => apps.filter((a) => (sid === null ? a.sectionId === null || !sections.some((s) => s.id === a.sectionId) : a.sectionId === sid));
  const blocks = [{ section: null as Section | null }, ...sections.map((s) => ({ section: s }))];
  const groupName = (ids: number[]) => ids.map((id) => data.groups.find((g) => g.id === id)?.name).filter(Boolean).join(", ");

  const dropTab = async (targetId: number) => {
    if (drag?.kind !== "tab" || drag.id === targetId) return;
    const order = data.tabs.filter((x) => !x.isHome).map((x) => x.id).filter((id) => id !== drag.id);
    order.splice(order.indexOf(targetId), 0, drag.id);
    await put("/api/portal/admin/tabs-order", { order }).catch((e) => setError(errorText(t, e)));
    void reload();
  };
  /** Drop a button before another one (`beforeId`) or at the end of a section. */
  const dropApp = async (sectionId: number | null, beforeId: number | null) => {
    if (drag?.kind !== "app") return;
    const items = blocks.flatMap((b) => groupsOf(b.section?.id ?? null).map((a) => ({ id: a.id, sectionId: b.section?.id ?? null })));
    const moving = items.find((i) => i.id === drag.id);
    if (!moving || drag.id === beforeId) return;
    const rest = items.filter((i) => i.id !== drag.id);
    const item = { id: drag.id, sectionId };
    let at = beforeId !== null ? rest.findIndex((i) => i.id === beforeId) : -1;
    if (at < 0) {
      // End of the section: after its last button, or after the buttons of the sections above it.
      const blockIdx = blocks.findIndex((b) => (b.section?.id ?? null) === sectionId);
      const before = new Set(blocks.slice(0, blockIdx + 1).map((b) => b.section?.id ?? null));
      at = rest.filter((i) => before.has(i.sectionId)).length;
    }
    rest.splice(at, 0, item);
    await put("/api/portal/admin/apps-order", { tabId: tab.id, items: rest }).catch((e) => setError(errorText(t, e)));
    void reload();
  };
  const moveSection = async (id: number, dir: -1 | 1) => {
    const order = sections.map((s) => s.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    await put("/api/portal/admin/sections-order", { tabId: tab.id, order });
    void reload();
  };
  const dragProps = (d: Drag) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(d.id));
      setDrag(d);
    },
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
  });
  const dropZone = (key: string, onDrop: () => void, accepts: Drag["kind"]) => ({
    onDragOver: (e: DragEvent) => {
      if (drag?.kind !== accepts) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      void onDrop();
    },
  });

  return (
    <div data-wide-page>
      <PageHeader
        title={t("admin.appsTitle")}
        description={t("admin.appsIntro")}
        actions={
          <>
            <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setTabDialog("new")}>{t("admin.newTab")}</Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setAppDialog({ app: "new", sectionId: null })}>{t("admin.newApp")}</Button>
          </>
        }
      />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="grid items-start gap-5 lg:grid-cols-[240px_1fr]">
        <Card className="p-2">
          <p className="px-2.5 py-1.5 text-xs font-semibold text-muted">{t("admin.tabs")}</p>
          {data.tabs.map((x) => {
            const Icon = iconFor(x.icon);
            return (
              <div
                key={x.id}
                {...(!x.isHome ? dragProps({ kind: "tab", id: x.id }) : {})}
                {...(!x.isHome ? dropZone(`tab-${x.id}`, () => dropTab(x.id), "tab") : {})}
                className={cx("group flex items-center gap-1 rounded-md", over === `tab-${x.id}` && "ring-2 ring-brand")}
              >
                <button
                  type="button"
                  onClick={() => setTabId(x.id)}
                  className={cx("flex h-11 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-semibold", x.id === tab.id ? "bg-brand/10 text-brand" : "hover:bg-surface-2")}
                >
                  {x.isHome ? <span className="w-3.5" /> : <GripVertical className="size-3.5 cursor-grab text-muted" />}
                  <Icon className="size-4" />
                  <span className="flex-1 truncate">{pick(i18n.language, x.nameEn, x.nameNl)}</span>
                  {x.groups.length > 0 && <Lock className="size-3.5 text-muted" />}
                  <span className="text-xs font-medium text-muted">{data.apps.filter((a) => a.tabId === x.id).length}</span>
                </button>
                <button type="button" onClick={() => setTabDialog(x)} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label={t("admin.editTab")}>
                  <Pencil className="size-3.5" />
                </button>
              </div>
            );
          })}
        </Card>

        <Card>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="text-[15px] font-bold">{pick(i18n.language, tab.nameEn, tab.nameNl)}</h2>
            <Button size="sm" variant="secondary" icon={<FolderPlus className="size-4" />} onClick={() => setSectionDialog("new")}>{t("admin.newSection")}</Button>
          </header>
          {blocks.map(({ section }, bi) => {
            const list = groupsOf(section?.id ?? null);
            if (!section && !list.length && sections.length) return null;
            const key = `sec-${section?.id ?? "none"}`;
            return (
              <div key={key} className="border-b border-line last:border-b-0">
                <div {...dropZone(key, () => dropApp(section?.id ?? null, null), "app")} className={cx("flex items-center gap-2 bg-bg/60 px-5 py-2", over === key && "bg-brand/10")}>
                  <span className="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">{section ? pick(i18n.language, section.nameEn, section.nameNl) : t("admin.noSection")}</span>
                  {section && (
                    <>
                      <button type="button" disabled={bi <= 1} onClick={() => moveSection(section.id, -1)} className="rounded-sm px-1.5 text-muted hover:text-fg disabled:opacity-30" aria-label={t("admin.moveUp")}>↑</button>
                      <button type="button" disabled={bi === blocks.length - 1} onClick={() => moveSection(section.id, 1)} className="rounded-sm px-1.5 text-muted hover:text-fg disabled:opacity-30" aria-label={t("admin.moveDown")}>↓</button>
                      <button type="button" onClick={() => setSectionDialog(section)} className="rounded-sm p-1 text-muted hover:text-fg" aria-label={t("admin.editSection")}><Pencil className="size-3.5" /></button>
                    </>
                  )}
                  <button type="button" onClick={() => setAppDialog({ app: "new", sectionId: section?.id ?? null })} className="rounded-sm p-1 text-muted hover:text-brand" aria-label={t("admin.newApp")}><Plus className="size-4" /></button>
                </div>
                {list.length === 0 && <p className="px-5 py-4 text-sm text-muted">{t("admin.dropHere")}</p>}
                {list.map((a) => (
                  <div
                    key={a.id}
                    {...dragProps({ kind: "app", id: a.id })}
                    {...dropZone(`app-${a.id}`, () => dropApp(section?.id ?? null, a.id), "app")}
                    className={cx("flex items-center gap-3 border-t border-line/60 px-5 py-2.5 transition", over === `app-${a.id}` && "border-t-2 border-t-brand", drag?.kind === "app" && drag.id === a.id && "opacity-40")}
                  >
                    <GripVertical className="size-4 shrink-0 cursor-grab text-muted" />
                    <AppIcon app={a} size="sm" />
                    <button type="button" onClick={() => setAppDialog({ app: a, sectionId: a.sectionId })} className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate text-sm font-semibold">{a.name}</span>
                      <span className="truncate font-mono text-xs text-muted">{a.url}</span>
                    </button>
                    {a.health && (
                      <span className={cx("hidden size-2.5 rounded-full sm:block", a.health.status === "up" ? "bg-ok" : a.health.status === "down" ? "bg-danger" : "bg-line")} title={t(`portal.health.${a.health.status}`)} />
                    )}
                    <span className={cx("hidden rounded-full px-2.5 py-0.5 text-xs font-semibold md:inline", a.groups.length ? "bg-warn/15 text-warn" : "bg-ok/12 text-ok")}>
                      {a.groups.length ? groupName(a.groups) : t("admin.everyone")}
                    </span>
                    <button type="button" onClick={() => setAppDialog({ app: a, sectionId: a.sectionId })} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label={t("admin.editApp")}>
                      <Pencil className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
          {!apps.length && !sections.length && <p className="p-8 text-center text-sm text-muted">{t("admin.emptyTab")}</p>}
        </Card>
      </div>

      {tabDialog && (
        <TabDialog
          tab={tabDialog}
          data={data}
          onClose={() => setTabDialog(null)}
          onSaved={(id) => {
            setTabDialog(null);
            if (id) setTabId(id);
            else setTabId(null);
            void reload();
          }}
        />
      )}
      {sectionDialog && (
        <SectionDialog
          section={sectionDialog}
          tabId={tab.id}
          onClose={() => setSectionDialog(null)}
          onSaved={() => {
            setSectionDialog(null);
            void reload();
          }}
        />
      )}
      {appDialog && (
        <AppDialog
          app={appDialog.app}
          data={data}
          defaults={{ tabId: tab.id, sectionId: appDialog.sectionId }}
          onClose={() => setAppDialog(null)}
          onSaved={() => {
            setAppDialog(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

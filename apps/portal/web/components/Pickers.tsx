import { cx, Input } from "@portal/ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ICONS, TILE_COLORS, type TileColor } from "../icons";
import type { Group } from "../types";

export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const names = Object.keys(ICONS).filter((n) => n.includes(q.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.searchIcon")} className="h-9" />
      <div className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1 overflow-y-auto rounded-md border border-line p-1.5">
        {names.map((n) => {
          const Icon = ICONS[n]!;
          return (
            <button
              key={n}
              type="button"
              title={n}
              aria-label={n}
              aria-pressed={value === n}
              onClick={() => onChange(n)}
              className={cx("grid h-10 place-items-center rounded-md transition", value === n ? "bg-brand text-white" : "text-muted hover:bg-surface-2 hover:text-fg")}
            >
              <Icon className="size-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: TileColor) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(TILE_COLORS) as TileColor[]).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={t(`admin.colors.${c}`)}
          title={t(`admin.colors.${c}`)}
          aria-pressed={value === c}
          className={cx("grid size-9 place-items-center rounded-md ring-offset-2 ring-offset-surface transition", value === c && "ring-2 ring-brand")}
          style={{ background: TILE_COLORS[c].swatch }}
        >
          {value === c && <Check className="size-4 text-white" />}
        </button>
      ))}
    </div>
  );
}

/** Who may see an item: nobody ticked = everyone. */
export function GroupPicker({ groups, value, onChange }: { groups: Group[]; value: number[]; onChange: (v: number[]) => void }) {
  const { t } = useTranslation();
  if (!groups.length) return <p className="text-xs text-muted">{t("admin.noGroupsYet")}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2.5 text-sm">
        <input type="radio" checked={value.length === 0} onChange={() => onChange([])} className="size-4 accent-[var(--tvsm-primary)]" />
        {t("admin.everyone")}
      </label>
      {groups.map((g) => (
        <label key={g.id} className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={value.includes(g.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((x) => x !== g.id))}
            className="size-4 accent-[var(--tvsm-primary)]"
          />
          {g.name}
        </label>
      ))}
    </div>
  );
}

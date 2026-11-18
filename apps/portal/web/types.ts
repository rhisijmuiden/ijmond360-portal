export interface Tab {
  id: number;
  nameEn: string;
  nameNl: string;
  icon: string;
  groups: number[];
  isHome: boolean;
  sort: number;
}
export interface Section {
  id: number;
  tabId: number;
  nameEn: string;
  nameNl: string;
  sort: number;
}
export interface PortalApp {
  id: number;
  tabId: number;
  sectionId: number | null;
  name: string;
  descriptionEn: string;
  descriptionNl: string;
  url: string;
  icon: string;
  color: string;
  logo: string | null;
  newWindow: boolean;
  checkHealth: boolean;
  healthUrl?: string;
  groups: number[];
  sort: number;
  health: { status: "up" | "down" | "unknown"; httpStatus: number | null; latencyMs: number | null; checkedAt: string | null } | null;
}
export interface Notice {
  id: number;
  textEn: string;
  textNl: string;
  level: "info" | "warning" | "success";
  startsAt: string | null;
  endsAt: string | null;
  createdBy?: string | null;
}
export interface Group {
  id: number;
  name: string;
  objectId: string;
}
export interface PublicSettings {
  title: string;
  m365: { mail: boolean; calendar: boolean; outlookUrl: string; calendarUrl: string };
  tv: { enabled: boolean; streamUrl: string; linkUrl: string };
}
export interface PortalSettings {
  title: string;
  m365: { mail: boolean; calendar: boolean; outlookUrl: string; calendarUrl: string };
  tv: { enabled: boolean; xmltvUrl: string; channel: string; streamUrl: string; linkUrl: string };
}
export interface PortalData {
  settings: PublicSettings;
  tabs: Tab[];
  sections: Section[];
  apps: PortalApp[];
  favorites: number[];
  notices: Notice[];
  microsoft: { signedIn: boolean };
}
export interface AdminData {
  settings: PortalSettings;
  tabs: Tab[];
  sections: Section[];
  apps: PortalApp[];
  groups: Group[];
  notices: Notice[];
}

/** Text in the UI language, falling back to the other one. */
export const pick = (lang: string, en: string, nl: string) => (lang.startsWith("nl") ? nl || en : en || nl);

import {
  Activity, AppWindow, Bell, BookOpen, Briefcase, Building2, Calendar, CalendarDays, Camera, Car, Cast, ChartLine, Clapperboard, ClipboardList, Cloud,
  Coffee, Database, Euro, Facebook, FileText, Film, Folder, Globe, GraduationCap, HardDrive, Headphones, Heart, House, Image, Instagram, KeyRound,
  LayoutDashboard, LayoutGrid, LifeBuoy, Link, Lock, Mail, Map, Megaphone, MessageSquare, Mic, Monitor, Music, Network, Newspaper, Phone, Play,
  Podcast, Printer, Radio, RadioTower, Receipt, Rss, SatelliteDish, Server, Share2, ShieldCheck, Signal, SlidersHorizontal, Star, Text, Ticket,
  ToggleRight, Truck, Tv, TvMinimalPlay, Users, Video, Wifi, Wrench, Youtube, Zap,
  type LucideIcon,
} from "lucide-react";

/** Icons an admin can pick for a tab or button (stored by name). */
export const ICONS: Record<string, LucideIcon> = {
  "app-window": AppWindow, "layout-grid": LayoutGrid, house: House, "layout-dashboard": LayoutDashboard,
  tv: Tv, "tv-minimal-play": TvMinimalPlay, clapperboard: Clapperboard, film: Film, video: Video, camera: Camera, cast: Cast, play: Play,
  radio: Radio, "radio-tower": RadioTower, mic: Mic, headphones: Headphones, music: Music, podcast: Podcast, "satellite-dish": SatelliteDish, signal: Signal,
  globe: Globe, rss: Rss, newspaper: Newspaper, text: Text, megaphone: Megaphone, "share-2": Share2, youtube: Youtube, facebook: Facebook, instagram: Instagram,
  mail: Mail, calendar: Calendar, "calendar-days": CalendarDays, "message-square": MessageSquare, phone: Phone, users: Users,
  folder: Folder, "file-text": FileText, image: Image, "book-open": BookOpen, "clipboard-list": ClipboardList, briefcase: Briefcase, "graduation-cap": GraduationCap,
  "chart-line": ChartLine, activity: Activity, server: Server, network: Network, database: Database, "hard-drive": HardDrive, cloud: Cloud, wifi: Wifi,
  monitor: Monitor, printer: Printer, "sliders-horizontal": SlidersHorizontal, "toggle-right": ToggleRight, wrench: Wrench, "life-buoy": LifeBuoy,
  "shield-check": ShieldCheck, lock: Lock, "key-round": KeyRound, link: Link, building: Building2, map: Map, car: Car, truck: Truck,
  euro: Euro, receipt: Receipt, ticket: Ticket, coffee: Coffee, heart: Heart, star: Star, bell: Bell, zap: Zap,
};

export const iconFor = (name: string): LucideIcon => ICONS[name] ?? AppWindow;

/** Tile colours from the house style tokens (dark mode follows the tokens). */
export const TILE_COLORS = {
  purple: { bg: "color-mix(in srgb, var(--tvsm-primary) 13%, transparent)", fg: "var(--tvsm-primary)", swatch: "var(--tvsm-primary)" },
  pink: { bg: "color-mix(in srgb, var(--tvsm-accent) 13%, transparent)", fg: "color-mix(in srgb, var(--tvsm-accent) 82%, var(--tvsm-text))", swatch: "var(--tvsm-accent)" },
  blue: { bg: "color-mix(in srgb, var(--tvsm-info) 15%, transparent)", fg: "color-mix(in srgb, var(--tvsm-info) 72%, var(--tvsm-text))", swatch: "var(--tvsm-info)" },
  green: { bg: "color-mix(in srgb, var(--tvsm-success) 15%, transparent)", fg: "color-mix(in srgb, var(--tvsm-success) 70%, var(--tvsm-text))", swatch: "var(--tvsm-success)" },
  orange: { bg: "color-mix(in srgb, var(--tvsm-warning) 18%, transparent)", fg: "color-mix(in srgb, var(--tvsm-warning) 62%, var(--tvsm-text))", swatch: "var(--tvsm-warning)" },
  ink: { bg: "var(--tvsm-ink)", fg: "#FFFFFF", swatch: "var(--tvsm-ink)" },
} as const;
export type TileColor = keyof typeof TILE_COLORS;
export const tileColor = (c: string) => TILE_COLORS[c as TileColor] ?? TILE_COLORS.purple;

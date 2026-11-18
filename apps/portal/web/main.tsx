import "@portal/ui/styles.css";
import { mountPlatformApp } from "@portal/ui";
import { House, LayoutGrid, Megaphone, Settings2, Users } from "lucide-react";
import en from "./i18n/en.json";
import nl from "./i18n/nl.json";
import { AdminAppsPage } from "./pages/AdminApps";
import { AdminGroupsPage, AdminNoticesPage, AdminSettingsPage } from "./pages/AdminOther";
import { HomePage } from "./pages/Home";

mountPlatformApp({
  appName: "IJmond 360 Portal",
  translations: { en, nl },
  nav: [
    {
      items: [{ to: "/", label: "portal.nav.home", icon: House, end: true, also: ["/tab"], mobile: true }],
    },
    {
      label: "portal.nav.manage",
      minRole: "admin",
      items: [
        { to: "/admin/apps", label: "portal.nav.apps", icon: LayoutGrid, mobile: true },
        { to: "/admin/notices", label: "portal.nav.notices", icon: Megaphone },
        { to: "/admin/groups", label: "portal.nav.groups", icon: Users },
        { to: "/admin/settings", label: "portal.nav.settings", icon: Settings2 },
      ],
    },
  ],
  routes: [
    { path: "/", element: <HomePage /> },
    { path: "/tab/:id", element: <HomePage /> },
    { path: "/admin/apps", element: <AdminAppsPage /> },
    { path: "/admin/notices", element: <AdminNoticesPage /> },
    { path: "/admin/groups", element: <AdminGroupsPage /> },
    { path: "/admin/settings", element: <AdminSettingsPage /> },
  ],
});

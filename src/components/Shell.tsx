import { useEffect, useState, ReactNode } from "react";
import { useAuth } from "../lib/auth";
import crest from "../assets/school-crest-maroon.png";

interface NavItem {
  key: string;
  label: string;
}

// Admin nav grouped into collapsible sections so the sidebar doesn't
// read as one long wall of 12 items. Dashboard and My Profile stay
// ungrouped (label: null) since they're not really "a category" --
// everything else is bucketed by what it's for. Teacher nav is short
// enough (6 items) that it stays flat.
interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const adminGroups: NavGroup[] = [
  { label: null, items: [{ key: "dashboard", label: "Dashboard" }] },
  {
    label: "Manage",
    items: [
      { key: "teachers", label: "Teachers" },
      { key: "classes", label: "Classes" },
      { key: "learners", label: "Learners" },
    ],
  },
  {
    label: "Academics",
    items: [
      { key: "years", label: "Academic Years" },
      { key: "promote", label: "Promote Classes" },
      { key: "classhistory", label: "Class History" },
      { key: "exams", label: "Assessments" },
    ],
  },
  {
    label: "Reports",
    items: [
      { key: "results", label: "Marklist" },
      { key: "overall", label: "Overall Marklist" },
      { key: "reportforms", label: "Report Forms" },
    ],
  },
  { label: null, items: [{ key: "profile", label: "My Profile" }] },
];

export default function Shell({
  view,
  setView,
  effectiveRole,
  onSwitchMode,
  children,
}: {
  view: string;
  setView: (v: string) => void;
  // The role currently being *displayed* -- normally equals user.role,
  // but an admin who chose "Teacher Page" at login (see
  // AdminRoleChoice.tsx / App.tsx) sees the teacher nav here while
  // user.role is still "admin" underneath. Real permissions are always
  // enforced server-side by RLS regardless of this.
  effectiveRole: "admin" | "teacher";
  // Only present for accounts that are actually admins -- lets them
  // flip between the admin and teacher nav without logging out.
  onSwitchMode?: () => void;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Which admin sections are expanded. Starts with only the section
  // containing the current view open (plus that view auto-expands its
  // section if it changes later -- see the effect below), so someone
  // landing on the Dashboard sees a short, calm list rather than all
  // 12 items at once, but clicking into e.g. Reports never leaves that
  // section hidden.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const g = adminGroups.find((grp) => grp.label && grp.items.some((it) => it.key === view));
    return new Set(g ? [g.label as string] : []);
  });

  useEffect(() => {
    const g = adminGroups.find((grp) => grp.label && grp.items.some((it) => it.key === view));
    if (g?.label) setExpanded((prev) => new Set(prev).add(g.label as string));
  }, [view]);

  function toggleGroup(label: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  if (!user) return null;

  const teacherItems: NavItem[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "marks", label: "Enter Marks" },
    { key: "results", label: "Marklist" },
    { key: "myclass", label: "My Class" },
    { key: "reportforms", label: "Report Forms" },
    { key: "profile", label: "My Profile" },
  ];

  function handleNav(key: string) {
    setView(key);
    setMobileOpen(false);
  }

  return (
    <div className="min-h-screen font-body flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar (desktop persistent, mobile slide-over) */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 shrink-0 bg-parchment text-ink flex flex-col border-r border-line transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 lg:p-5 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={crest} alt="" className="h-9 w-auto shrink-0" />
            <div className="leading-tight font-display">
              <div className="text-sm text-maroon-ink tracking-wide">KARIOBANGI SOUTH</div>
              <div className="text-[10px] tracking-[0.2em] text-ink/40 uppercase font-body">Assessment Portal</div>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden text-ink/50 hover:text-ink text-xl leading-none"
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <div className="px-4 lg:px-5 py-3 lg:py-4 border-b border-line flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-maroon/10 border border-maroon/30 flex items-center justify-center text-sm text-maroon font-body shrink-0">
            {user.name[0]}
          </div>
          <div className="leading-tight font-body min-w-0">
            <div className="text-sm text-ink truncate">{user.name}</div>
            <div className="text-[11px] text-ink/40 uppercase tracking-wide">{effectiveRole}</div>
          </div>
        </div>

        {/* Admin accounts can also be assigned as a class/subject teacher
            (see AdminRoleChoice.tsx), so they get a way to flip views
            without signing out. Not shown to plain teacher accounts. */}
        {user.role === "admin" && onSwitchMode && (
          <div className="px-3 pt-3">
            <button
              onClick={onSwitchMode}
              className="w-full text-center px-3 py-2 rounded text-[11px] uppercase tracking-wide border border-line text-ink/60 hover:text-ink hover:bg-maroon/5 font-body"
            >
              Switch to {effectiveRole === "admin" ? "Teacher" : "Admin"} view
            </button>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1 font-body overflow-y-auto">
          {effectiveRole === "admin"
            ? adminGroups.map((group, gi) =>
                group.label === null ? (
                  // Ungrouped items (Dashboard, My Profile) render as
                  // plain buttons, same as before.
                  group.items.map((it) => (
                    <button
                      key={it.key}
                      onClick={() => handleNav(it.key)}
                      className={`w-full text-left px-3 py-2.5 rounded text-xs uppercase tracking-wide transition border-l-2 ${
                        view === it.key
                          ? "bg-maroon/10 text-maroon border-l-maroon"
                          : "border-l-transparent text-ink/50 hover:text-ink hover:bg-maroon/5"
                      }`}
                    >
                      {it.label}
                    </button>
                  ))
                ) : (
                  <div key={group.label} className={gi > 0 ? "pt-2" : undefined}>
                    <button
                      onClick={() => toggleGroup(group.label as string)}
                      className="neu-eyebrow w-full flex items-center justify-between px-3 py-2 hover:opacity-75 transition"
                    >
                      <span>{group.label}</span>
                      <span className="text-[10px]">{expanded.has(group.label) ? "▾" : "▸"}</span>
                    </button>
                    {expanded.has(group.label) && (
                      <div className="space-y-1">
                        {group.items.map((it) => (
                          <button
                            key={it.key}
                            onClick={() => handleNav(it.key)}
                            className={`w-full text-left px-3 py-2.5 rounded text-xs uppercase tracking-wide transition border-l-2 ${
                              view === it.key
                                ? "bg-maroon/10 text-maroon border-l-maroon"
                                : "border-l-transparent text-ink/50 hover:text-ink hover:bg-maroon/5"
                            }`}
                          >
                            {it.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )
            : teacherItems.map((it) => (
                <button
                  key={it.key}
                  onClick={() => handleNav(it.key)}
                  className={`w-full text-left px-3 py-2.5 rounded text-xs uppercase tracking-wide transition border-l-2 ${
                    view === it.key
                      ? "bg-maroon/10 text-maroon border-l-maroon"
                      : "border-l-transparent text-ink/50 hover:text-ink hover:bg-maroon/5"
                  }`}
                >
                  {it.label}
                </button>
              ))}
        </nav>

        <div className="p-3 border-t border-line">
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 rounded text-xs uppercase tracking-wide text-ink/50 hover:text-ink hover:bg-maroon/5 font-body"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 w-full">
        {/* Mobile header -- "More" is the only mobile nav entry point now
            (see teacherItems/adminItems comment above); made a touch
            larger/bolder than before since it's carrying all navigation
            on a phone, not just the overflow. */}
        <div className="lg:hidden flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <img src={crest} alt="" className="h-7 w-auto" />
            <span className="text-sm font-display text-maroon-ink">Kariobangi South</span>
          </div>
          <button
            onClick={() => setMobileOpen(true)}
            className="glass-btn-sm font-medium"
            aria-label="Open menu"
          >
            ☰ Menu
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}

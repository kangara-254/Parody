// Shown after every admin login (not a one-time/remembered choice --
// see App.tsx, which resets this on every fresh sign-in). An admin's
// account can ALSO be assigned as a class or subject teacher (the DB
// puts no restriction on this -- see supabase/schema.sql), but the app
// used to lock every admin into the admin-only views, so a dual-role
// admin had no way to reach their own mark entry / my class screens.
// This just asks which side they want to land on; they can switch
// later from the sidebar (see Shell.tsx "Switch view").
export default function AdminRoleChoice({
  onChoose,
}: {
  onChoose: (mode: "admin" | "teacher") => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
      <div className="glass-card p-6 w-full max-w-sm text-center">
        <p className="neu-eyebrow mb-1">Welcome back</p>
        <h2 className="font-display text-xl text-maroon-ink mb-1">Which view would you like?</h2>
        <p className="text-sm text-ink/60 mb-5">
          You can switch between them anytime from the sidebar.
        </p>
        <div className="space-y-2.5">
          <button onClick={() => onChoose("admin")} className="w-full glass-btn">
            Admin Page
          </button>
          <button onClick={() => onChoose("teacher")} className="w-full glass-btn-sm py-2.5">
            Teacher Page
          </button>
        </div>
      </div>
    </div>
  );
}

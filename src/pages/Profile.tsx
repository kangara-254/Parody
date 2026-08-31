import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// Self-service name + password change. Available to both roles.
//
// Name goes through the `update_own_name` Postgres function (see
// schema.sql) rather than a direct table update, because
// public.teachers only grants UPDATE to admins -- the function is a
// narrow, security-definer exception that can only ever touch the
// caller's own `name` column, never role/status/anyone else's row.
//
// Password goes straight through Supabase Auth (auth.updateUser),
// which is unrelated to the teachers table/RLS entirely -- no new
// backend needed for that half.
export default function ProfilePage() {
  const { user, refreshProfile } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [nameStatus, setNameStatus] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  async function saveName() {
    if (!supabase) return;
    setNameStatus(null);
    if (!name.trim()) {
      setNameStatus({ type: "err", text: "Name cannot be empty." });
      return;
    }
    setSavingName(true);
    const { error } = await supabase.rpc("update_own_name", { new_name: name.trim() });
    setSavingName(false);
    if (error) {
      setNameStatus({ type: "err", text: error.message });
      return;
    }
    setNameStatus({ type: "ok", text: "Name updated." });
    await refreshProfile();
  }

  async function savePassword() {
    if (!supabase) return;
    setPasswordStatus(null);
    if (newPassword.length < 6) {
      setPasswordStatus({ type: "err", text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: "err", text: "Passwords don't match." });
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      setPasswordStatus({ type: "err", text: error.message });
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setPasswordStatus({ type: "ok", text: "Password updated." });
  }

  return (
    <div className="max-w-lg">
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink">My Profile</h1>
        <p className="text-sm text-ink/60 mt-1">Update your display name or change your password.</p>
      </header>

      <div className="glass-card p-5 mb-5">
        <h2 className="text-sm font-medium neu-panel-title mb-3">Name</h2>
        <label className="block mb-3">
          <span className="text-xs font-medium text-ink/70">Full name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full glass-input"
          />
        </label>
        <button onClick={saveName} disabled={savingName} className="glass-btn-sm font-medium disabled:opacity-50">
          {savingName ? "Saving…" : "Save name"}
        </button>
        {nameStatus && (
          <p className={`text-sm mt-2 ${nameStatus.type === "ok" ? "text-emerald-700" : "text-maroon"}`}>
            {nameStatus.text}
          </p>
        )}
      </div>

      <div className="glass-card p-5">
        <h2 className="text-sm font-medium neu-panel-title mb-3">Change password</h2>
        <label className="block mb-3">
          <span className="text-xs font-medium text-ink/70">New password</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full glass-input"
          />
        </label>
        <label className="block mb-3">
          <span className="text-xs font-medium text-ink/70">Confirm new password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full glass-input"
          />
        </label>
        <button
          onClick={savePassword}
          disabled={savingPassword}
          className="glass-btn-sm font-medium disabled:opacity-50"
        >
          {savingPassword ? "Saving…" : "Save password"}
        </button>
        {passwordStatus && (
          <p className={`text-sm mt-2 ${passwordStatus.type === "ok" ? "text-emerald-700" : "text-maroon"}`}>
            {passwordStatus.text}
          </p>
        )}
      </div>
    </div>
  );
}

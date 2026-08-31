import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { phoneToEmail } from "../lib/credentials";
import { randomQuote } from "../lib/quotes";
import crest from "../assets/school-crest-maroon.png";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(randomQuote());

  useEffect(() => {
    const id = setInterval(() => setQuote(randomQuote()), 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  async function submit() {
    setError("");
    if (!supabase) {
      setError("Supabase is not configured. Check your .env file.");
      return;
    }
    if (!phone.trim() || !password) {
      setError("Enter your phone number and password.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: phoneToEmail(phone),
      password,
    });
    setBusy(false);
    if (err) {
      setError("Invalid phone number or password.");
      return;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 font-body relative overflow-hidden">
      {/* Quiet full-bleed crest impression -- felt, not pasted on. */}
      <div className="crest-watermark" aria-hidden="true" />

      <div className="w-full max-w-sm relative">
        <div className="mb-8 text-center">
          <img
            src={crest}
            alt="Kariobangi South crest"
            className="h-24 w-auto mx-auto mb-4 drop-shadow-[0_2px_6px_rgba(122,15,48,0.15)]"
          />
          <p className="neu-eyebrow">Kariobangi South Primary &amp; Junior School</p>
          <h1 className="font-display text-2xl sm:text-3xl text-maroon-ink mt-2 leading-snug">
            8A2 Assessment Portal
          </h1>
          <p className="text-xs italic text-ink/50 mt-3 max-w-xs mx-auto">
            "{quote}"
          </p>
        </div>

        <div className="glass-card login-card p-6 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-ink/70">Phone Number</span>
            <input
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Enter phone number"
              className="mt-1 w-full glass-input login-input"
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink/70">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Enter password"
              className="mt-1 w-full glass-input login-input"
              autoComplete="current-password"
            />
          </label>
          <button
            onClick={submit}
            disabled={busy}
            className="w-full glass-btn disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && <div className="text-sm text-maroon">{error}</div>}
          <p className="text-xs text-ink/40 text-center">
            8A2 teachers
          </p>
        </div>
      </div>

      <p className="absolute bottom-4 left-0 right-0 text-center text-[11px] text-ink/40">
        © {new Date().getFullYear()} Made in Kariobangi South
      </p>
    </div>
  );
}

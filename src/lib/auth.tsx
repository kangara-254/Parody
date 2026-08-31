import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";
import { Teacher } from "../types";

interface AuthState {
  user: Teacher | null;
  ready: boolean;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Teacher | null>(null);
  const [ready, setReady] = useState(false);

  async function loadProfile() {
    if (!supabase) {
      setReady(true);
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const authUser = sessionData.session?.user;
    if (!authUser) {
      setUser(null);
      setReady(true);
      return;
    }
    // This is the part that actually matters: role/name come from a
    // real server-side query, verified against RLS ("select own row"),
    // not from anything the browser was just handed and told to trust.
    const { data, error } = await supabase.from("teachers").select("*").eq("id", authUser.id).single();
    if (error || !data) {
      setUser(null);
    } else {
      setUser(data as Teacher);
    }
    setReady(true);
  }

  useEffect(() => {
    loadProfile();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadProfile();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, ready, logout, refreshProfile: loadProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

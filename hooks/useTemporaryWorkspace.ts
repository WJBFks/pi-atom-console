"use client";
import { useEffect, useSyncExternalStore } from "react";
const key = "pi-web:temporary-workspace-path";
const initial = { path: "~/tmp", defaultPath: "~/tmp", home: "", ready: false };
let snapshot = initial;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
function read() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(key)?.trim() || null; } catch {}
  const path = !saved || (saved === "~/tmp" && snapshot.defaultPath !== "~/tmp") ? snapshot.defaultPath : saved;
  snapshot = { ...snapshot, path }; emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useTemporaryWorkspace() {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => initial);
  useEffect(() => {
    read();
    if (!loading) loading = fetch("/api/home").then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((data) => {
      snapshot = { ...snapshot, home: typeof data.home === "string" ? data.home : "", defaultPath: typeof data.temporaryWorkspaceDefault === "string" ? data.temporaryWorkspaceDefault : "~/tmp", ready: true }; read();
    }).catch(() => { loading = null; });
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  const savePath = (input: string) => {
    const path = input.trim() || snapshot.defaultPath;
    try { if (path === snapshot.defaultPath) localStorage.removeItem(key); else localStorage.setItem(key, path); } catch {}
    snapshot = { ...snapshot, path }; emit();
  };
  return { ...value, savePath, resetPath: () => savePath(snapshot.defaultPath) };
}

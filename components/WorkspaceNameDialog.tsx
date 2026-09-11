"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";

export function WorkspaceNameDialog({ path, defaultName, onConfirm, onDefault }: {
  path: string;
  defaultName: string;
  onConfirm: (name: string) => void;
  onDefault: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(defaultName);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="workspace-name-title"
      onKeyDown={(event) => { if (event.key === "Escape") onDefault(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.35)" }}>
      <form onSubmit={(event) => { event.preventDefault(); onConfirm(name); }}
        style={{ width: 420, maxWidth: "calc(100vw - 32px)", padding: 20, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h2 id="workspace-name-title" style={{ margin: "0 0 12px", fontSize: 16, color: "var(--text)" }}>{t("workspace.projectName")}</h2>
        <div style={{ marginBottom: 14, fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{path}</div>
        <input autoFocus aria-label={t("workspace.projectName")} value={name} placeholder={defaultName}
          onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)}
          style={{ boxSizing: "border-box", width: "100%", height: 38, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onDefault} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>{t("workspace.useDefaultName")}</button>
          <button type="submit" style={{ padding: "7px 16px", borderRadius: 6, border: 0, background: "var(--accent)", color: "var(--accent-contrast)", cursor: "pointer" }}>{t("workspace.saveName")}</button>
        </div>
      </form>
    </div>, document.body,
  );
}

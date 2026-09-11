"use client";
import { PiLogo } from "./PiLogo";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@/lib/types";
import { listSessionFamilies } from "@/lib/session-family";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { getProjectActivity, getRecentProjects, sessionsForProject } from "@/lib/project-groups";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { formatRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";
import { WorkspaceNameDialog } from "./WorkspaceNameDialog";
import { useTemporaryWorkspace } from "@/hooks/useTemporaryWorkspace";
import { InfoCopyButton, InfoHoverCard } from "./InfoHoverCard";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { SessionSearch } from "./SessionSearch";

// Fixed row height for the session list. SessionItem renders at exactly this
// height, so the list can be windowed (only the visible slice is mounted).
const SESSION_LIST_ITEM_HEIGHT = 32;
const PROJECT_TREE_HEADER_HEIGHT = 32;

type ProjectTreeRow =
  | { kind: "date"; key: string; label: string; height: number }
  | { kind: "project"; key: string; root: string; height: typeof PROJECT_TREE_HEADER_HEIGHT }
  | { kind: "session"; key: string; projectKey: string; family: ReturnType<typeof listSessionFamilies>[number]; height: number };

export function getSessionListIndices(count: number, scrollTop: number, viewportHeight: number, focusedIndex = -1): number[] {
  const overscan = 8;
  const visibleCount = Math.ceil((viewportHeight || 600) / SESSION_LIST_ITEM_HEIGHT) + overscan * 2;
  const start = Math.max(0, Math.min(Math.floor(scrollTop / SESSION_LIST_ITEM_HEIGHT) - overscan, count - visibleCount));
  const end = Math.min(count, start + visibleCount);
  const indices = Array.from({ length: end - start }, (_, offset) => start + offset);
  // Keep a focused row mounted so scrolling cannot discard an inline rename.
  if (focusedIndex >= 0 && focusedIndex < start) indices.unshift(focusedIndex);
  if (focusedIndex >= end && focusedIndex < count) indices.push(focusedIndex);
  return indices;
}

/** Window variable-height project headers and fixed-height session rows. */
export function getProjectTreeIndices(rows: readonly ProjectTreeRow[], scrollTop: number, viewportHeight: number, focusedIndex = -1): number[] {
  const overscan = 160;
  const totalHeight = rows.reduce((total, row) => total + row.height, 0);
  scrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - (viewportHeight || 600))));
  const viewportEnd = scrollTop + (viewportHeight || 600);
  const indices: number[] = [];
  let offset = 0;
  for (let index = 0; index < rows.length; index++) {
    const end = offset + rows[index].height;
    if (end >= scrollTop - overscan && offset <= viewportEnd + overscan) indices.push(index);
    offset = end;
  }
  if (focusedIndex >= 0 && focusedIndex < rows.length && !indices.includes(focusedIndex)) {
    indices.push(focusedIndex);
    indices.sort((a, b) => a - b);
  }
  return indices;
}

function projectTreeOffsets(rows: readonly ProjectTreeRow[]): number[] {
  let offset = 0;
  return rows.map((row) => {
    const current = offset;
    offset += row.height;
    return current;
  });
}

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

function ToolbarIconButton({
  onClick,
  title,
  disabled,
  skipHover,
  color,
  background = "none",
  marginRight,
  ariaPressed,
  size = 26,
  hoverBackground = "var(--bg-hover)",
  hoverColor = "var(--text-muted)",
  className,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  skipHover?: boolean;
  color: string;
  background?: string;
  marginRight?: number;
  ariaPressed?: boolean;
  size?: number;
  hoverBackground?: string;
  hoverColor?: string;
  className?: string;
  children: ReactNode;
}) {
  const enter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = hoverColor;
    e.currentTarget.style.background = hoverBackground;
  };
  const leave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = color;
    e.currentTarget.style.background = background;
  };
  return (
    <button
      className={className}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: size, height: size, padding: 0, marginRight,
        background,
        border: "none",
        color,
        cursor: disabled ? "default" : "pointer",
        borderRadius: 5,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        transition: "color 0.3s, background 0.3s",
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
    </button>
  );
}

interface Props {
  onToggleSidebar?: () => void;
  branchPortalTarget?: HTMLElement | null;
  workspaceInfoTarget?: HTMLElement | null;
  footerAction?: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => void;
  onOpenFile?: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  onOpenTerminal?: (cwd: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onSessionsChange?: (sessions: SessionInfo[]) => void;
  /** The right panel owns the explorer's visual location while this component
   * keeps its data, toolbar, and selection state alive. */
  changesView?: boolean;
  fileExplorerPortalTarget?: HTMLElement | null;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
}

interface ProjectSelection {
  root: string;
  key: string;
}

interface ValidatedProject {
  cwd: string;
  root: string;
  key: string;
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const ARCHIVED_SESSION_FAMILIES_STORAGE_KEY = "pi-web:archived-session-family-ids";
const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;

function loadLastCustomCwd(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_CUSTOM_CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastCustomCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CUSTOM_CWD_STORAGE_KEY, cwd);
  } catch {
    // Persistence is best-effort.
  }
}

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

function loadArchivedSessionFamilyIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(ARCHIVED_SESSION_FAMILIES_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? new Set(value.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveArchivedSessionFamilyIds(ids: Set<string>): void {
  try {
    if (ids.size) window.localStorage.setItem(ARCHIVED_SESSION_FAMILIES_STORAGE_KEY, JSON.stringify([...ids]));
    else window.localStorage.removeItem(ARCHIVED_SESSION_FAMILIES_STORAGE_KEY);
  } catch {
    // Archive state is best-effort, like other browser preferences.
  }
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style, anchorRef, panelRef }: { open: boolean; children: ReactNode; style: CSSProperties; anchorRef?: RefObject<HTMLDivElement | null>; panelRef?: RefObject<HTMLDivElement | null> }) {
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
      setPlacement({ position: "fixed", left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), bottom: window.innerHeight - rect.top + 4, width, maxHeight: Math.max(0, rect.top - 12), zIndex: 1000 });
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, anchorRef]);
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  const content = (
    <div
      ref={panelRef}
      style={{
        ...style,
        ...(anchorRef ? placement : {}),
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
  return anchorRef ? (placement && createPortal(content, document.body)) : content;
}



const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "Pi Web Space";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "default",
        fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        minWidth: 0, display: "flex", alignItems: "center", gap: 5, textAlign: "left",
      }}
    >
      <PiLogo />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
    </button>
  );
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, onOpenTerminal, explorerRefreshKey, onExplorerRefresh, onAtMention, onAtMentions, onBackgroundTaskDone, onRunningSessionIdsChange, onSessionsChange, branchPortalTarget, workspaceInfoTarget, footerAction, changesView = false, fileExplorerPortalTarget, onToggleSidebar }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [sessionListVersion, setSessionListVersion] = useState<number | null>(null);
  const sessionListVersionRef = useRef<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [wtFilter, setWtFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  const [workspaceNames, setWorkspaceNames] = useState<Record<string, string>>({});
  const [pendingWorkspace, setPendingWorkspace] = useState<ValidatedProject | null>(null);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("pi-web:workspace-names") ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        setWorkspaceNames(Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string")));
      }
    } catch { /* Use directory names when local storage is unavailable. */ }
  }, []);
  const [workspaceIds, setWorkspaceIds] = useState<Record<string, string>>({});
  const [workspaceMenu, setWorkspaceMenu] = useState<{ root: string; key: string; x: number; y: number } | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<Record<string, { root: string; state: "archived" | "deleted" }>>({});
  const [workspaceAction, setWorkspaceAction] = useState<{ root: string; key: string; action: "archive" | "delete" } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pi-web:workspace-status") ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setWorkspaceStatus(Object.fromEntries(Object.entries(saved).filter(([, value]) => value && typeof value === "object" && "root" in value && typeof value.root === "string" && "state" in value && (value.state === "archived" || value.state === "deleted"))) as Record<string, { root: string; state: "archived" | "deleted" }>);
    } catch { /* Start with active workspaces. */ }
  }, []);
  const saveWorkspaceStatus = (next: typeof workspaceStatus) => {
    setWorkspaceStatus(next);
    try { localStorage.setItem("pi-web:workspace-status", JSON.stringify(next)); } catch { /* Keep changes in memory. */ }
  };
  const workspaceInfoRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const panel = workspaceInfoRef.current;
      if (panel?.open && event.target instanceof Node && !panel.contains(event.target)) panel.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const [hoveredWorkspaceKey, setHoveredWorkspaceKey] = useState<string | null>(null);
  const [workspaceHover, setWorkspaceHover] = useState<{ key: string; root: string; right: number; left: number; top: number } | null>(null);
  const workspaceHoverRef = useRef<HTMLDivElement>(null);
  const workspaceHoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepWorkspaceHover = () => { if (workspaceHoverCloseTimer.current) clearTimeout(workspaceHoverCloseTimer.current); };
  const closeWorkspaceHoverLater = () => { keepWorkspaceHover(); workspaceHoverCloseTimer.current = setTimeout(() => setWorkspaceHover(null), 180); };
  useEffect(() => () => { if (workspaceHoverCloseTimer.current) clearTimeout(workspaceHoverCloseTimer.current); }, []);

  const [workspaceHoverPosition, setWorkspaceHoverPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!workspaceHover || !workspaceHoverRef.current) return;
    const rect = workspaceHoverRef.current.getBoundingClientRect();
    setWorkspaceHoverPosition({
      left: Math.max(8, workspaceHover.right + rect.width + 8 <= window.innerWidth ? workspaceHover.right + 8 : workspaceHover.left - rect.width - 8),
      top: Math.max(8, Math.min(workspaceHover.top, window.innerHeight - rect.height - 8)),
    });
  }, [workspaceHover]);
  useEffect(() => {
    if (!workspaceHover) return;
    const close = () => setWorkspaceHover(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true); document.removeEventListener("keydown", onKey); };
  }, [workspaceHover]);

  const [renamingWorkspace, setRenamingWorkspace] = useState<string | null>(null);
  useEffect(() => {
    const roots = new Set(allSessions.map((session) => session.projectRoot ?? session.cwd));
    if (selectedCwd) roots.add(selectedCwd);
    if (validatedProject) roots.add(validatedProject.root);
    let ids: Record<string, string> = {};
    try {
      const saved = JSON.parse(localStorage.getItem("pi-web:workspace-ids") ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) ids = Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string"));
    } catch { /* Generate missing identities below. */ }
    for (const root of roots) {
      if (!ids[root]) ids[root] = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    }
    setWorkspaceIds(ids);
    try { localStorage.setItem("pi-web:workspace-ids", JSON.stringify(ids)); } catch { /* Keep identities in memory. */ }
  }, [allSessions, selectedCwd, validatedProject]);
  useEffect(() => {
    if (!workspaceMenu) return;
    const close = () => setWorkspaceMenu(null);
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", keydown); window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true); };
  }, [workspaceMenu]);
  const workspaceName = (root: string) => workspaceNames[root] || root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
  const workspaceDisplayName = (root: string) => {
    const name = workspaceName(root);
    const roots = new Set(allSessions.map((session) => session.projectRoot ?? session.cwd));
    Object.keys(workspaceNames).forEach((path) => roots.add(path));
    roots.add(validatedProject?.root ?? selectedCwd ?? root);
    const duplicate = [...roots].some((path) => path !== root && workspaceName(path) === name);
    return <><span style={{ fontWeight: 600 }}>{name}</span>{duplicate && workspaceIds[root] && <span style={{ color: "#a3aab3", fontWeight: 400 }}>#{workspaceIds[root].slice(-4)}</span>}</>;
  };
  const renameWorkspace = (name?: string) => {
    if (!renamingWorkspace) return;
    const next = { ...workspaceNames };
    if (name?.trim()) next[renamingWorkspace] = name.trim();
    else delete next[renamingWorkspace];
    setWorkspaceNames(next);
    try { localStorage.setItem("pi-web:workspace-names", JSON.stringify(next)); } catch { /* Keep the name for this visit. */ }
    setRenamingWorkspace(null);
  };
  const finishWorkspace = (name?: string) => {
    if (!pendingWorkspace) return;
    const next = { ...workspaceNames };
    if (name?.trim()) next[pendingWorkspace.root] = name.trim();
    else delete next[pendingWorkspace.root];
    setWorkspaceNames(next);
    try { localStorage.setItem("pi-web:workspace-names", JSON.stringify(next)); } catch { /* Keep the name for this visit. */ }
    setValidatedProject(pendingWorkspace);
    saveLastCustomCwd(pendingWorkspace.cwd);
    setCustomPathValue(pendingWorkspace.cwd);
    setSelectedCwd(pendingWorkspace.cwd);
    setPendingWorkspace(null);
  };

  // A key enters this set only through an explicit user click. New projects
  // remain expanded by default, including a just-selected empty workspace.
  const [workspaceListView, setWorkspaceListView] = useState<"workspace" | "recent" | "temporary">("workspace");
  const recentView = workspaceListView === "recent";
  const { path: temporaryWorkspacePath } = useTemporaryWorkspace();
  const isTemporaryWorkspace = useCallback((path: string) => {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const home = homeDir.replace(/\\/g, "/").replace(/\/+$/, "");
    const configured = temporaryWorkspacePath.replace(/\\/g, "/").replace(/^~(?=\/|$)/, home || "~").replace(/\/+$/, "");
    return ["/tmp", "~/tmp", configured, ...(home ? [`${home}/tmp`] : [])].some((root) => normalized === root || normalized.startsWith(`${root}/`));
  }, [homeDir, temporaryWorkspacePath]);
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState<Set<string>>(() => new Set());
  const [projectCollapseRestored, setProjectCollapseRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pi-web:collapsed-project-keys") ?? "[]");
      if (Array.isArray(saved)) setCollapsedProjectKeys(new Set(saved.filter((key): key is string => typeof key === "string")));
    } catch { /* Storage is optional. */ }
    setProjectCollapseRestored(true);
  }, []);
  useEffect(() => {
    if (!projectCollapseRestored) return;
    try { localStorage.setItem("pi-web:collapsed-project-keys", JSON.stringify([...collapsedProjectKeys])); }
    catch { /* Storage is optional. */ }
  }, [collapsedProjectKeys, projectCollapseRestored]);

  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const wtPanelRef = useRef<HTMLDivElement>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  // Sessions remain on disk and keep running; only their family root is stored
  // in localStorage, so a parent and all of its subagents move together.
  const [archivedFamilyIds, setArchivedFamilyIds] = useState<Set<string>>(() => new Set());
  const [archiveView, setArchiveView] = useState(false);
  const sessionSearchActive = sessionSearchOpen && Boolean(sessionSearchQuery.trim());
  const searchRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sessionSearchOpen || sessionSearchQuery.trim()) return;
    const closeEmptySearch = (event: PointerEvent) => {
      if (!searchRowRef.current?.contains(event.target as Node)) setSessionSearchOpen(false);
    };
    document.addEventListener("pointerdown", closeEmptySearch, true);
    return () => document.removeEventListener("pointerdown", closeEmptySearch, true);
  }, [sessionSearchOpen, sessionSearchQuery]);

  useEffect(() => {
    setArchivedFamilyIds(loadArchivedSessionFamilyIds());
    const syncStorage = (event: StorageEvent) => {
      if (event.key === ARCHIVED_SESSION_FAMILIES_STORAGE_KEY || event.key === null) setArchivedFamilyIds(loadArchivedSessionFamilyIds());
    };
    window.addEventListener("storage", syncStorage);
    return () => window.removeEventListener("storage", syncStorage);
  }, []);

  const [changesCount, setChangesCount] = useState(0);

  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const currentSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  // Virtualized session list: only the visible window of rows is mounted.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [listViewportH, setListViewportH] = useState(0);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const listScrollRafRef = useRef<number | null>(null);
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (listScrollRafRef.current != null) return;
    listScrollRafRef.current = requestAnimationFrame(() => {
      listScrollRafRef.current = null;
      setListScrollTop(top);
    });
  }, []);
  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setListViewportH(entry.contentRect.height);
    });
    ro.observe(el);
    setListViewportH(el.clientHeight);
    setListScrollTop(el.scrollTop);
    return () => ro.disconnect();
  }, [sessionSearchActive]);

  const loadSessions = useCallback(async (showLoading = false, force = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(force ? "/api/sessions?force=1" : "/api/sessions", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        sessionListVersion: number;
        runningSessionIds?: string[];
        completionNotificationSuppressedSessionIds?: string[];
      };
      if (loadId !== sessionLoadIdRef.current) return;
      sessionListVersionRef.current = data.sessionListVersion;
      setSessionListVersion(data.sessionListVersion);
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop markers for deleted sessions and for subagents, whose completion
      // is intentionally silent even if an older client marked them unread.
      const unreadEligibleIds = new Set(
        data.sessions
          .filter((session) => session.relation?.kind !== "subagent")
          .map((session) => session.id),
      );
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst, !isFirst);
  }, [loadSessions, refreshKey]);

  // Browser storage is unavailable during server rendering. Restore the panel
  // preference after hydration so a collapsed explorer stays collapsed on reload.
  useEffect(() => {
    setExplorerOpen(loadExplorerOpen());
  }, []);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as {
          sessionListVersion: number;
          runningSessionIds?: string[];
          completionNotificationSuppressedSessionIds?: string[];
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        if (data.sessionListVersion !== sessionListVersionRef.current) {
          // Reuse the invalidated cache; forcing a scan would change the version again.
          await loadSessions();
        }
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadSessions]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onSessionsChange?.(allSessions);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const knownSubagentIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "subagent")
        .map((session) => session.id),
    );
    const completedWithNotifications = completedInBackground.filter(
      (id) => !previousSuppressedCompletionSessionIdsRef.current.has(id) && !knownSubagentIds.has(id),
    );
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedWithNotifications.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedWithNotifications.forEach((id) => next.add(id));
        return next;
      });
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedWithNotifications.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
    previousSuppressedCompletionSessionIdsRef.current = new Set(
      [...runningSessionIds].filter(
        (id) => currentSuppressedCompletionSessionIdsRef.current.has(id) || knownSubagentIds.has(id),
      ),
    );
  }, [runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  const projectSelection = useCallback((root: string, key: string): ProjectSelection => ({
    root,
    key,
  }), []);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => {
    if (!cwd) return null;
    // /api/cwd/validate resolves identity before a custom path becomes active,
    // preventing one render with a raw path key from looking like a switch.
    if (validatedProject?.cwd === cwd) {
      return projectSelection(validatedProject.root, validatedProject.key);
    }
    if (worktreeState && worktreeState.forCwd === cwd) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [validatedProject, worktreeState, allSessions, projectSelection]);

  // A worktree/session refresh can hydrate the stable key without changing
  // cwd, so notify when either changes. The parent treats same-cwd key changes
  // as identity hydration rather than a workspace switch.
  const lastNotifiedProjectRef = useRef<{ cwd: string | null; key: string | null } | null>(null);
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null)) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0].root);
    }
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  // Prefer an exact UI selection while a refetch is in flight. Once the
  // response catches up, the server-resolved path handles Windows case and
  // separator differences without teaching the browser OS path semantics.
  const currentWorktree = worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd)
      ?? (worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
        ? worktreeState.worktrees.find((worktree) => worktree.path === worktreeState.currentWorktreePath)
        : undefined)
      ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : undefined;
  const currentWorktreePath = currentWorktree?.path ?? null;

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setPendingWorkspace({ cwd: data.cwd, root: data.projectRoot, key: data.projectKey });
      setCustomPathOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        currentWorktreePath: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      if (currentWorktreePath === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, currentWorktreePath]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node) && !wtPanelRef.current?.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
        setWtFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s, false, entryId, blockIndex);
  }, [onSelectSession]);

  const [newSessionPicker, setNewSessionPicker] = useState(false);
  const [newSessionWorkspace, setNewSessionWorkspace] = useState("");
  const [newSessionBusy, setNewSessionBusy] = useState(false);
  const [newSessionError, setNewSessionError] = useState("");
  const startWorkspaceSession = async (cwd: string) => {
    if (!cwd || newSessionBusy) return;
    setNewSessionBusy(true); setNewSessionError("");
    try {
      const response = await fetch("/api/cwd/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法打开工作区");
      setValidatedProject({ cwd: data.cwd, root: data.projectRoot, key: data.projectKey });
      setSelectedCwd(data.cwd); setArchiveView(false); setNewSessionPicker(false);
      const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      onNewSession?.(id, data.cwd);
    } catch (error) { setNewSessionError(error instanceof Error ? error.message : String(error)); }
    finally { setNewSessionBusy(false); }
  };
  const handleNewSession = () => {
    setNewSessionWorkspace(selectedCwd ?? temporaryWorkspacePath);
    setNewSessionError(""); setNewSessionPicker(true);
  };

  const selectedProject = projectFor(selectedCwd);

  // Per-project activity counts (running / unread) for the workspace selector.
  // Uses the same stable server key as the project list and filtering.
  const projectActivity = useMemo(
    () => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );

  // Keep the effective cwd visible even before its first session is created.
  // Existing projects retain their activity ordering from getRecentProjects().
  const visibleSessions = useMemo(() => listSessionFamilies(allSessions)
    .filter((family) => {
      if (!recentView && isTemporaryWorkspace(family.root.projectRoot ?? family.root.cwd) !== (workspaceListView === "temporary")) return false;
      const status = workspaceStatus[workspaceKeyOf(family.root)]?.state;
      return status !== "deleted" && (status === "archived" || archivedFamilyIds.has(family.root.id)) === archiveView;
    })
    .flatMap((family) => [family.root, ...family.subagents]), [allSessions, archivedFamilyIds, archiveView, workspaceStatus, recentView, workspaceListView, isTemporaryWorkspace]);
  const visibleSessionIds = useMemo(() => new Set(visibleSessions.map((session) => session.id)), [visibleSessions]);

  const projectTreeRows = useMemo(() => {
    if (recentView) {
      const rows: ProjectTreeRow[] = [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let previous = "";
      for (const family of listSessionFamilies(visibleSessions).sort((a, b) => new Date(b.latestModified).getTime() - new Date(a.latestModified).getTime())) {
        const date = new Date(family.latestModified);
        const days = Math.floor((today.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000);
        const label = days <= 0 ? "今天" : days === 1 ? "昨天" : days < 7 ? "最近 7 天" : days < 30 ? "最近 30 天" : "更早";
        if (label !== previous) { rows.push({ kind: "date", key: label, label, height: 30 }); previous = label; }
        rows.push({ kind: "session", key: family.root.id, projectKey: projectFor(family.root.cwd)?.key ?? family.root.cwd, family, height: 50 });
      }
      return rows;
    }
    const projects = getRecentProjects(visibleSessions);
    if (!archiveView && selectedProject && !workspaceStatus[selectedProject.key] && !projects.some((project) => project.key === selectedProject.key)) {
      projects.unshift(selectedProject);
    }
    if (archiveView) for (const [key, entry] of Object.entries(workspaceStatus)) {
      if (entry.state === "archived" && !projects.some((project) => project.key === key)) projects.push({ key, root: entry.root });
    }
    const rows: ProjectTreeRow[] = [];
    for (const project of projects) {
      if (isTemporaryWorkspace(project.root) !== (workspaceListView === "temporary")) continue;
      rows.push({ kind: "project", key: project.key, root: project.root, height: PROJECT_TREE_HEADER_HEIGHT });
      if (collapsedProjectKeys.has(project.key)) continue;
      for (const family of listSessionFamilies(sessionsForProject(visibleSessions, project.key))) {
        rows.push({ kind: "session", key: family.root.id, projectKey: project.key, family, height: SESSION_LIST_ITEM_HEIGHT });
      }
    }
    return rows;
  }, [visibleSessions, selectedProject, collapsedProjectKeys, recentView, archiveView, workspaceStatus, workspaceListView, isTemporaryWorkspace]);
  const projectTreeRowOffsets = useMemo(() => projectTreeOffsets(projectTreeRows), [projectTreeRows]);
  const projectTreeHeight = projectTreeRows.reduce((height, row) => height + row.height, 0);
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject?.key === worktreeState.projectKey
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject?.key === worktreeState.projectKey
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
             label: t("sidebar.openRepoRoot"),
             title: t("sidebar.openRepoRootTitle"),
          }
        : {
             label: t("sidebar.gitRepoRootOnly"),
             title: t("sidebar.gitRepoRootOnlyTitle"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
           label: t("sidebar.worktrees"),
           title: t("sidebar.checkingWorktrees"),
        }
      : null);

  const virtualIndices = getProjectTreeIndices(
    projectTreeRows,
    listScrollTop,
    listViewportH,
    projectTreeRows.findIndex((row) => row.kind === "session" && row.family.root.id === focusedSessionId),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {pendingWorkspace && <WorkspaceNameDialog
        path={pendingWorkspace.cwd}
        defaultName={workspaceName(pendingWorkspace.root)}
        onConfirm={finishWorkspace}
        onDefault={() => finishWorkspace()}
      />}
      {renamingWorkspace && <WorkspaceNameDialog path={renamingWorkspace} defaultName={workspaceName(renamingWorkspace)} onConfirm={renameWorkspace} onDefault={() => renameWorkspace()} />}
      {workspaceMenu && createPortal(<div role="menu" onPointerDown={(event) => event.stopPropagation()} style={{ position: "fixed", left: workspaceMenu.x, top: workspaceMenu.y, zIndex: 1100, width: 150, padding: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.12)" }}>
        <button role="menuitem" className="pi-workspace-menu-item" onClick={() => { setRenamingWorkspace(workspaceMenu.root); setWorkspaceMenu(null); }}>重命名</button>
        {workspaceStatus[workspaceMenu.key]?.state === "archived" ? <>
          <button role="menuitem" className="pi-workspace-menu-item" onClick={() => {
            const next = { ...workspaceStatus }; delete next[workspaceMenu.key]; saveWorkspaceStatus(next);
            const ids = new Set(listSessionFamilies(sessionsForProject(allSessions, workspaceMenu.key)).map((family) => family.root.id));
            setArchivedFamilyIds((current) => { const restored = new Set([...current].filter((id) => !ids.has(id))); saveArchivedSessionFamilyIds(restored); return restored; });
            setWorkspaceMenu(null);
          }}>取消归档</button>
          <button role="menuitem" className="pi-workspace-menu-item" style={{ color: "#dc2626" }} onClick={() => { setWorkspaceAction({ ...workspaceMenu, action: "delete" }); setWorkspaceMenu(null); }}>删除</button>
        </> : <button role="menuitem" className="pi-workspace-menu-item" style={{ color: "#dc2626" }} onClick={() => { setWorkspaceAction({ ...workspaceMenu, action: "archive" }); setWorkspaceMenu(null); }}>归档</button>}
      </div>, document.body)}
      {workspaceAction && createPortal(<div role="dialog" aria-modal="true" aria-labelledby="workspace-action-title" onKeyDown={(event) => { if (event.key === "Escape") setWorkspaceAction(null); }} style={{ position: "fixed", inset: 0, zIndex: 1200, display: "grid", placeItems: "center", background: "rgba(0,0,0,.35)" }}>
        <div style={{ width: 380, maxWidth: "calc(100vw - 32px)", padding: 20, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}>
          <strong id="workspace-action-title">{workspaceAction.action === "archive" ? "归档工作区" : "删除工作区"}</strong>
          <p style={{ fontSize: 13, overflowWrap: "anywhere" }}> {workspaceDisplayName(workspaceAction.root)}</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{workspaceAction.action === "archive" ? "此工作区及其所有会话将移至归档，可在归档中恢复。" : "将从工作区列表移除，磁盘目录和会话文件会保留。"}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button autoFocus className="pi-workspace-menu-item" style={{ width: "auto" }} onClick={() => setWorkspaceAction(null)}>取消</button>
            <button className="pi-workspace-menu-item" style={{ width: "auto", background: "#dc2626", color: "white" }} onClick={() => {
              if (workspaceAction.action === "delete" && workspaceStatus[workspaceAction.key]?.state !== "archived") return;
              saveWorkspaceStatus({ ...workspaceStatus, [workspaceAction.key]: { root: workspaceAction.root, state: workspaceAction.action === "archive" ? "archived" : "deleted" } });
              setWorkspaceAction(null);
            }}>{workspaceAction.action === "archive" ? "确认归档" : "确认删除"}</button>
          </div>
        </div>
      </div>, document.body)}
      {workspaceInfoTarget && selectedProject && createPortal(
        <details ref={workspaceInfoRef} key={selectedProject.key} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }} style={{ position: "relative", minWidth: 0, fontSize: 11 }}>
          <summary onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }} className="pi-workspace-info-trigger" style={{ cursor: "pointer", listStyle: "none", maxWidth: 240, display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, color: "var(--text-muted)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/></svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workspaceDisplayName(selectedProject.root)}</span>
          </summary>
          <div style={{ position: "absolute", bottom: "calc(100% + 10px)", left: 0, width: 380, maxWidth: "calc(100vw - 40px)", padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", boxShadow: "0 6px 24px rgba(0,0,0,.12)", zIndex: 50, color: "var(--text)", overflowWrap: "anywhere" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "-14px -14px 12px", padding: "12px 14px", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/></svg>
              工作区
            </div>
            <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>工作区名</div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>{workspaceDisplayName(selectedProject.root)}<InfoCopyButton value={workspaceName(selectedProject.root)} /></div>
            <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>工作区 ID</div>
            <div style={{ userSelect: "text", marginBottom: 10 }}>{workspaceIds[selectedProject.root] ?? "加载中…"}<InfoCopyButton value={workspaceIds[selectedProject.root] ?? "加载中…"} /></div>
            <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>工作区路径</div>
            <div style={{ userSelect: "text" }}>{selectedProject.root}<InfoCopyButton value={selectedProject.root} /></div>
          </div>
        </details>, workspaceInfoTarget)}
      {workspaceHover && createPortal((() => {
        const sessions = sessionsForProject(allSessions, workspaceHover.key);
        const created = sessions.map((session) => Date.parse(session.created)).filter(Number.isFinite);
        const modified = sessions.map((session) => Date.parse(session.modified)).filter(Number.isFinite);
        const formatTime = (time: number) => new Date(time).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        const fields = [
          ["工作区名", workspaceName(workspaceHover.root)],
          ["工作区ID", workspaceIds[workspaceHover.root] ?? "加载中…"],
          ["工作区路径", workspaceHover.root],
          ["活跃时间", modified.length ? formatTime(Math.max(...modified)) : "暂无会话记录"],
          ["创建时间", created.length ? formatTime(Math.min(...created)) : "暂无会话记录"],
        ];
        return <div ref={workspaceHoverRef} onMouseEnter={keepWorkspaceHover} onMouseLeave={closeWorkspaceHoverLater} id="workspace-hover-info" role="dialog" style={{ position: "fixed", ...workspaceHoverPosition, width: 340, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", boxSizing: "border-box", overflow: "auto", padding: 16, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", boxShadow: "0 6px 24px rgba(0,0,0,.12)", zIndex: 1200, pointerEvents: "auto", fontSize: 11, lineHeight: 1.5 }}>
          {fields.map(([label, value], index) => <div key={label} style={{ marginTop: index ? 12 : 0 }}><div style={{ color: "var(--text-dim)", marginBottom: 4 }}>{label}</div><div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontWeight: index === 0 ? 600 : 400 }}>{value}</div><InfoCopyButton value={value} /></div></div>)}
        </div>;
      })(), document.body)}
      {newSessionPicker && createPortal((() => {
        const normalized = (path: string) => {
          const value = path.replace(/\\/g, "/").replace(/^~(?=\/|$)/, homeDir.replace(/\\/g, "/") || "~").replace(/\/+$/, "");
          return /^[a-z]:/i.test(value) || value.startsWith("//") ? value.toLowerCase() : value;
        };
        const isTemporary = (path: string) => normalized(path) === normalized(temporaryWorkspacePath);
        const roots = [...new Set([...(selectedCwd && !isTemporary(selectedCwd) ? [selectedCwd] : []), ...getRecentProjects(allSessions).filter((project) => !workspaceStatus[project.key]).map((project) => project.root)])].filter((root) => !isTemporary(root));
        const choice = (root: string, temporary = false) => {
          const selected = temporary ? isTemporary(newSessionWorkspace) : normalized(newSessionWorkspace) === normalized(root);
          return <button type="button" aria-pressed={selected} disabled={newSessionBusy} onClick={() => setNewSessionWorkspace(root)} key={root} className="pi-workspace-choice" style={{ display: "flex", width: "100%", textAlign: "left", fontFamily: "inherit", alignItems: "center", gap: 10, padding: "11px 12px", marginBottom: 4, borderRadius: 8, cursor: newSessionBusy ? "default" : "pointer", background: selected ? "var(--bg-selected)" : "transparent", border: selected ? "1px solid var(--accent)" : "1px solid transparent" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden="true">{temporary ? <path d="M12 3a9 9 0 1 0 9 9M12 7v5l-3 2M19 2v6m-3-3h6"/> : <path d="M3 7V5h7l2 3h9v12H3ZM3 9h18"/>}</svg>
            <span style={{ minWidth: 0, flex: 1 }}><span style={{ fontWeight: 600, fontSize: 12, color: temporary ? "var(--accent)" : "var(--text)" }}>{temporary ? "临时工作区" : workspaceDisplayName(projectFor(root)?.root ?? root)}</span>{!temporary && <span style={{ display: "block", marginTop: 3, fontSize: 10, color: "var(--text-dim)", overflowWrap: "anywhere" }}>{root}</span>}</span>
          </button>;
        };
        return <div role="dialog" aria-modal="true" aria-labelledby="new-session-workspace-title" onClick={(event) => { if (event.target === event.currentTarget && !newSessionBusy) setNewSessionPicker(false); }} onKeyDown={(event) => { if (event.key === "Escape" && !newSessionBusy) setNewSessionPicker(false); }} style={{ position: "fixed", inset: 0, zIndex: 1400, background: "rgba(15,23,42,.28)", display: "grid", placeItems: "center", padding: 16 }}>
          <form onSubmit={(event) => { event.preventDefault(); void startWorkspaceSession(newSessionWorkspace); }} style={{ width: 540, maxWidth: "100%", maxHeight: "min(640px, 85dvh)", display: "flex", flexDirection: "column", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "0 16px 48px rgba(15,23,42,.18)", color: "var(--text)" }}>
            <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}><strong id="new-session-workspace-title" style={{ fontSize: 15 }}>选择工作区</strong><button type="button" className="pi-info-copy" aria-label="取消" disabled={newSessionBusy} onClick={() => setNewSessionPicker(false)}>×</button></div>
            <div style={{ padding: "0 12px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>{choice(temporaryWorkspacePath, true)}</div>
            <div style={{ overflowY: "auto", minHeight: 0, padding: "8px 12px", flex: "1 1 auto" }}>{roots.map((root) => choice(root))}</div>
            {newSessionError && <div role="alert" style={{ color: "#dc2626", padding: "8px 20px", fontSize: 12 }}>{newSessionError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              <button type="button" className="pi-workspace-dialog-cancel" disabled={newSessionBusy} onClick={() => setNewSessionPicker(false)}>取消</button>
              <button type="submit" className="pi-workspace-dialog-create" style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "none", borderRadius: 7, fontWeight: 500 }} disabled={newSessionBusy || !newSessionWorkspace}><span aria-hidden="true">＋</span>{newSessionBusy ? "正在创建…" : "新建会话"}</button>
            </div>
          </form>
        </div>;
      })(), document.body)}
      {!newSessionPicker && newSessionError && <div role="alert" style={{ padding: 10, color: "#dc2626", fontSize: 12 }}>{newSessionError}</div>}
      {/* Header */}
      <div className="pi-sidebar-header"
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div className="pi-brand-row">
          <PiWebTitle />
          <button className="pi-sidebar-icon" onClick={onToggleSidebar} aria-label={t("sidebar.hide")} title={t("sidebar.hide")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <ToolbarIconButton
              onClick={() => setArchiveView((current) => !current)}
              title={t(archiveView ? "sidebar.showSessions" : "sidebar.showArchived")}
              color={archiveView ? "#b91c1c" : "var(--text-muted)"}
              background={archiveView ? "#fee2e2" : "var(--bg-hover)"}
              hoverBackground={archiveView ? "#fca5a5" : "#c5dcef"}
              hoverColor={archiveView ? "#7f1d1d" : "#234f73"}
              ariaPressed={archiveView}
              className="pi-archive-toggle"
              size={34}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h18v13H3z"/><path d="M3 7l3-4h12l3 4M9 11h6"/></svg>
            </ToolbarIconButton>
            <button className="pi-new-session"
              onClick={handleNewSession}
              disabled={newSessionBusy}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: selectedCwd ? "var(--text-muted)" : "var(--text-dim)",
                cursor: selectedCwd ? "pointer" : "not-allowed",
                height: 34, minHeight: 34, maxHeight: 34, boxSizing: "border-box",
                paddingLeft: 10,
                paddingRight: 12,
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                flex: "1 1 auto", minWidth: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
             title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.selectProject")}
              onMouseEnter={(e) => {
                if (!selectedCwd) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
              {t("sidebar.newSessionButton")}
            </button>
            <ToolbarIconButton onClick={() => { if (!newSessionBusy) void startWorkspaceSession(temporaryWorkspacePath); }} title="新临时会话" size={34} color="var(--text-muted)" background="var(--bg-hover)" hoverBackground="#c5dcef" hoverColor="#234f73">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9M12 7v5l-3 2M19 2v6m-3-3h6"/></svg>
            </ToolbarIconButton>
        </div>
        <div ref={searchRowRef} style={{ height: 30, marginTop: 14, marginBottom: 4, flexShrink: 0 }}>
        {sessionSearchOpen ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, height: "100%", boxSizing: "border-box", padding: "0 8px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text-dim)" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flexShrink: 0 }} aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input
              id="session-search-input"
              type="text"
              autoFocus
              value={sessionSearchQuery}
              maxLength={200}
              aria-label={t("sidebar.searchSessions")}
              placeholder={t("sidebar.searchSessions")}
              onChange={(event) => setSessionSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setSessionSearchQuery("");
                  setSessionSearchOpen(false);
                }
              }}
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 12, padding: 0 }}
            />
            <button type="button" aria-label={t("sidebar.cancel")} title={t("sidebar.cancel")} onClick={() => { setSessionSearchQuery(""); setSessionSearchOpen(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 24, padding: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </div>
        ) : (
        <div className="pi-workspace-label" style={{ height: "100%", marginTop: 0, marginBottom: 0, boxSizing: "border-box" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {(["workspace", "recent", "temporary"] as const).map((view) => <button key={view} type="button" aria-pressed={workspaceListView === view}
              onClick={() => setWorkspaceListView(view)}
              style={{ padding: "3px 0", border: 0, borderBottom: workspaceListView === view ? "2px solid var(--accent)" : "2px solid transparent", background: "transparent", color: workspaceListView === view ? "var(--text)" : "var(--text-dim)", fontSize: 12, cursor: "pointer" }}>
              {view === "recent" ? "最近" : view === "temporary" ? "临时" : t("sidebar.workspaceLabel")}
            </button>)}
          </div>
          <div className="pi-workspace-actions">
            <button
              type="button"
              onClick={() => {
                setSessionSearchOpen((open) => !open);
                setWtDropdownOpen(false);
              }}
              title={t("sidebar.toggleSessionSearch")}
              aria-label={t("sidebar.toggleSessionSearch")}
              aria-expanded={sessionSearchOpen}
              aria-controls="session-search-input"
              className={`flex h-[32px] w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-border hover:bg-bg-selected focus-visible:outline-2 focus-visible:outline-accent ${sessionSearchOpen ? "bg-bg-selected text-accent" : "bg-bg-hover text-text-muted"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
              </svg>
            </button>
            <button className="pi-sidebar-icon" type="button" onClick={handleCustomPathClick} title={t("sidebar.selectProject")} aria-label={t("sidebar.selectProject")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 6H9L7 3H3v17h18v-8M18 2v8M14 6h8"/></svg>
            </button>
          </div>
        </div>
        )}
        </div>

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}

      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Session list */}
      <SessionSearch open={sessionSearchOpen} query={sessionSearchQuery} refreshKey={sessionListVersion} selectedSessionId={selectedSessionId} onSelectSession={handleSelectSessionFromList} visibleSessionIds={visibleSessionIds}>
      <div
        ref={listScrollRef}
        className="pi-session-list-scroll"
        onScroll={handleListScroll}
        style={{ flex: "1 1 auto", overflowY: "auto", padding: "0", marginRight: 6, minHeight: 0 }}
      >
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && projectTreeRows.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.noSessions")}
          </div>
        )}
        {projectTreeRows.length > 0 && (
          <div
            style={{
              position: "relative",
              height: projectTreeHeight,
            }}
          >
            {virtualIndices.map((index) => {
              const row = projectTreeRows[index];
              if (row.kind === "date") return <div key={row.key} style={{ position: "absolute", top: projectTreeRowOffsets[index], left: 18, right: 8, height: row.height, display: "flex", alignItems: "center", fontSize: 11, color: "var(--text-dim)" }}>{row.label}</div>;
              if (row.kind === "project") {
                const collapsed = collapsedProjectKeys.has(row.key);
                const activity = projectActivity.get(row.key);
                const name = workspaceDisplayName(row.root);
                return (
                  <div
                    key={`project:${row.key}`}
                    className="pi-project-tree-header"
                    onMouseEnter={(event) => { keepWorkspaceHover(); setHoveredWorkspaceKey(row.key); const rect = event.currentTarget.getBoundingClientRect(); setWorkspaceHover({ key: row.key, root: row.root, right: rect.right, left: rect.left, top: rect.top }); event.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(event) => { setHoveredWorkspaceKey(null); closeWorkspaceHoverLater(); event.currentTarget.style.background = "transparent"; }}
                    aria-describedby={workspaceHover?.key === row.key ? "workspace-hover-info" : undefined}
                    onPointerDown={() => setWorkspaceHover(null)}
                    style={{ position: "absolute", top: projectTreeRowOffsets[index], left: 8, right: 8, height: row.height - 2, marginBlock: 1, borderRadius: 8, display: "flex", flexDirection: "row", alignItems: "center", gap: 7, width: "calc(100% - 16px)", minWidth: 0, padding: "0 4px", border: "none", background: "transparent", color: "var(--text-muted)", textAlign: "left", fontSize: 12, overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer" }}
                  >
                    <button type="button"
                    onClick={() => setCollapsedProjectKeys((current) => {
                      const next = new Set(current);
                      if (next.has(row.key)) next.delete(row.key);
                      else next.add(row.key);
                      return next;
                    })}
                    aria-expanded={!collapsed}
                      style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0, border: 0, background: "transparent", color: "inherit", padding: 0, textAlign: "left", cursor: "pointer" }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: collapsed ? "none" : "rotate(90deg)", transition: "transform 0.15s" }} aria-hidden="true">
                      <polyline points="3 2 7 5 3 8" />
                    </svg>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.7" style={{ flexShrink: 0 }} aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/></svg>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{name}</span>
                    </button>
                    {showProjectActivity(activity, t)}
                    <div className="pi-project-row-actions" style={{ display: hoveredWorkspaceKey === row.key ? "flex" : "none", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button type="button" className="pi-session-action pi-workspace-action" aria-label="更多操作" title="更多操作" aria-haspopup="menu" aria-expanded={workspaceMenu?.key === row.key} onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setWorkspaceMenu({ root: row.root, key: row.key, x: Math.max(8, Math.min(rect.right - 150, window.innerWidth - 158)), y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 90)) });
                    }} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, flexShrink: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button>
                    {!workspaceStatus[row.key] && <button type="button" className="pi-session-action pi-workspace-action" aria-label="新建会话" title="新建会话" onClick={() => {
                      setSelectedCwd(row.root);
                      setArchiveView(false);
                      const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
                      onNewSession?.(id, row.root);
                    }} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, flexShrink: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>}
                    </div>
                  </div>
                );
              }
              const family = row.family;
              const familySessions = [family.root, ...family.subagents];
              const displaySession = family.latestModified === family.root.modified
                ? family.root
                : { ...family.root, modified: family.latestModified };
              // Bubble blur after the input's save handler before unpinning the row.
              return (
                <div
                  key={family.root.id}
                  onFocus={() => setFocusedSessionId(family.root.id)}
                  onBlur={() => setFocusedSessionId(null)}
                  style={{ position: "absolute", top: projectTreeRowOffsets[index], left: 0, right: 0 }}
                >
                  <InfoHoverCard sessionId={family.root.id} fields={[
                    ["会话名", family.root.name || "未命名"],
                    ["会话 ID", family.root.id],
                    ["会话文件路径", family.root.path || "尚未保存"],
                    ["所在工作区", workspaceName(projectFor(family.root.cwd)?.root ?? family.root.cwd)],
                    ["所在工作区路径", projectFor(family.root.cwd)?.root ?? family.root.cwd],
                    ["活跃时间", new Date(family.latestModified).toLocaleString()],
                    ["创建时间", new Date(family.root.created).toLocaleString()],
                  ]}>
                  <SessionItem
                    session={displaySession}
                    projectLabel={recentView ? workspaceDisplayName(projectFor(family.root.cwd)?.root ?? family.root.cwd) : undefined}
                    isSelected={familySessions.some((session) => session.id === selectedSessionId)}
                    isRunning={familySessions.some((session) => runningSessionIds.has(session.id))}
                    isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))}
                    onClick={() => handleSelectSessionFromList(family.root)}
                    onRenamed={loadSessions}
                    onDeleted={(id) => {
                      onSessionDeleted?.(id);
                      loadSessions();
                    }}
                    archived={archiveView}
                    onArchiveToggle={() => setArchivedFamilyIds((current) => {
                      const next = new Set(current);
                      if (next.has(family.root.id)) next.delete(family.root.id);
                      else next.add(family.root.id);
                      saveArchivedSessionFamilyIds(next);
                      return next;
                    })}
                  />
                  </InfoHoverCard>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </SessionSearch>
      </div>
      {fileExplorerPortalTarget && createPortal(<div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {!(selectedCwdProp || selectedCwd) && <div style={{ padding: 14, color: "var(--text-muted)", fontSize: 12 }}>{t("sidebar.selectProject")}</div>}

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: "1 1 0",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((open) => {
                const next = !open;
                saveExplorerOpen(next);
                return next;
              })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              {t("files.explorer")}
            </button>
            {onOpenTerminal && (
              <ToolbarIconButton
                onClick={() => onOpenTerminal(selectedCwd ?? selectedCwdProp!)}
                title={t("terminal.open")}
                color="var(--text-dim)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => {
                  setFileSearchOpen((open) => !open);
                }}
                title={t("sidebar.searchFiles")}
                ariaPressed={fileSearchOpen}
                color={fileSearchOpen ? "var(--accent)" : "var(--text-dim)"}
                background={fileSearchOpen ? "var(--bg-selected)" : "none"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("sidebar.uploadFilesTitle")}
                color="var(--text-dim)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </ToolbarIconButton>
            )}
            <ToolbarIconButton
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("sidebar.refreshExplorer")}
              skipHover={explorerRefreshDone}
              color={explorerRefreshDone ? "#4ade80" : "var(--text-dim)"}
              background={explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none"}
              marginRight={6}
            >
              {explorerRefreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </ToolbarIconButton>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, minHeight: 0, marginRight: 6, marginBottom: 6, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
                changesCollapsed={!changesView}
                onChangesCountChange={setChangesCount}
                fileSearchOpen={fileSearchOpen}
                onFileSearchOpenChange={setFileSearchOpen}
              />
            </div>
          )}
        </div>
      )}
      </div>, fileExplorerPortalTarget)}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, flexShrink: 0, borderTop: "1px solid var(--border)" }}>
        {branchPortalTarget && createPortal(<div style={{ minWidth: 0, width: 190, maxWidth: "100%" }}>
        {showWorktreeSwitcher && (() => {
          if (!worktreeState) return null;
          const showWtFilter = worktreeState.worktrees.length >= 8;
          const visibleWorktrees = showWtFilter && wtFilter.trim()
            ? worktreeState.worktrees.filter((w) =>
                (w.branch ?? displayCwd(w.path, homeDir)).toLowerCase().includes(wtFilter.trim().toLowerCase()))
            : worktreeState.worktrees;
          return (
            <div ref={wtDropdownRef} style={{ position: "relative", marginTop: 0 }}>
              <button
                onClick={() => setWtDropdownOpen((v) => !v)}
                 title={currentWorktree ? t("sidebar.switchWorktreeTitle", { path: currentWorktree.path }) : t("sidebar.switchWorktree")}
                style={{
                  width: "100%",
                  height: 29,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: "var(--text-muted)",
                  textAlign: "left",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: currentWorktree && !currentWorktree.isMain ? "var(--accent)" : "var(--text-dim)" }}>
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                <PathLabel
                  text={currentWorktree ? (currentWorktree.branch ?? displayCwd(currentWorktree.path, homeDir)) : "…"}
                  style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
                />
                {currentWorktree?.isMain && (
                   <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>
                )}
                {worktreeState.worktrees.length > 1 && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
                    {worktreeState.worktrees.length}
                  </span>
                )}
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="2 3.5 5 6.5 8 3.5" />
                </svg>
              </button>

              <AnimatedDropdown
                open={wtDropdownOpen}
                anchorRef={wtDropdownRef}
                panelRef={wtPanelRef}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 4px)",
                  left: 0,
                  width: "max(100%, 260px)",
                  maxWidth: "calc(100vw - 32px)",
                  maxHeight: "70dvh",
                  overflowY: "auto",
                  zIndex: 100,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                  overflowX: "hidden",
                }}
              >
                  {showWtFilter && (
                    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      <input
                        value={wtFilter}
                        onChange={(e) => setWtFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setWtFilter("");
                            setWtDropdownOpen(false);
                          }
                        }}
                        placeholder={t("sidebar.filterWorktrees")}
                        autoFocus
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  )}
                  <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                    {visibleWorktrees.map((wt) => {
                      const isCurrent = wt.path === currentWorktreePath;
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}>
                            <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t("sidebar.forceRemoveCheckout")}
                            </span>
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, true)}
                              disabled={wtBusy}
                              style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("sidebar.force")}
                            </button>
                            <button
                              onClick={() => setWtConfirmRemove(null)}
                              style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("sidebar.cancel")}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={wt.path}
                          className="wt-row"
                          style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
                        >
                          <button
                            onClick={() => {
                              setSelectedCwd(wt.path);
                              setWtDropdownOpen(false);
                              setWtError(null);
                              setWtFilter("");
                            }}
                            title={wt.path}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "8px 10px",
                              background: "var(--bg)",
                              border: "none",
                              color: isCurrent ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {isCurrent ? (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <polyline points="1.5 5 4 7.5 8.5 2.5" />
                              </svg>
                            ) : (
                              <span style={{ width: 10, flexShrink: 0 }} />
                            )}
                            <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                            {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>}
                          </button>
                          {!wt.isMain && (
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, false)}
                              disabled={wtBusy}
                               title={t("sidebar.removeWorktreeTitle", { path: wt.path })}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                width: 34, height: 28, padding: 0, marginRight: 4,
                                background: "none", border: "none",
                                color: "var(--text-dim)", cursor: "pointer",
                                borderRadius: 5, flexShrink: 0,
                                transition: "color 0.12s, background 0.12s",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {showWtFilter && visibleWorktrees.length === 0 && wtFilter.trim() && (
                      <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingWorktrees")}</div>
                    )}
                  </div>

                  {!wtNewOpen ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title={t("sidebar.createWorktreeTitle")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        width: "100%",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 11,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                        <line x1="5" y1="1" x2="5" y2="9" />
                        <line x1="1" y1="5" x2="9" y2="5" />
                      </svg>
                       <span>{t("sidebar.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px" }}>
                      <input
                        ref={wtNewInputRef}
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                         placeholder={t("sidebar.branchName")}
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--accent)",
                          borderRadius: 5,
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                        <button
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtNewBranch.trim()}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--accent)",
                            border: "none",
                            borderRadius: 5,
                            color: "var(--accent-contrast)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                            opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                          }}
                        >
                           {wtBusy ? t("sidebar.creating") : t("sidebar.create")}
                        </button>
                        <button
                          onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            borderRadius: 5,
                            color: "var(--text-muted)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                           {t("sidebar.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {wtError && (
                    <div style={{
                      padding: "5px 10px 8px",
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
              </AnimatedDropdown>
            </div>
          );
        })()}
        {inactiveWorktreeSelector && (
          <button
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            title={inactiveWorktreeSelector.title}
            style={{
              width: "100%",
              height: 29,
              boxSizing: "border-box",
              marginTop: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-hover)",
              color: "var(--text-dim)",
              fontSize: 11,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              textAlign: "left",
              cursor: "default",
              opacity: 0.82,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
          </button>
        )}
        </div>, branchPortalTarget)}
        {footerAction}
      </div>
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#0891b2",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

/**
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <g>
              <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </g>
          </svg>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0891b2", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}

function SessionItem({
  projectLabel,
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
  archived = false,
  onArchiveToggle,
}: {
  projectLabel?: ReactNode;
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  archived?: boolean;
  onArchiveToggle?: () => void;
}) {
  const { locale, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  useEffect(() => {
    if (!menuPosition) return;
    const close = (event: MouseEvent) => {
      // The menu itself stops propagation; any other click closes it.
      if (!(event.target as Element).closest("[data-session-actions-menu]")) setMenuPosition(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuPosition(null); };
    const reposition = () => setMenuPosition(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [menuPosition]);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  const title = session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.transient) return;
    setRenameValue(session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12));
    setRenaming(true);
  }, [session.name, session.transient, displayFirstMessage, session.id]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed displayFirstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed, title]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, session.transient, onDeleted]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setConfirmDelete(true);
    }
  }, [performDelete]);

  const openActionsMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition({ top: Math.min(rect.bottom + 4, window.innerHeight - 84), right: Math.max(8, window.innerWidth - rect.right) });
  }, []);

  const toggleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuPosition(null);
    onArchiveToggle?.();
  }, [onArchiveToggle]);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <div className="pi-session-row"
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: projectLabel ? 48 : SESSION_LIST_ITEM_HEIGHT - 2,
        marginBlock: 1,
        paddingTop: 0,
        paddingBottom: 0,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {t("sidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          <span
            title={`${title} · ${t("sidebar.messagesCount", { count: session.messageCount })}${session.branch ? ` · ${session.branch}` : ""}`}
            style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: isSelected ? 500 : 400, color: "var(--text)" }}
          >
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
            {projectLabel && <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis" }}>{projectLabel}</span>}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: projectLabel ? 18 : 0, flexShrink: 0, whiteSpace: "nowrap", fontSize: 11, color: "var(--text-dim)" }}>
            {isRunning ? <RunningSessionIndicator /> : isUnread ? <UnreadSessionIndicator /> : null}
            <span title={session.modified}>{formatRelativeTime(session.modified, locale)}</span>
          </span>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {(hovered || menuPosition) && !session.transient && <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button className="pi-session-action" onMouseEnter={(e) => { e.currentTarget.style.background = "#c5dcef"; e.currentTarget.style.color = "#234f73"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }} onPointerDown={(e) => { e.currentTarget.style.background = "#a9c9e3"; }} onPointerUp={(e) => { e.currentTarget.style.background = "#c5dcef"; }} onPointerCancel={(e) => { e.currentTarget.style.background = "none"; }} onClick={openActionsMenu} title={t("sidebar.moreActions")} aria-label={t("sidebar.moreActions")} aria-expanded={Boolean(menuPosition)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
            </button>
            <button className="pi-session-action" onMouseEnter={(e) => { e.currentTarget.style.background = "#c5dcef"; e.currentTarget.style.color = "#234f73"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }} onPointerDown={(e) => { e.currentTarget.style.background = "#a9c9e3"; }} onPointerUp={(e) => { e.currentTarget.style.background = "#c5dcef"; }} onPointerCancel={(e) => { e.currentTarget.style.background = "none"; }} onClick={toggleArchive} title={t(archived ? "sidebar.restore" : "sidebar.archive")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, background: "none", border: "none", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}>
              {archived ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v13H3z"/><path d="M3 7l3-4h12l3 4M12 17v-7m-3 3 3-3 3 3"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v13H3z"/><path d="M3 7l3-4h12l3 4M9 11h6"/></svg>}
            </button>
          </div>}
          {menuPosition && createPortal(<div data-session-actions-menu onClick={(event) => event.stopPropagation()} style={{ position: "fixed", top: menuPosition.top, right: menuPosition.right, zIndex: 1100, minWidth: 130, padding: 4, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-panel)", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
            <button type="button" onClick={(event) => { setMenuPosition(null); startRename(event); }} style={{ display: "block", width: "100%", padding: "6px 8px", border: "none", borderRadius: 4, background: "none", color: "var(--text)", textAlign: "left", cursor: "pointer", fontSize: 12 }}>{t("sidebar.rename")}</button>
            <button type="button" onClick={(event) => { setMenuPosition(null); handleDeleteClick(event); }} title={t("sidebar.deleteWithShiftClick")} style={{ display: "block", width: "100%", padding: "6px 8px", border: "none", borderRadius: 4, background: "none", color: "#ef4444", textAlign: "left", cursor: "pointer", fontSize: 12 }}>{t("sidebar.delete")}</button>
          </div>, document.body)}
        </>
      )}
    </div>
  );
}

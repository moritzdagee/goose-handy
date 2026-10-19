// The roam web client UI, built on goose's real desktop componentry:
//   - MarkdownContent (react-markdown + katex + syntax highlighting)
//   - ToolCallStatusIndicator (live status dot)
// wired to a roaming ACP connection (GooseClient over the iroh wasm duplex).
//
// DOM ids/classes (#my-card, #connect-btn, .msg.agent, …) are kept identical
// to the previous vanilla UI so tests/e2e.mjs and tests/visual.mjs still work.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type PlanEntry,
  type ContentBlock,
} from "@agentclientprotocol/sdk";
import { GooseClient } from "@aaif/goose-sdk";
import jsQR from "jsqr";
import { Button } from "@desktop/components/ui/button";
import { ChevronDown, ChevronLeft, ChevronRight, Menu, Paperclip, Plus, SlidersHorizontal, Square, X } from "lucide-react";
import { StartPage } from "./StartPage";
import { readAttachment, promptBlocks, promptPreview, type Attachment } from "./attachments";
import {
  LOAD_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  TimeoutError,
  RESUME_CHECK_AFTER_MS,
  RESUME_REDIAL_AFTER_MS,
  isPairingError,
  retryDelay,
  withTimeout,
} from "./reconnect";
import MarkdownContent from "@desktop/components/MarkdownContent";
import { Goose } from "@desktop/components/icons/Goose";
import { ToolCallStatusIndicator, type ToolCallStatus } from "@desktop/components/ToolCallStatusIndicator";
import type { RoamClient } from "./wasm/goose_roaming_web.js";
import { roamByteStreams } from "./roam-stream.js";
import { continuesBubble, joinChunk } from "./chunks";
import {
  HOST_CARD_KEY,
  HOSTS_KEY,
  SESSION_KEY,
  COLLAPSED_KEY,
  type SavedHost,
  type HostConn,
  loadHosts,
  hostRank,
  hostLabel,
  cardEndpointHint,
  relayRegion,
  loadCollapsed,
} from "./hosts";
import {
  newSessionMeta,
  filterByArchive,
  filterByHost,
  groupSessions,
  listAllSessions,
  loadArchiveFilter,
  loadHostFilter,
  mergeHostLists,
  saveArchiveFilter,
  saveHostFilter,
  type ArchiveFilter,
  type HostFilter,
  type TaggedSession,
} from "./sessions";
import {
  cacheableItems,
  loadChat,
  loadSessions as loadCachedSessions,
  saveChat,
  saveSessions as saveCachedSessions,
  type CachedItem,
} from "./cache";
import { HostFilterBar } from "./HostFilterBar";
import { ArchiveFilterBar } from "./ArchiveFilterBar";
import { ConnectPanel } from "./ConnectPanel";

type PermOption = { optionId: string; name: string; kind: string };

type Item =
  | { kind: "msg"; id: number; role: "user" | "agent" | "thought"; text: string }
  | { kind: "system"; id: number; text: string }
  | {
      kind: "tool";
      id: number;
      toolCallId: string;
      title: string;
      status: ToolCallStatus;
      output: string;
    }
  | { kind: "plan"; id: number; entries: PlanEntry[] }
  | {
      kind: "perm";
      id: number;
      title: string;
      options: PermOption[];
      chosen: string | null;
      resolve: (optionId: string | null) => void;
    };

const ACP_TOOL_STATUS: Record<string, ToolCallStatus> = {
  pending: "pending",
  in_progress: "loading",
  completed: "success",
  failed: "error",
};

function ToolRow({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool w-full">
      <Button
        onClick={() => setOpen((v) => !v)}
        variant="ghost"
        className="group w-full flex justify-between items-center pr-2 transition-colors rounded-none h-8 px-2"
      >
        <span className="flex items-center gap-2 font-sans text-sm truncate flex-1 min-w-0 text-text-secondary">
          <span className="relative inline-block w-2.5 shrink-0">
            <ToolCallStatusIndicator status={item.status} className="static" />
          </span>
          <span className="truncate">{item.title}</span>
        </span>
        <ChevronRight
          className={`w-4 h-4 shrink-0 opacity-70 group-hover:opacity-100 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </Button>
      {open && (
        <div className="border-t border-border-primary px-2 py-2">
          {item.output ? (
            <pre className="bg-background-secondary rounded-lg p-2.5 overflow-x-auto max-h-80 overflow-y-auto font-mono text-xs whitespace-pre-wrap break-words">
              {item.output}
            </pre>
          ) : (
            <div className="text-xs text-text-tertiary px-1">no output yet</div>
          )}
        </div>
      )}
    </div>
  );
}

function contentText(content: unknown): string {
  const c = content as { type?: string; text?: string } | undefined;
  if (!c) return "";
  return c.type === "text" ? (c.text ?? "") : `[${c.type}]`;
}

// goose surfaces session configuration (provider, model, mode, thinking
// effort) via ACP's generic session config options — selects the client
// renders and sets back with session/set_config_option. Keep the raw array
// so the settings panel can render all of them, plus a helper to resolve
// the current model's display name for the header badge.
type ConfigSelectOption = { id: string; name: string; options?: ConfigSelectOption[] };
type ConfigOption = {
  type: string;
  id: string;
  name: string;
  description?: string | null;
  currentValue?: string | boolean;
  options?: ConfigSelectOption[];
};

// "just now", "4m", "2h", "3d" — compact relative time for session rows.
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// Same liveness rule the constellation and hot chip use: updated <5 min ago.
function isSessionLive(s: { updatedAt?: string | null }): boolean {
  return !!s.updatedAt && Date.now() - new Date(s.updatedAt).getTime() < 5 * 60 * 1000;
}

// Ticking elapsed readout for the working indicator ("12s", "1m 04s").
function LiveElapsed({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const label =
    secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
  return (
    <span className="font-mono tabular-nums text-text-tertiary" id="turn-elapsed">
      {label}
    </span>
  );
}

function flatSelectOptions(opt: ConfigOption): ConfigSelectOption[] {
  return (opt.options ?? []).flatMap((x) => (x.options ? x.options : [x]));
}

function modelFromConfigOptions(opts: ConfigOption[] | null | undefined): string | null {
  const opt = opts?.find((o) => o.type === "select" && /model/i.test(o.id));
  if (!opt) return null;
  const current = typeof opt.currentValue === "string" ? opt.currentValue : null;
  return flatSelectOptions(opt).find((x) => x.id === current)?.name ?? current;
}

declare const __BUILD_STAMP__: string;
const BUILD = typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "dev";

// How many trailing messages to ask the server to replay on session open.
// The server rounds up to a turn boundary and reports how many older
// messages it skipped via replaySkipped in the response meta.
const REPLAY_TAIL = 200;

let nextId = 1;

// Cached chat tail back into screen items (fresh ids, no live callbacks).
function fromCache(cached: CachedItem[]): Item[] {
  return cached.map((c) =>
    c.kind === "tool"
      ? { ...c, id: nextId++, status: c.status as ToolCallStatus }
      : c.kind === "plan"
        ? { kind: "plan", id: nextId++, entries: c.entries as PlanEntry[] }
        : ({ ...c, id: nextId++ } as Item),
  );
}

export function App({ roam }: { roam: RoamClient }) {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("not connected");
  const [statusKind, setStatusKind] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [connected, setConnected] = useState(false);
  const [agentId, setAgentId] = useState("");
  // Starts with the list remembered from last time, so the first frame after
  // a launch or an iOS reload already shows the chats.
  const [sessions, setSessions] = useState<TaggedSession[]>(loadCachedSessions);
  const [hostFilter, setHostFilterState] = useState<HostFilter>(loadHostFilter);
  const [archiveFilter, setArchiveFilterState] = useState<ArchiveFilter>(loadArchiveFilter);
  const setArchiveFilter = useCallback((f: ArchiveFilter) => {
    setArchiveFilterState(f);
    saveArchiveFilter(f);
  }, []);
  const setHostFilter = useCallback((f: HostFilter) => {
    setHostFilterState(f);
    saveHostFilter(f);
  }, []);
  // A chat is being (re)loaded from its machine. Separate from busy (a turn
  // is running): typing stays possible, the message goes out once loaded.
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeHostId, setActiveHostId] = useState<string | null>(null);
  const [logWindow, setLogWindow] = useState(80);
  const [busy, setBusy] = useState(false);
  // Navigation never waits for the open chat: "new chat" and "back" only
  // block while a new chat is being created. navToken bumps on every switch
  // so late results of the chat we left (a running turn, a slow load) can
  // tell they are stale and leave the screen alone.
  const [creating, setCreating] = useState(false);
  const [pickHost, setPickHost] = useState(false);
  const navToken = useRef(0);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // True while re-dialing a known host (boot restore or dropped connection).
  // Shows a quiet "connecting…" screen instead of flashing the hosts page.
  const [reconnecting, setReconnecting] = useState(false);
  // When the current turn started (ours or a steered one) — drives the live
  // elapsed readout in the working indicator, paseo-style.
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelName, setModelName] = useState<string | null>(null);
  // Full config option set for the open session (provider/model/mode/…),
  // rendered in the session settings sheet and set back over ACP.
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [relay, setRelay] = useState<string | null>(null);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // best effort
      }
      return next;
    });
  }, []);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const activeRunRef = useRef<string | null>(null);
  // Loop-boundary guard (L0): the open session is advancing but our
  // connection holds no activeRunId — a loop in another process (desktop,
  // CLI, scheduler) is driving it. Watch, but warn before sending: a plain
  // prompt would start a second loop against the same session. The composer
  // stays usable only after an explicit "send anyway".
  const [externalActive, setExternalActive] = useState(false);
  const [externalOverride, setExternalOverride] = useState(false);
  const [card, setCard] = useState("");
  const hostsRef = useRef<Map<string, HostConn>>(new Map());
  const activeHostRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const streamRole = useRef<"user" | "agent" | "thought" | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [scanning, setScanning] = useState(false);
  const [hosts, setHosts] = useState<SavedHost[]>(loadHosts);
  const [addingHost, setAddingHost] = useState(false);
  // Auto-expanded when a dial is rejected as not-paired (e.g. first scan of
  // the desktop QR): the very next thing the user needs is their own card.
  const [pairOpen, setPairOpen] = useState(false);
  // Reopens the connect panel while connected, to dial additional hosts into
  // the same consolidated workspace.
  const [showHosts, setShowHosts] = useState(false);
  const [hostName, setHostName] = useState("");
  // Chat that was open on a host whose link dropped: reloaded once that host
  // is back. The chat stays on screen meanwhile (sessionRef is kept).
  const pendingResync = useRef<string | null>(null);
  // Hosts with a dial in flight, so resume checks and retries never stack.
  const dialing = useRef<Set<string>>(new Set());
  const [dialCount, setDialCount] = useState(0);
  // The open chat's machine is unreachable right now; composer waits.
  const [linkDown, setLinkDown] = useState(false);
  // A message typed while the link was down goes out by itself once the
  // chat is reloaded after the redial.
  const sendWhenBack = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanStop = useRef<(() => void) | null>(null);
  // BarcodeDetector: Chrome/Android today; feature-detected so the button
  // simply doesn't render where unsupported (iOS Safari needs a lib later).
  const canScan =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const startScan = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setScanning(true);
      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play();
        }
      });
      // BarcodeDetector on Chrome/Android; jsQR canvas fallback elsewhere (iOS Safari).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const native = "BarcodeDetector" in window ? new (window as any).BarcodeDetector({ formats: ["qr_code"] }) : null;
      const canvas = document.createElement("canvas");
      const detect = async (video: HTMLVideoElement): Promise<string | null> => {
        if (native) {
          const codes = await native.detect(video);
          return codes.find((c: { rawValue: string }) => c.rawValue.startsWith("goose+roam://"))?.rawValue ?? null;
        }
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return null;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const hit = jsQR(img.data, w, h);
        return hit?.data.startsWith("goose+roam://") ? hit.data : null;
      };
      let active = true;
      scanStop.current = () => {
        active = false;
        stream.getTracks().forEach((t) => t.stop());
        setScanning(false);
      };
      const tick = async () => {
        if (!active) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            const hit = await detect(video);
            if (hit) {
              setCard(hit);
              scanStop.current?.();
              return;
            }
          } catch {
            // keep scanning
          }
        }
        setTimeout(() => void tick(), 250);
      };
      void tick();
    } catch (err) {
      setScanning(false);
      setStatus(`camera unavailable: ${err}`);
      setStatusKind("err");
    }
  }, []);

  const myCard = roam.myCard();
  const myId = roam.endpointId();

  // Autoscroll only when the user is already near the bottom, so reading
  // back through history isn't yanked away by streaming updates.
  const atBottom = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [connected]);
  useEffect(() => {
    if (atBottom.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [items]);

  // Remember where the user was across refreshes: reconnect the last host
  // and reopen the last session. Without the session half, every reload
  // dumped the user back on the front page (issue #10906 feedback).
  const bootTried = useRef(false);
  useEffect(() => {
    if (bootTried.current) return;
    bootTried.current = true;
    // Deep link: the desktop QR encodes <app-url>#card=goose+roam://… so
    // scanning it opens this app with the host already filled in. The card
    // rides the fragment (never sent to the server) and is scrubbed from the
    // address bar immediately.
    const hash = window.location.hash;
    if (hash.includes("goose+roam://")) {
      const linked = decodeURIComponent(
        hash.slice(hash.indexOf("goose+roam://")),
      ).trim();
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setCard(linked);
      setAddingHost(true);
      // Try connecting right away: if this browser is already paired we land
      // in sessions; if not, the host rejects us and the connect panel (with
      // the "first time? pair this browser" card) is already on screen.
      void connect(linked);
      return;
    }
    // Dial every known host (built-in machines included) and land on the
    // start page. Reopening the last chat on launch trapped the phone inside
    // it: starting a new request meant first getting out of a chat that the
    // desktop was often still driving.
    const saved = loadHosts().sort((a, b) => hostRank(a.endpointId) - hostRank(b.endpointId));
    if (saved.length === 0) return;
    setCard(saved[0].card);
    setReconnecting(true);
    dialAllRef.current(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // During loadSession the server replays the entire history as individual
  // notifications; applying each via setState re-renders hundreds of times
  // (the "chonky open"). While replayBuf is set, handlers mutate it
  // synchronously instead, and openSession flushes once.
  const replayBuf = useRef<Item[] | null>(null);
  const mutateItems = useCallback((fn: (xs: Item[]) => Item[]) => {
    if (replayBuf.current) {
      replayBuf.current = fn(replayBuf.current);
    } else {
      setItems(fn);
    }
  }, []);

  const push = useCallback((item: Omit<Item, "id">) => {
    streamRole.current = null;
    mutateItems((xs) => [...xs, { ...item, id: nextId++ } as Item]);
  }, [mutateItems]);

  const lastMessageId = useRef<string | undefined>(undefined);
  const chunk = useCallback((role: "user" | "agent" | "thought", text: string, messageId?: string) => {
    mutateItems((xs) => {
      const last = xs[xs.length - 1];
      const prevId = lastMessageId.current;
      lastMessageId.current = messageId;
      if (
        last?.kind === "msg" && last.role === role &&
        continuesBubble(role, text, streamRole.current, messageId, prevId)
      ) {
        return [...xs.slice(0, -1), { ...last, text: joinChunk(role, last.text, text) }];
      }
      streamRole.current = role;
      return [...xs, { kind: "msg", id: nextId++, role, text }];
    });
  }, [mutateItems]);

  const makeClient = useCallback((): Client => {
    return {
      async sessionUpdate(params: SessionNotification): Promise<void> {
        // A chat we navigated away from may still be streaming its turn.
        if (params.sessionId !== sessionRef.current) return;
        const u = params.update;
        switch (u.sessionUpdate) {
          case "user_message_chunk":
            chunk("user", contentText(u.content), (u as { messageId?: string }).messageId);
            break;
          case "agent_message_chunk":
            chunk("agent", contentText(u.content), (u as { messageId?: string }).messageId);
            break;
          case "agent_thought_chunk":
            chunk("thought", contentText(u.content), (u as { messageId?: string }).messageId);
            break;
          case "tool_call": {
            streamRole.current = null;
            const t = u;
            setStatus(`tool: ${(t.title ?? "running").slice(0, 28)}`);
            setStatusKind("busy");
            mutateItems((xs) => [
              ...xs,
              {
                kind: "tool",
                id: nextId++,
                toolCallId: t.toolCallId,
                title: t.title ?? "tool",
                status: ACP_TOOL_STATUS[t.status ?? "pending"] ?? "pending",
                output: "",
              },
            ]);
            break;
          }
          case "tool_call_update": {
            const t = u;
            mutateItems((xs) =>
              xs.map((it) =>
                it.kind === "tool" && it.toolCallId === t.toolCallId
                  ? {
                      ...it,
                      title: t.title ?? it.title,
                      status: t.status ? (ACP_TOOL_STATUS[t.status] ?? it.status) : it.status,
                      output:
                        t.content
                          ?.map((c) => (c.type === "content" ? contentText(c.content) : ""))
                          .join("\n")
                          .trim() || it.output,
                    }
                  : it,
              ),
            );
            break;
          }
          case "config_option_update": {
            const opts = ((u as { configOptions?: unknown[] }).configOptions ?? []) as ConfigOption[];
            setConfigOptions(opts);
            const m = modelFromConfigOptions(opts);
            if (m) setModelName(m);
            break;
          }
          case "session_info_update": {
            // The server advertises the active prompt run (or its end) via
            // _meta.goose.activeRunId; this is the real "agent is running"
            // signal, and it tells send() to steer instead of prompt.
            const meta = (u as { _meta?: { goose?: { activeRunId?: string | null } } })._meta;
            if (meta?.goose && "activeRunId" in meta.goose) {
              const run = meta.goose.activeRunId ?? null;
              activeRunRef.current = run;
              setActiveRun(run);
            }
            break;
          }
          case "plan": {
            streamRole.current = null;
            const entries = u.entries;
            mutateItems((xs) => {
              const i = xs.findIndex((it) => it.kind === "plan");
              if (i >= 0) {
                const copy = [...xs];
                copy[i] = { ...(copy[i] as Extract<Item, { kind: "plan" }>), entries };
                return copy;
              }
              return [...xs, { kind: "plan", id: nextId++, entries }];
            });
            break;
          }
        }
      },
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        if (params.sessionId !== sessionRef.current) return { outcome: { outcome: "cancelled" } };
        const optionId = await new Promise<string | null>((resolve) => {
          streamRole.current = null;
          setItems((xs) => [
            ...xs,
            {
              kind: "perm",
              id: nextId++,
              title: params.toolCall?.title ?? "the agent",
              options: params.options.map((o) => ({
                optionId: o.optionId,
                name: o.name,
                kind: o.kind,
              })),
              chosen: null,
              resolve,
            },
          ]);
        });
        if (optionId) return { outcome: { outcome: "selected", optionId } };
        return { outcome: { outcome: "cancelled" } };
      },
    };
  }, [chunk, mutateItems]);

  // The host whose session is open (or the only/last-connected one). Chat
  // actions go here; list actions fan out over all hosts.
  const activeAgent = useCallback((): GooseClient | null => {
    const hid = activeHostRef.current;
    if (hid) return hostsRef.current.get(hid)?.agent ?? null;
    const first = hostsRef.current.values().next();
    return first.done ? null : first.value.agent;
  }, []);

  // Consolidated list: every connected host contributes its sessions, tagged
  // with the host they live on. One slow host can't hide the others.
  const refreshSessions = useCallback(async () => {
    const conns = [...hostsRef.current.values()];
    if (conns.length === 0) return;
    const lists = await Promise.all(
      conns.map(async (h): Promise<[string, TaggedSession[] | null]> => {
        try {
          const all = await listAllSessions((cursor) =>
            withTimeout(h.agent.listSessions(cursor ? { cursor } : {}), PROBE_TIMEOUT_MS, h.name),
          );
          return [h.endpointId, all.map((s) => ({ ...s, _host: h.endpointId }))];
        } catch (err) {
          console.warn(`listSessions failed for ${h.name}:`, err);
          return [h.endpointId, null];
        }
      }),
    );
    // A machine that did not answer keeps its chats on screen.
    setSessions((prev) => mergeHostLists(prev, new Map(lists)));
  }, []);

  useEffect(() => {
    if (sessions.length) saveCachedSessions(sessions);
  }, [sessions]);

  // Keep the open chat's tail for the next visit (and the next iOS reload).
  const chatSnap = useRef<{ host: string; sid: string; items: Item[] } | null>(null);
  const saveOpenChat = useCallback(() => {
    const snap = chatSnap.current;
    if (snap && snap.items.length) {
      saveChat(snap.host, snap.sid, cacheableItems(snap.items as unknown as Array<{ kind: string } & Record<string, unknown>>));
    }
  }, []);
  useEffect(() => {
    if (!sessionId || !activeHostId || loading || items.length === 0) {
      chatSnap.current = null;
      return;
    }
    chatSnap.current = { host: activeHostId, sid: sessionId, items };
    const t = setTimeout(saveOpenChat, 800);
    return () => clearTimeout(t);
  }, [items, sessionId, activeHostId, loading, saveOpenChat]);

  // Projects are ordinary ACP: sources/list with type "project" returns
  // slug + title; sessions carry projectId in _meta. Keyed "<host>:<slug>"
  // because slugs are only unique per machine.
  const refreshProjects = useCallback(async () => {
    const conns = [...hostsRef.current.values()];
    if (conns.length === 0) return;
    const maps = await Promise.all(
      conns.map(async (h) => {
        try {
          const res = (await h.agent.extMethod("_goose/unstable/sources/list", {
            type: "project",
          })) as { sources?: { name: string; properties?: Record<string, unknown> }[] };
          const map: Record<string, string> = {};
          for (const s of res.sources ?? []) {
            const title = s.properties?.["title"];
            map[`${h.endpointId}:${s.name}`] =
              typeof title === "string" && title ? title : s.name;
          }
          return map;
        } catch (err) {
          console.warn(`sources/list failed for ${h.name}:`, err);
          return {};
        }
      }),
    );
    setProjects(Object.assign({}, ...maps));
  }, []);

  // Close the open chat on this screen only. Its turn keeps running on the
  // host; the stale-result guards (navToken, sessionId filter) keep it from
  // writing into whatever is opened next.
  const leaveSession = useCallback(() => {
    navToken.current += 1;
    sessionRef.current = null;
    lastSeenUpdate.current = null;
    replayBuf.current = null;
    activeRunRef.current = null;
    setSessionId(null);
    setItems([]);
    setActiveRun(null);
    setBusy(false);
    setLoading(false);
    setTurnStartedAt(null);
    setCancelling(false);
    setExternalActive(false);
    setExternalOverride(false);
    setConfigOptions([]);
    setShowConfig(false);
    setPending([]);
    setAttachError(null);
    pendingResync.current = null;
    sendWhenBack.current = false;
    setLinkDown(false);
    setStatus("connected");
    setStatusKind("ok");
    localStorage.removeItem(SESSION_KEY);
    document.title = "goose";
  }, []);

  const connectedHosts = useCallback(
    () => [...hostsRef.current.values()].sort((a, b) => hostRank(a.endpointId) - hostRank(b.endpointId)),
    [],
  );

  // Every known machine (connected or not) for the filter and the labels.
  const hostChoices = [...hosts]
    .sort((a, b) => hostRank(a.endpointId) - hostRank(b.endpointId))
    .map((h) => ({ endpointId: h.endpointId, label: hostLabel(h.endpointId, h.name) }));
  const activeFilter: HostFilter = hostChoices.some((h) => h.endpointId === hostFilter) ? hostFilter : "all";

  const newSession = useCallback(async (hostId?: string) => {
    const hid = hostId ?? connectedHosts()[0]?.endpointId ?? null;
    const host = hid ? hostsRef.current.get(hid) : null;
    if (!host) return;
    setPickHost(false);
    leaveSession();
    const token = navToken.current;
    setCreating(true);
    try {
      // hostSubdir: the machine starts the chat in its "Vom iPhone gestartet"
      // folder, which the desktop app shows as its own sidebar section.
      // Machines without that patch ignore the hint. client: stored as a user
      // chat, so the desktop app lists it at all.
      const res = await host.agent.newSession({
        cwd: "/",
        mcpServers: [],
        _meta: newSessionMeta(),
      });
      if (navToken.current !== token) return;
      const opts = ((res as { configOptions?: unknown[] }).configOptions ?? []) as ConfigOption[];
      setConfigOptions(opts);
      const m = modelFromConfigOptions(opts);
      if (m) setModelName(m);
      localStorage.setItem(SESSION_KEY, `${host.endpointId}|${res.sessionId}`);
      activeHostRef.current = host.endpointId;
      setActiveHostId(host.endpointId);
      sessionRef.current = res.sessionId;
      setSessionId(res.sessionId);
      setItems([{ kind: "system", id: nextId++, text: `Neuer Chat auf ${hostLabel(host.endpointId, host.name)}` }]);
      void refreshSessions();
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (err) {
      setStatus(`Neuer Chat ging nicht: ${err}`);
      setStatusKind("err");
    } finally {
      setCreating(false);
    }
  }, [refreshSessions, leaveSession, connectedHosts]);

  // One machine connected: start right away. Several: let the user pick.
  const startNew = useCallback(() => {
    if (hostsRef.current.size > 1) setPickHost(true);
    else void newSession();
  }, [newSession]);

  const openSession = useCallback(
    async (hostId: string, id: string, force = false, keepExternalGuard = false) => {
      const host = hostsRef.current.get(hostId);
      if (!host && force) return;
      if (id === sessionRef.current && hostId === activeHostRef.current && !force) return;
      // A user-initiated switch is a navigation; a follow-mode refresh of the
      // same chat is not, so a running turn there keeps its state.
      if (!force) {
        setPickHost(false);
        leaveSession();
        // Show the remembered tail at once; the load below replaces it. A
        // refresh (force) keeps what is on screen until the new copy is in,
        // which is what made the chat blink every few seconds before.
        const cached = loadChat(hostId, id);
        setItems(cached ? fromCache(cached) : []);
        setLogWindow(80);
      }
      const token = navToken.current;
      if (!host) {
        // Machine out of reach right now: keep the remembered chat on screen
        // and load it as soon as the machine is back (see connect()).
        localStorage.setItem(SESSION_KEY, `${hostId}|${id}`);
        activeHostRef.current = hostId;
        setActiveHostId(hostId);
        sessionRef.current = id;
        setSessionId(id);
        pendingResync.current = id;
        setLinkDown(true);
        void checkLinksRef.current();
        return;
      }
      setLoading(true);
      setStatus("loading session…");
      setStatusKind("busy");
      try {
        activeRunRef.current = null;
        setActiveRun(null);
        // A follow-mode refresh must not clear the loop-boundary guard the
        // poll just raised — resetting here re-enabled the composer while a
        // foreign loop was still driving the session.
        if (!keepExternalGuard) {
          setExternalActive(false);
          setExternalOverride(false);
        }
        setConfigOptions([]);
        setShowConfig(false);
        const info = sessions.find((x) => x._host === hostId && x.sessionId === id);
        document.title = info?.title ? `${info.title} · goose remote` : "goose remote";
        lastSeenUpdate.current = null;
        localStorage.setItem(SESSION_KEY, `${hostId}|${id}`);
        activeHostRef.current = hostId;
        setActiveHostId(hostId);
        sessionRef.current = id;
        setSessionId(id);
        replayBuf.current = [];
        // Ask the server to replay only the trailing messages (it rounds up
        // to a turn boundary); replaySkipped in the response meta says how
        // much older history was left out.
        const res = await withTimeout(
          host.agent.loadSession({
            sessionId: id,
            cwd: "/",
            mcpServers: [],
            _meta: { replayTail: REPLAY_TAIL },
          }),
          LOAD_TIMEOUT_MS,
          host.name,
        );
        if (navToken.current !== token) return;
        const buf = replayBuf.current ?? [];
        replayBuf.current = null;
        const skipped = (res?._meta as Record<string, unknown> | undefined)?.replaySkipped;
        if (typeof skipped === "number" && skipped > 0) {
          buf.unshift({
            kind: "system",
            id: nextId++,
            text: `… ${skipped} earlier messages not shown`,
          });
        }
        setItems(buf);
        saveChat(hostId, id, cacheableItems(buf as unknown as Array<{ kind: string } & Record<string, unknown>>));
        streamRole.current = null;
        setStatus("connected");
        setStatusKind("ok");
      } catch (err) {
        if (navToken.current !== token) return;
        if (err instanceof TimeoutError) {
          // The link answers nothing: start over. redialAll drops every host
          // (dropHost frees the screen and marks this chat for reload),
          // connect() reloads it and a message typed meanwhile goes out after.
          void redialAllRef.current();
          return;
        }
        push({ kind: "system", text: `could not load session: ${err}` } as Omit<Item, "id">);
        setStatus("connected");
        setStatusKind("ok");
      } finally {
        if (navToken.current === token) {
          replayBuf.current = null;
          setLoading(false);
          inputRef.current?.focus();
        }
      }
    },
    [push, leaveSession],
  );

  // Follow mode: the ACP server only streams updates to the connection that
  // sent the prompt (no multi-viewer broadcast yet). If someone else drives
  // this session (desktop, another device), poll updatedAt while idle and
  // re-load to catch up. Coarse, but keeps a "joined" session scrolling.
  //
  // The same signal powers the loop-boundary guard: a session advancing while
  // our connection holds no activeRunId means a loop we cannot see is driving
  // it (another process on the host — desktop, CLI, scheduler). We can watch
  // but not steer that loop, and a plain prompt would start a second one, so
  // the composer warns and asks for an explicit "send anyway".
  const lastSeenUpdate = useRef<string | null>(null);
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(async () => {
      if (hostsRef.current.size === 0 || busy || loading) return;
      try {
        await refreshSessions();
        const sid = sessionRef.current;
        const hid = activeHostRef.current;
        if (!sid || !hid) return;
        const host = hostsRef.current.get(hid);
        if (!host) return;
        const res = await withTimeout(host.agent.listSessions({}), PROBE_TIMEOUT_MS, host.name);
        const mine = (res.sessions ?? []).find((x) => x.sessionId === sid);
        const stamp = (mine as { updatedAt?: string } | undefined)?.updatedAt ?? null;
        const advanced =
          stamp !== null && lastSeenUpdate.current !== null && stamp !== lastSeenUpdate.current;
        const foreign = advanced && !activeRunRef.current;
        setExternalActive(foreign);
        if (advanced) {
          await openSession(hid, sid, true, foreign);
        }
        if (stamp) lastSeenUpdate.current = stamp;
      } catch {
        // No answer in time: find out which link is dead and redial it.
        void checkLinksRef.current();
      }
    }, 6000);
    return () => clearInterval(t);
  }, [connected, busy, loading, openSession, refreshSessions]);


  // Dial one host and add it to the live set. The tab holds a connection per
  // saved host — the session list is the merge — so connecting a second host
  // extends the workspace rather than replacing it.
  const reconnectAttempts = useRef<Map<string, number>>(new Map());
  const connectRef = useRef<(cardText?: string) => Promise<void>>(async () => {});
  const dialAllRef = useRef<(hosts: SavedHost[]) => void>(() => {});
  // Bumped when the endpoint is thrown away: dials still running on the old
  // one are stale, their result is discarded.
  const dialGen = useRef(0);
  const redialing = useRef(false);
  const checkLinksRef = useRef<() => Promise<void>>(async () => {});
  const redialAllRef = useRef<() => Promise<void>>(async () => {});

  // Forget a host's connection (dead or dying) without leaving the open chat.
  // A turn waiting on that link will never hear back, so its spinner is
  // cleared here; the reload after redial shows what goose did meanwhile.
  const dropHost = useCallback((eid: string) => {
    const entry = hostsRef.current.get(eid);
    if (!entry) return;
    hostsRef.current.delete(eid);
    try {
      entry.conn.close();
    } catch {
      // already closed
    }
    if (activeHostRef.current === eid && sessionRef.current) {
      pendingResync.current = sessionRef.current;
      navToken.current += 1;
      replayBuf.current = null;
      activeRunRef.current = null;
      setActiveRun(null);
      setBusy(false);
      setLoading(false);
      setTurnStartedAt(null);
      setCancelling(false);
      setLinkDown(true);
    }
    setStatus(`${hostLabel(eid, entry.name)}: Verbindung weg, verbinde neu…`);
    setStatusKind("err");
  }, []);

  const scheduleReconnect = useCallback((text: string, eid: string) => {
    const attempt = reconnectAttempts.current.get(eid) ?? 0;
    reconnectAttempts.current.set(eid, attempt + 1);
    // Hidden: iOS has frozen us anyway; the resume check redials on return.
    if (document.visibilityState === "hidden") return;
    setTimeout(() => {
      if (hostsRef.current.has(eid) || document.visibilityState === "hidden") return;
      void connectRef.current(text);
    }, retryDelay(attempt));
  }, []);

  const connect = useCallback(async (cardText?: string) => {
    const text = (cardText ?? card).trim();
    if (!text) return;
    const hint = cardEndpointHint(text);
    if (hint && (dialing.current.has(hint) || hostsRef.current.has(hint))) return;
    if (hint) dialing.current.add(hint);
    const gen = dialGen.current;
    setDialCount((n) => n + 1);
    if (hostsRef.current.size === 0) {
      setStatus("dialing host over relay…");
      setStatusKind("busy");
    }
    try {
      const conn = await roam.connect(text, "web");
      if (gen !== dialGen.current) {
        conn.close();
        return;
      }
      // Key host state by the AUTHENTICATED endpoint id (QUIC-TLS-proven),
      // not agentId() — that's a host-chosen display label and could collide.
      const eid = conn.peerId();
      const bytes = roamByteStreams(conn);
      const stream = ndJsonStream(bytes.writable, bytes.readable);
      const agent = new GooseClient(() => makeClient(), stream);
      await withTimeout(
        agent.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        }),
        PROBE_TIMEOUT_MS * 2,
        "Anmeldung",
      );
      localStorage.setItem(HOST_CARD_KEY, text);
      const prior = loadHosts().find((h) => h.endpointId === eid);
      const name = hostName.trim() || prior?.name || `host ${eid.slice(0, 8)}`;
      const entry: HostConn = { endpointId: eid, name, agent, conn, relay: relayRegion(text) };
      hostsRef.current.set(eid, entry);
      if (!activeHostRef.current) {
        activeHostRef.current = eid;
        setActiveHostId(eid);
      }
      // Per-host drop watch: other hosts' connections are untouched.
      void agent.closed.then(() => {
        if (hostsRef.current.get(eid)?.agent !== agent) return;
        dropHost(eid);
        scheduleReconnect(text, eid);
      });
      reconnectAttempts.current.delete(eid);
      setRelay(entry.relay);
      {
        const next = loadHosts().filter((h) => h.endpointId !== eid);
        next.unshift({ name, card: text, endpointId: eid });
        localStorage.setItem(HOSTS_KEY, JSON.stringify(next.slice(0, 12)));
        setHosts(next.slice(0, 12));
        setHostName("");
        setAddingHost(false);
        setShowHosts(false);
      }
      setAgentId(eid);
      setConnected(true);
      setReconnecting(false);
      setStatus("connected");
      setStatusKind("ok");
      await refreshSessions();
      void refreshProjects();
      const resync = pendingResync.current;
      if (resync && activeHostRef.current === eid && sessionRef.current === resync) {
        // Back after a drop with that machine's chat still open: reload it so
        // whatever goose did meanwhile shows up, then free the composer.
        pendingResync.current = null;
        setLinkDown(false);
        setAttachError(null);
        await openSession(eid, resync, true);
        inputRef.current?.focus();

      } else if (activeHostRef.current === eid) {
        setLinkDown(false);
      }
    } catch (err) {
      console.error(err);
      if (gen !== dialGen.current) return;
      if (isPairingError(err)) {
        // Not paired: redialing cannot help. Only take over the screen when
        // nothing is connected; otherwise the other machine keeps working.
        if (hostsRef.current.size === 0) {
          setReconnecting(false);
          setStatus(`connect failed: ${err}`);
          setStatusKind("err");
          setAddingHost(true);
          setPairOpen(true);
        }
      } else if (hint) {
        if (hostsRef.current.size === 0 && (reconnectAttempts.current.get(hint) ?? 0) >= 2) {
          // Nothing reachable after a few tries: show the hosts page with the
          // reason, retries keep running behind it.
          setReconnecting(false);
          setStatus(`connect failed: ${err}`);
          setStatusKind("err");
        }
        scheduleReconnect(text, hint);
      } else {
        setReconnecting(false);
        setStatus(`connect failed: ${err}`);
        setStatusKind("err");
      }
    } finally {
      if (hint && gen === dialGen.current) dialing.current.delete(hint);
      setDialCount((n) => n - 1);
    }
  }, [card, hostName, roam, makeClient, refreshSessions, refreshProjects, openSession, dropHost, scheduleReconnect]);
  connectRef.current = connect;

  // First machine alone until it answers (at most 3 s), then the rest in
  // parallel: dials racing on a freshly bound endpoint sometimes hung for two
  // minutes, while a sleeping MacBook must not hold up the Mini either.
  const dialAll = useCallback((list: SavedHost[]) => {
    const sorted = [...list].sort((a, b) => hostRank(a.endpointId) - hostRank(b.endpointId));
    if (sorted.length === 0) return;
    const [first, ...rest] = sorted;
    const firstDone = connectRef.current(first.card);
    void Promise.race([firstDone, new Promise((r) => setTimeout(r, 3000))]).then(() => {
      for (const h of rest) void connectRef.current(h.card);
    });
  }, []);
  dialAllRef.current = dialAll;

  // Start over: drop every connection, bind a fresh endpoint, dial everyone.
  // Needed after the network went away; the old endpoint keeps dead relay
  // sockets and new dials through it complete but carry no data.
  const redialAll = useCallback(async () => {
    if (redialing.current) return;
    redialing.current = true;
    try {
      for (const eid of [...hostsRef.current.keys()]) dropHost(eid);
      dialGen.current += 1;
      dialing.current.clear();
      await roam.reset();
      const saved = loadHosts();
      for (const h of saved) reconnectAttempts.current.set(h.endpointId, 0);
      dialAll(saved);
    } finally {
      redialing.current = false;
    }
  }, [roam, dropHost, dialAll]);

  // Ask every live host a cheap question with a deadline. Any silence means
  // the endpoint is suspect: start over. Saved hosts that are not live are
  // dialed too (their retries pause while the app is in the background).
  const checkLinks = useCallback(async () => {
    const live = [...hostsRef.current.values()];
    const results = await Promise.all(
      live.map((h) =>
        withTimeout(h.agent.listSessions({}), PROBE_TIMEOUT_MS, h.name).then(
          () => true,
          () => hostsRef.current.get(h.endpointId)?.agent !== h.agent,
        ),
      ),
    );
    if (results.some((ok) => !ok)) {
      await redialAll();
      return;
    }
    const missing = loadHosts().filter(
      (h) => !hostsRef.current.has(h.endpointId) && !dialing.current.has(h.endpointId),
    );
    for (const h of missing) reconnectAttempts.current.set(h.endpointId, 0);
    if (missing.length) dialAll(missing);
    void refreshSessions();
  }, [redialAll, dialAll, refreshSessions]);
  redialAllRef.current = redialAll;
  checkLinksRef.current = checkLinks;

  // iOS freezes the app when it leaves the screen; check the links on return
  // and whenever the network comes back.
  useEffect(() => {
    let hiddenAt = document.visibilityState === "hidden" ? Date.now() : 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        saveOpenChat();
      } else if (hiddenAt) {
        const away = Date.now() - hiddenAt;
        hiddenAt = 0;
        // Long away: iOS has surely cut the sockets, skip the 5 s probe.
        if (away >= RESUME_REDIAL_AFTER_MS) void redialAllRef.current();
        else if (away >= RESUME_CHECK_AFTER_MS) void checkLinksRef.current();
      }
    };
    // Network came back (or switched): every path is stale.
    const onOnline = () => void redialAllRef.current();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void checkLinksRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [saveOpenChat]);

  // A send during an active run is a steer: the message is queued into the
  // running loop rather than starting a second one. Two ways to know a run is
  // live: our own connection saw activeRunId (session_info_update), or a plain
  // prompt bounces with "already has active run `<id>`" — e.g. a loop started
  // by another device on this same share process.
  // Change a session config option (provider/model/mode/…) over ACP. The
  // response carries the full refreshed option set — mirror it locally so the
  // sheet and the model badge update immediately.
  const setConfigOption = useCallback(async (configId: string, value: string) => {
    const agent = activeAgent();
    const sid = sessionRef.current;
    if (!agent || !sid) return;
    try {
      const res = await agent.setSessionConfigOption({
        sessionId: sid,
        configId,
        value,
      });
      const opts = (res.configOptions ?? []) as ConfigOption[];
      setConfigOptions(opts);
      const m = modelFromConfigOptions(opts);
      if (m) setModelName(m);
    } catch (err) {
      push({ kind: "system", text: `could not set ${configId}: ${err}` } as Omit<Item, "id">);
    }
  }, [activeAgent, push]);

  const steer = useCallback(async (sid: string, prompt: ContentBlock[], runId: string) => {
    const agent = activeAgent();
    if (!agent) return;
    await agent.extMethod("_goose/unstable/session/steer", {
      sessionId: sid,
      prompt,
      expectedRunId: runId,
    });
  }, [activeAgent]);

  const send = useCallback(async () => {
    const agent = activeAgent();
    const sid = sessionRef.current;
    const el = inputRef.current;
    const text = el?.value.trim() ?? "";
    const files = pending;
    if (!sid || (!text && files.length === 0)) return;
    if (loading) {
      // Chat is still loading: keep the text, it goes out once loaded.
      setAttachError("Chat wird noch geladen. Deine Nachricht geht gleich automatisch raus.");
      sendWhenBack.current = true;
      return;
    }
    if (!agent) {
      // Link to the chat's machine is down: keep the text, push a redial.
      setAttachError("Verbindung wird neu aufgebaut. Deine Nachricht geht automatisch raus, sobald sie steht.");
      sendWhenBack.current = true;
      void checkLinksRef.current();
      return;
    }
    // Loop-boundary guard: a foreign process is driving this session and the
    // user hasn't explicitly overridden — don't start a second loop.
    if (externalActive && !externalOverride) return;
    const runId = activeRunRef.current;
    if (busy && !runId) return;
    const blocks = promptBlocks(text, files);
    const shown = promptPreview(text, files);
    setPending([]);
    setAttachError(null);
    const token = navToken.current;

    if (runId) {
      if (el) el.value = "";
      try {
        await steer(sid, blocks, runId);
        // pickup echoes back as a user_message_chunk; no local append needed
      } catch (err) {
        push({ kind: "system", text: `steer failed: ${err}` } as Omit<Item, "id">);
      }
      inputRef.current?.focus();
      return;
    }

    if (el) el.value = "";
    streamRole.current = null;
    setItems((xs) => [...xs, { kind: "msg", id: nextId++, role: "user", text: shown }]);
    streamRole.current = null;
    setBusy(true);
    setTurnStartedAt(Date.now());
    setCancelling(false);
    setStatus("thinking…");
    setStatusKind("busy");
    try {
      const res = await agent.prompt({ sessionId: sid, prompt: blocks });
      if (navToken.current !== token) return;
      streamRole.current = null;
      if (res.stopReason && res.stopReason !== "end_turn") {
        push({ kind: "system", text: `· ${res.stopReason}` } as Omit<Item, "id">);
      }
      void refreshSessions();
    } catch (err) {
      const bounce = String(err).match(/already has active run `([^`]+)`/);
      if (bounce) {
        // A loop driven elsewhere owns this session — queue into it instead.
        try {
          await steer(sid, blocks, bounce[1]);
          push({ kind: "system", text: "queued into the running turn" } as Omit<Item, "id">);
        } catch (err2) {
          push({ kind: "system", text: `steer failed: ${err2}` } as Omit<Item, "id">);
        }
      } else {
        push({ kind: "system", text: `error: ${err}` } as Omit<Item, "id">);
      }
    } finally {
      if (navToken.current === token) {
      activeRunRef.current = null;
      setActiveRun(null);
      setBusy(false);
      setTurnStartedAt(null);
      setCancelling(false);
      setStatus("connected");
      setStatusKind("ok");
      inputRef.current?.focus();
      }
    }
  }, [busy, loading, pending, push, refreshSessions, steer, activeAgent, externalActive, externalOverride]);

  // Deliver what was typed during the outage once the chat is back and idle.
  // An effect, not a direct call after the reload: it runs after the render
  // that cleared the loading state, so send() sees the fresh state.
  useEffect(() => {
    if (!sendWhenBack.current || linkDown || busy || loading || !sessionId) return;
    if (!activeHostId || !hostsRef.current.has(activeHostId)) return;
    sendWhenBack.current = false;
    void send();
  }, [linkDown, busy, loading, sessionId, activeHostId, send]);

  // Stop the running turn. ACP cancel is a notification: the prompt call
  // itself returns (stopReason: cancelled), which runs send()'s cleanup.
  const cancelTurn = useCallback(async () => {
    const agent = activeAgent();
    const sid = sessionRef.current;
    if (!agent || !sid) return;
    setCancelling(true);
    try {
      await agent.cancel({ sessionId: sid });
    } catch {
      setCancelling(false);
    }
  }, [activeAgent]);

  const statusColor =
    statusKind === "ok"
      ? "text-text-success"
      : statusKind === "err"
        ? "text-text-danger"
        : statusKind === "busy"
          ? "text-text-info"
          : "text-text-secondary";

  return (
    <div className="h-[100dvh] flex flex-col bg-background-primary text-text-primary pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2.5 bg-background-secondary shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          {(connected || reconnecting) && (
            <button
              id="sidebar-toggle"
              className="md:hidden text-text-secondary px-1"
              aria-label="toggle sessions"
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <Goose className="w-5 h-5" />
          <span className="font-bold text-[15px] whitespace-nowrap">goose</span>
          <span id="build-stamp" className="hidden md:inline text-[10px] text-text-tertiary font-mono self-end pb-0.5">{BUILD}</span>
        </div>
        <div className="flex items-center gap-2.5 min-w-0 shrink">
          {connected && modelName && (
            <span
              id="model-badge"
              className="hidden md:inline text-[11px] text-text-secondary bg-background-tertiary rounded-full px-2.5 py-0.5"
            >
              {modelName}
            </span>
          )}
          {connected && (
            <span
              id="agent-badge"
              className="hidden md:inline font-mono text-[11px] text-text-secondary bg-background-tertiary rounded-full px-2.5 py-0.5"
            >
              agent {agentId.slice(0, 12)}…
            </span>
          )}
          <span id="status" className={`flex items-center gap-1.5 text-[11px] whitespace-nowrap ${statusColor}`}>
            <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-current shrink-0" />
            <span className={connected ? "hidden md:inline" : "truncate max-w-[180px] md:max-w-none"}>{status}</span>
          </span>
          {connected && (
            <button
              id="header-new-chat"
              disabled={creating}
              onClick={() => { setSidebarOpen(false); startNew(); }}
              className="shrink-0 inline-flex items-center gap-1 bg-background-inverse text-text-inverse text-xs font-semibold rounded-lg px-2.5 py-1.5 hover:brightness-110 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" /> Neu
            </button>
          )}
          {connected && (
            <button
              id="switch-host"
              className="shrink-0 text-xs text-text-secondary rounded-lg px-2.5 py-1 hover:bg-background-tertiary hover:text-text-primary transition-colors"
              title="connect more hosts — sessions from every connected host share one list"
              onClick={() => setShowHosts((v) => !v)}
            >
              hosts{hostsRef.current.size > 1 ? ` · ${hostsRef.current.size}` : ""}
            </button>
          )}
        </div>
      </div>

      {!connected && reconnecting && sessions.length === 0 ? (
        // Re-dialing a known host (boot restore / dropped connection): a
        // quiet holding screen instead of flashing the hosts page.
        <section id="reconnect-panel" className="flex-1 grid place-items-center p-6">
          <div className="flex flex-col items-center gap-3 text-text-secondary">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <div className="text-sm">connecting…</div>
            <button
              className="text-xs underline underline-offset-2 hover:text-text-primary"
              onClick={() => setReconnecting(false)}
            >
              choose a different host
            </button>
          </div>
        </section>
      ) : (!connected && !reconnecting) || showHosts ? (
        <ConnectPanel
          hosts={hosts}
          addingHost={addingHost}
          connected={connected}
          busy={dialCount > 0}
          card={card}
          hostName={hostName}
          canScan={canScan}
          pairOpen={pairOpen}
          scanning={scanning}
          myCard={myCard}
          myId={myId}
          isHostLive={(eid) => hostsRef.current.has(eid)}
          setShowHosts={setShowHosts}
          setAddingHost={setAddingHost}
          setCard={setCard}
          setHostName={setHostName}
          setPairOpen={setPairOpen}
          connect={connect}
          startScan={startScan}
          stopScan={() => scanStop.current?.()}
          videoRef={videoRef}
        />
      ) : (
        <section id="workspace" className="flex-1 relative md:grid md:grid-cols-[240px_1fr] flex min-h-0">
          <aside
            className={`${sidebarOpen ? "flex" : "hidden"} md:flex absolute md:static inset-y-0 left-0 z-20 w-[240px] shadow-lg md:shadow-none bg-background-secondary py-3 flex-col gap-2.5 min-h-0`}
          >
            <button
              id="new-session"
              disabled={creating}
              onClick={() => { setSidebarOpen(false); startNew(); }}
              className="mx-3 bg-background-inverse text-text-inverse font-semibold rounded-lg px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
            >
              + Neuer Chat
            </button>
            <div className="mx-3">
              <HostFilterBar choices={hostChoices} sessions={sessions} value={activeFilter} onChange={setHostFilter} />
              <div className="mt-1.5">
                <ArchiveFilterBar sessions={filterByHost(sessions, activeFilter)} value={archiveFilter} onChange={setArchiveFilter} />
              </div>
            </div>
            <div id="session-list" className="overflow-y-auto flex flex-col">
              {groupSessions(filterByArchive(filterByHost(sessions, activeFilter), archiveFilter), projects).map(({ key, label, sessions: group }) => (
                <div key={key} className="flex flex-col">
                  {label !== null && (
                    <button
                      className="project-label flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-tertiary px-3 pt-1 pb-0.5 hover:text-text-secondary"
                      onClick={() => toggleGroup(key)}
                      aria-expanded={!collapsed.has(key)}
                    >
                      <ChevronDown
                        size={12}
                        className={`shrink-0 transition-transform duration-150 ${collapsed.has(key) ? "-rotate-90" : ""}`}
                      />
                      <span className="truncate">{label}</span>
                      <span className="font-normal normal-case tracking-normal">({group.length})</span>
                    </button>
                  )}
                  {(label === null || !collapsed.has(key)) && group.map((s) => (
                    <button
                      key={`${s._host}|${s.sessionId}`}
                      className={`session-item text-left w-full px-3 py-2 border-l-2 transition-colors duration-150 ${
                        s.sessionId === sessionId && s._host === activeHostId
                          ? "bg-background-tertiary border-border-info"
                          : "border-transparent hover:bg-background-tertiary"
                      }`}
                      onClick={() => { setSidebarOpen(false); void openSession(s._host, s.sessionId); }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isSessionLive(s) && (
                          <span
                            className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-text-info animate-pulse"
                            title="active in the last 5 minutes"
                          />
                        )}
                        <span className="text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">
                          {s.title || "(untitled session)"}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-tertiary mt-0.5">
                        {relativeTime(s.updatedAt)}
                        {activeFilter === "all" && hostChoices.length > 1 && (
                          <span className="text-text-info"> · {hostLabel(s._host, s._host.slice(0, 6))}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-auto px-3 pt-2 text-[10px] text-text-tertiary font-mono truncate">
              {modelName ? `${modelName} · ` : ""}{relay ? `via relay ${relay} · ` : ""}agent {agentId.slice(0, 8)}
            </div>
          </aside>

          <main id="chat" className="flex flex-col min-h-0 flex-1 min-w-0">
            {sessionId === null ? (
              <StartPage
                hosts={connectedHosts().map((h) => ({ endpointId: h.endpointId, label: hostLabel(h.endpointId, h.name) }))}
                sessions={sessions}
                creating={creating}
                onNew={(hid) => void newSession(hid)}
                onOpen={(s) => { if (s._host) void openSession(s._host, s.sessionId); }}
                filterChoices={hostChoices}
                filter={activeFilter}
                onFilter={setHostFilter}
                archiveFilter={archiveFilter}
                onArchiveFilter={setArchiveFilter}
              />
            ) : (
            <>
            <div className="shrink-0 px-3 md:px-6 pt-2 flex items-center gap-2 min-w-0">
              <button
                id="back-to-matrix"
                onClick={leaveSession}
                className="shrink-0 inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Chats
              </button>
              <span className="text-xs text-text-tertiary truncate">
                {sessions.find((x) => x._host === activeHostId && x.sessionId === sessionId)?.title ?? ""}
                {hostsRef.current.size > 1 && activeHostId && (
                  <span className="text-text-info"> · {hostsRef.current.get(activeHostId)?.name ?? ""}</span>
                )}
              </span>
              {(() => {
                const cur = sessions.find((x) => x._host === activeHostId && x.sessionId === sessionId);
                const hot =
                  cur?.updatedAt &&
                  Date.now() - new Date(cur.updatedAt).getTime() < 5 * 60 * 1000;
                return hot ? (
                  <span
                    id="hot-chip"
                    title="active in the last 5 min — checked every 6s"
                    className="shrink-0 inline-flex items-center gap-1 text-[10px] text-text-info"
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    live
                  </span>
                ) : null;
              })()}
              <span className="flex-1" />
              {configOptions.length > 0 && (
                <button
                  id="session-config-btn"
                  aria-label="session settings"
                  title="session settings — model, mode, provider"
                  className={`shrink-0 p-1 rounded-md transition-colors ${
                    showConfig
                      ? "text-text-primary bg-background-tertiary"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                  onClick={() => setShowConfig((v) => !v)}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {showConfig && (
              <div
                id="session-config"
                className="shrink-0 bg-background-secondary px-3 md:px-6 py-3"
              >
                <div className="max-w-3xl mx-auto w-full grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                  {configOptions
                    .filter((o) => o.type === "select")
                    .map((o) => (
                      <label key={o.id} className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
                          {o.name}
                        </span>
                        <select
                          className="w-full bg-background-primary rounded-lg px-2 py-1.5 text-xs text-text-primary disabled:opacity-50"
                          value={typeof o.currentValue === "string" ? o.currentValue : ""}
                          disabled={busy && !activeRun}
                          onChange={(e) => void setConfigOption(o.id, e.target.value)}
                        >
                          {flatSelectOptions(o).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                </div>
              </div>
            )}
            <div ref={logRef} id="log" className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-5">
              <div className="max-w-3xl mx-auto w-full flex flex-col gap-4 pb-2">
              {items.length > logWindow && (
                <button
                  id="show-earlier"
                  className="self-center text-xs text-text-secondary rounded-lg px-3 py-1.5 bg-background-secondary hover:bg-background-tertiary transition-colors"
                  onClick={() => {
                    const el = logRef.current;
                    const prevH = el?.scrollHeight ?? 0;
                    setLogWindow((w) => w + 200);
                    requestAnimationFrame(() => {
                      if (el) el.scrollTop += el.scrollHeight - prevH;
                    });
                  }}
                >
                  show earlier · {items.length - logWindow} more
                </button>
              )}
              {items.slice(-logWindow).map((it) => {
                switch (it.kind) {
                  case "system":
                    return (
                      <div key={it.id} className="msg system self-center text-text-secondary text-xs">
                        {it.text}
                      </div>
                    );
                  case "msg":
                    if (it.role === "thought")
                      return (
                        <details
                          key={it.id}
                          className="msg thought bg-background-secondary rounded-lg px-3 py-1.5 text-[13px] text-text-secondary"
                        >
                          <summary className="cursor-pointer italic text-text-tertiary">
                            thinking
                          </summary>
                          <div className="body mt-1.5 whitespace-pre-wrap">{it.text}</div>
                        </details>
                      );
                    // Mirror the desktop's presentation (UserMessage /
                    // GooseMessage): user prompts are right-aligned inverse
                    // bubbles; goose replies are plain left-aligned content.
                    if (it.role === "user")
                      return (
                        <div key={it.id} className="msg user flex justify-end w-full">
                          <div className="body user-message-bubble max-w-[92%] md:max-w-[85%] w-fit min-w-0 bg-text-primary text-background-primary rounded-xl py-2.5 px-4 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                            {it.text}
                          </div>
                        </div>
                      );
                    return (
                      <div key={it.id} className="msg agent goose-message flex w-full md:w-[90%] justify-start min-w-0">
                        <div className="body min-w-0 flex-1 leading-relaxed">
                          <MarkdownContent content={it.text} />
                        </div>
                      </div>
                    );
                  case "tool":
                    return <ToolRow key={it.id} item={it} />;
                  case "plan":
                    return (
                      <div
                        key={it.id}
                        className="plan mt-1 rounded-lg bg-background-secondary px-3.5 py-2.5"
                      >
                        <div className="text-xs text-text-secondary uppercase tracking-wider mb-1.5">
                          Plan
                        </div>
                        {it.entries.map((e, i) => (
                          <div key={i} className="flex gap-2 py-0.5 text-[13px]">
                            <span className="text-text-secondary">
                              {e.status === "completed" ? "☑" : e.status === "in_progress" ? "▸" : "☐"}
                            </span>
                            <span
                              className={
                                e.status === "completed"
                                  ? "text-text-tertiary line-through"
                                  : "text-text-primary"
                              }
                            >
                              {e.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  case "perm":
                    return (
                      <div
                        key={it.id}
                        className="perm mt-1 rounded-lg bg-background-warning px-3.5 py-2.5"
                      >
                        <div className="text-[13px] text-text-warning mb-2">
                          🔐 {it.title} needs permission
                        </div>
                        {it.chosen ? (
                          <span className="text-xs text-text-secondary">→ {it.chosen}</span>
                        ) : (
                          <div className="perm-actions flex gap-2 flex-wrap">
                            {it.options.map((o) => (
                              <button
                                key={o.optionId}
                                className={
                                  o.kind.startsWith("allow")
                                    ? "primary bg-background-inverse text-text-inverse font-semibold rounded-lg px-3 py-1 text-[13px]"
                                    : "bg-background-secondary text-text-secondary rounded-lg px-3 py-1 text-[13px] hover:bg-background-tertiary"
                                }
                                onClick={() => {
                                  it.resolve(o.optionId);
                                  setItems((xs) =>
                                    xs.map((x) =>
                                      x.id === it.id && x.kind === "perm"
                                        ? { ...x, chosen: o.name }
                                        : x,
                                    ),
                                  );
                                }}
                              >
                                {o.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                }
              })}
              {loading && items.length > 0 && (
                <div id="chat-refreshing" className="msg system self-center flex items-center gap-2 text-text-tertiary text-[11px]">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  aktualisiere…
                </div>
              )}
              {busy && (
                <div className="msg system self-center flex items-center gap-2.5 text-text-secondary text-xs">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  <span>{activeRun ? "goose is working — you can steer" : "goose is working…"}</span>
                  {turnStartedAt && <LiveElapsed startedAt={turnStartedAt} />}
                  {turnStartedAt && (
                    <button
                      id="stop-turn"
                      type="button"
                      disabled={cancelling}
                      onClick={() => void cancelTurn()}
                      className="inline-flex items-center gap-1 bg-background-secondary rounded-md px-2 py-0.5 text-[11px] hover:text-text-warning transition-colors disabled:opacity-50"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      {cancelling ? "stopping…" : "stop"}
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>
            <form
              id="prompt-form"
              className="px-3 md:px-6 pb-3 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {linkDown && (
                <div
                  id="link-down"
                  className="max-w-3xl mx-auto w-full mb-1.5 flex items-center gap-2 text-[11px] text-text-warning rounded-lg bg-background-secondary px-3 py-1.5"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" />
                  <span className="flex-1 min-w-0">
                    Verbindung zu {activeHostId ? hostLabel(activeHostId, "") : "dem Rechner"} wird wiederhergestellt… Goose arbeitet dort weiter.
                  </span>
                </div>
              )}
              {externalActive && !externalOverride && (
                <div
                  id="external-run-guard"
                  className="max-w-3xl mx-auto w-full mb-1.5 flex items-center gap-2 text-[11px] text-text-warning rounded-lg bg-background-secondary px-3 py-1.5"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" />
                  <span className="flex-1 min-w-0">
                    active in another goose (desktop or CLI) — sending from here may start a second loop
                  </span>
                  <button
                    id="external-run-override"
                    type="button"
                    className="shrink-0 text-[11px] underline underline-offset-2 hover:text-text-primary"
                    onClick={() => setExternalOverride(true)}
                  >
                    send anyway
                  </button>
                </div>
              )}
              {(pending.length > 0 || attachError) && (
                <div id="attachments" className="max-w-3xl mx-auto w-full mb-1.5 flex flex-wrap gap-1.5">
                  {pending.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="attachment-chip inline-flex items-center gap-1 text-[11px] bg-background-secondary rounded-full pl-2.5 pr-1 py-0.5 max-w-[220px]"
                    >
                      <span className="truncate">📎 {f.name}</span>
                      <button
                        type="button"
                        aria-label={`${f.name} entfernen`}
                        className="p-0.5 text-text-secondary hover:text-text-primary"
                        onClick={() => setPending((xs) => xs.filter((_, j) => j !== i))}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {attachError && <span className="text-[11px] text-text-danger">{attachError}</span>}
                </div>
              )}
              <input
                ref={fileRef}
                id="file-input"
                type="file"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const list = [...(e.target.files ?? [])];
                  e.target.value = "";
                  setAttachError(null);
                  for (const f of list) {
                    try {
                      const a = await readAttachment(f);
                      setPending((xs) => [...xs, a]);
                    } catch (err) {
                      setAttachError(String(err instanceof Error ? err.message : err));
                    }
                  }
                }}
              />
              <div className="max-w-3xl mx-auto w-full flex gap-1.5 items-end rounded-xl bg-background-secondary focus-within:ring-2 focus-within:ring-border-info px-1.5 py-1 transition-shadow">
              <button
                id="attach-btn"
                type="button"
                aria-label="Datei oder Foto anhaengen"
                disabled={(busy && !activeRun) || (externalActive && !externalOverride)}
                onClick={() => fileRef.current?.click()}
                className="shrink-0 p-2 mb-0.5 text-text-secondary hover:text-text-primary disabled:opacity-40"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <textarea
                ref={inputRef}
                id="prompt-input"
                rows={1}
                disabled={(busy && !activeRun) || (externalActive && !externalOverride)}
                className="flex-1 outline-none border-none focus:ring-0 bg-transparent px-3 pt-2.5 pb-2 text-sm resize-none max-h-52 text-text-primary placeholder:text-text-secondary"
                placeholder={
                  externalActive && !externalOverride
                    ? "Running in another goose — watching…"
                    : activeRun
                      ? "Steer the running turn…"
                      : "Nachricht an goose…"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                id="send-btn"
                type="submit"
                disabled={(busy && !activeRun) || (externalActive && !externalOverride)}
                className="bg-background-inverse text-text-inverse text-sm font-medium rounded-lg px-3.5 py-1.5 mb-0.5 mr-0.5 hover:brightness-110 disabled:opacity-50"
              >
                {activeRun ? "nachschieben" : "senden"}
              </button>
              </div>
            </form>
            </>
            )}
          </main>
        </section>
      )}
      {pickHost && connected && (
        <div
          id="host-picker"
          className="fixed inset-0 z-40 bg-black/40 flex items-end md:items-center justify-center"
          onClick={() => setPickHost(false)}
        >
          <div
            className="w-full md:w-[360px] bg-background-primary rounded-t-2xl md:rounded-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col gap-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold">Neuer Chat auf welchem Rechner?</div>
            {connectedHosts().map((h) => (
              <button
                key={h.endpointId}
                disabled={creating}
                onClick={() => void newSession(h.endpointId)}
                className="pick-host w-full bg-background-inverse text-text-inverse font-semibold rounded-xl px-4 py-3 hover:brightness-110 disabled:opacity-50"
              >
                {hostLabel(h.endpointId, h.name)}
              </button>
            ))}
            <button className="text-xs text-text-secondary py-1" onClick={() => setPickHost(false)}>
              abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

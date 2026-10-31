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
import type { ToolCallStatus } from "@desktop/components/ToolCallStatusIndicator";
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
  IPHONE_HOST,
  TABLET_HOST,
  isDirekt,
  isTablet,
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
import { ConnectPanel } from "./ConnectPanel";
import { AppHeader, ChatTopBar, HostPicker, Sidebar, type ConfigSelect } from "./ui/Shell";
import { UntereLeiste } from "./ui/UntereLeiste";
import { useDirekt } from "./direkt/useDirekt";
import { DirektChatAnsicht } from "./direkt/DirektChatAnsicht";
import { DirektEinstellungen } from "./direkt/DirektEinstellungen";
import { IPHONE_LABEL, direktAlsSitzungen } from "./direkt/liste";
import { neuerChat as neuerDirektChat } from "./direkt/speicher";
import { aufIphoneKlonen } from "./direkt/klonen";
import { STANDARD_MODELL } from "./direkt/anbieter";
import { useTablet } from "./direkt/useTablet";
import { TabletChatAnsicht } from "./direkt/TabletChatAnsicht";
import { TABLET_LABEL, tabletAlsSitzungen, tabletHinweis } from "./direkt/tablet";
import { Smartphone } from "lucide-react";
import { AgentMessage, PermCard, PlanCard, RefreshingHint, SystemLine, ThoughtBlock, ToolRow, UserBubble, WorkingIndicator } from "./ui/ChatItems";
import { Composer } from "./ui/Composer";
import { Skeleton, isLive } from "./ui/Primitives";

import type { Item } from "./items";

const ACP_TOOL_STATUS: Record<string, ToolCallStatus> = {
  pending: "pending",
  in_progress: "loading",
  completed: "success",
  failed: "error",
};

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

export function App({ roam, tresor = null }: { roam: RoamClient; tresor?: CryptoKey | null }) {
  // Direkt-Chat auf dem iPhone (29.10.2026): Chats, Schluessel, Modelle.
  const direkt = useDirekt(tresor);
  const [direktOffen, setDirektOffen] = useState<string | null>(null);
  // Tablet-Chats (Moose beta) als Kopie aus der Wissensdatenbank, nur lesen.
  const tablet = useTablet(direkt.schluessel.kb);
  const [tabletOffen, setTabletOffen] = useState<{ id: number; titel: string } | null>(null);
  const [einstellungen, setEinstellungen] = useState(false);
  const [klonFehler, setKlonFehler] = useState<string | null>(null);
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
  const tabletNeuLaden = tablet.neuLaden;
  const setHostFilter = useCallback((f: HostFilter) => {
    setHostFilterState(f);
    saveHostFilter(f);
    if (f === TABLET_HOST) void tabletNeuLaden();
  }, [tabletNeuLaden]);
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
      setStatus(`Kamera nicht verfuegbar: ${err}`);
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
    setDirektOffen(null);
    setTabletOffen(null);
    setKlonFehler(null);
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
  // Lists show the iPhone's own chats like one more machine.
  const listChoices = [{ endpointId: IPHONE_HOST, label: IPHONE_LABEL }, { endpointId: TABLET_HOST, label: TABLET_LABEL }, ...hostChoices];
  const allSessions = [...direktAlsSitzungen(direkt.chats), ...tabletAlsSitzungen(tablet.eintraege), ...sessions];
  const activeFilter: HostFilter = listChoices.some((h) => h.endpointId === hostFilter) ? hostFilter : "all";

  const newSession = useCallback(async (hostId?: string) => {
    const hid = hostId ?? connectedHosts()[0]?.endpointId ?? null;
    const host = hid ? hostsRef.current.get(hid) : null;
    if (!host) return;
    setPickHost(false);
    setEinstellungen(false);
    setShowHosts(false);
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

  // "Neu" always asks: here on the iPhone (direct), or on a connected machine.
  const startNew = useCallback(() => {
    setPickHost(true);
  }, []);

  const openDirekt = useCallback((id: string) => {
    setPickHost(false);
    setEinstellungen(false);
    setShowHosts(false);
    leaveSession();
    setDirektOffen(id);
  }, [leaveSession]);

  const newDirekt = useCallback(async () => {
    try {
      const c = await neuerDirektChat(STANDARD_MODELL);
      await direkt.neuLaden();
      openDirekt(c.id);
      requestAnimationFrame(() => document.getElementById("direkt-input")?.focus());
    } catch (err) {
      setStatus(`Neuer Chat auf dem iPhone ging nicht: ${err}`);
      setStatusKind("err");
    }
  }, [direkt, openDirekt]);

  const openTablet = useCallback((s: TaggedSession) => {
    setPickHost(false);
    setEinstellungen(false);
    setShowHosts(false);
    leaveSession();
    setTabletOffen({ id: Number(s.sessionId), titel: s.title ?? "" });
  }, [leaveSession]);

  const openAny = useCallback((s: TaggedSession) => {
    if (isDirekt(s)) openDirekt(s.sessionId);
    else if (isTablet(s)) openTablet(s);
    else if (s._host) void openSessionRef.current(s._host, s.sessionId);
  }, [openDirekt, openTablet]);

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
            text: `… ${skipped} fruehere Nachrichten nicht gezeigt`,
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
        push({ kind: "system", text: `Konnte den Chat nicht laden: ${err}` } as Omit<Item, "id">);
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

  const openSessionRef = useRef(openSession);
  openSessionRef.current = openSession;

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
          setStatus(`Verbinden ging nicht: ${err}`);
          setStatusKind("err");
          setAddingHost(true);
          setPairOpen(true);
        }
      } else if (hint) {
        if (hostsRef.current.size === 0 && (reconnectAttempts.current.get(hint) ?? 0) >= 2) {
          // Nothing reachable after a few tries: show the hosts page with the
          // reason, retries keep running behind it.
          setReconnecting(false);
          setStatus(`Verbinden ging nicht: ${err}`);
          setStatusKind("err");
        }
        scheduleReconnect(text, hint);
      } else {
        setReconnecting(false);
        setStatus(`Verbinden ging nicht: ${err}`);
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
      push({ kind: "system", text: `Konnte ${configId} nicht setzen: ${err}` } as Omit<Item, "id">);
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
        push({ kind: "system", text: `Nachschieben ging nicht: ${err}` } as Omit<Item, "id">);
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
          push({ kind: "system", text: "an den laufenden Auftrag angehaengt" } as Omit<Item, "id">);
        } catch (err2) {
          push({ kind: "system", text: `Nachschieben ging nicht: ${err2}` } as Omit<Item, "id">);
        }
      } else {
        push({ kind: "system", text: `Fehler: ${err}` } as Omit<Item, "id">);
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

  // Machine off: carry the chat on here, from what the phone remembers of it.
  const cloneToPhone = useCallback(async () => {
    const hid = activeHostRef.current;
    const sid = sessionRef.current;
    if (!hid || !sid) return;
    setKlonFehler(null);
    try {
      const onScreen = cacheableItems(items as unknown as Array<{ kind: string } & Record<string, unknown>>);
      const source = onScreen.some((i) => i.kind === "msg") ? onScreen : (loadChat(hid, sid) ?? []);
      const info = sessions.find((x) => x._host === hid && x.sessionId === sid);
      const c = await aufIphoneKlonen(info?.title || "Ohne Titel", source, {
        hostLabel: hostLabel(hid, hosts.find((h) => h.endpointId === hid)?.name ?? "Rechner"),
        sessionId: sid,
      });
      await direkt.neuLaden();
      openDirekt(c.id);
    } catch (err) {
      setKlonFehler(err instanceof Error ? err.message : String(err));
    }
  }, [items, sessions, hosts, direkt, openDirekt]);

  const multiHost = hostChoices.length > 1;
  const currentInfo = sessions.find((x) => x._host === activeHostId && x.sessionId === sessionId);
  const composerLocked = (busy && !activeRun) || (externalActive && !externalOverride);
  const selectConfig: ConfigSelect[] = configOptions
    .filter((o) => o.type === "select")
    .map((o) => ({
      id: o.id,
      name: o.name,
      value: typeof o.currentValue === "string" ? o.currentValue : "",
      options: flatSelectOptions(o).map((v) => ({ id: v.id, name: v.name })),
    }));
  const sidebarFooter = [modelName, relay ? `ueber Relais ${relay}` : null, agentId ? `Rechner ${agentId.slice(0, 8)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-[100dvh] flex-col bg-canvas text-ink">
      <AppHeader
        connected={connected}
        connecting={reconnecting || dialCount > 0}
        status={status}
        statusKind={statusKind}
        creating={creating}
        hostCount={hostsRef.current.size}
        modelName={modelName}
        agentId={agentId}
        build={BUILD}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onNew={() => { setSidebarOpen(false); startNew(); }}
        onHosts={() => { setSidebarOpen(false); setEinstellungen(false); setShowHosts((v) => !v); }}
        direkt
      />

      {einstellungen ? (
        <DirektEinstellungen
          tresorDa={direkt.tresorDa}
          hinterlegt={direkt.hinterlegt}
          fehlerhaft={direkt.fehlerhaft}
          ausstehend={direkt.chats.filter((c) => c.spiegel === "ausstehend").length}
          wiederhergestellt={direkt.wiederhergestellt}
          onSpeichern={direkt.speichern}
          onEntfernen={direkt.entfernen}
          onNachholen={() => void direkt.nachholen()}
          onLaden={direkt.laden}
        />
      ) : showHosts || (!connected && !reconnecting && addingHost) ? (
        // Machines page. Without any machine the app no longer waits here:
        // the chat list (with the iPhone's own chats) is the main view.
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
        <section id="workspace" className="relative flex min-h-0 flex-1 md:grid md:grid-cols-[280px_1fr]">
          <Sidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            creating={creating}
            onNew={() => { setSidebarOpen(false); startNew(); }}
            hostChoices={listChoices}
            sessions={allSessions}
            hostFilter={activeFilter}
            onHostFilter={setHostFilter}
            archiveFilter={archiveFilter}
            onArchiveFilter={setArchiveFilter}
            groups={groupSessions(filterByArchive(filterByHost(allSessions, activeFilter), archiveFilter), projects)}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            activeSessionId={direktOffen ?? (tabletOffen ? String(tabletOffen.id) : sessionId)}
            activeHostId={direktOffen ? IPHONE_HOST : tabletOffen ? TABLET_HOST : activeHostId}
            onOpen={(s) => { setSidebarOpen(false); openAny(s); }}
            footer={sidebarFooter}
          />

          <main id="chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {tabletOffen ? (
              <TabletChatAnsicht
                key={tabletOffen.id}
                eintrag={tabletOffen}
                kbSchluessel={direkt.schluessel.kb}
                klonVon={(ref) => direkt.chats.find((c) => c.herkunft?.geraet === "tablet" && c.herkunft.sessionId === ref)?.id ?? null}
                onBack={() => setTabletOffen(null)}
                onGeklont={(id) => {
                  void direkt.neuLaden().then(() => openDirekt(id));
                }}
                onEinstellungen={() => { setTabletOffen(null); setEinstellungen(true); }}
              />
            ) : direktOffen ? (
              <DirektChatAnsicht
                key={direktOffen}
                chatId={direktOffen}
                schluessel={direkt.schluessel}
                modelle={direkt.modelle}
                onBack={() => setDirektOffen(null)}
                onEinstellungen={() => { setDirektOffen(null); setEinstellungen(true); }}
                onGeaendert={() => void direkt.neuLaden()}
              />
            ) : sessionId === null ? (
              <StartPage
                hosts={connectedHosts().map((h) => ({ endpointId: h.endpointId, label: hostLabel(h.endpointId, h.name) }))}
                sessions={allSessions}
                creating={creating}
                onNew={(hid) => void newSession(hid)}
                onOpen={openAny}
                filterChoices={listChoices}
                filter={activeFilter}
                onFilter={setHostFilter}
                archiveFilter={archiveFilter}
                onArchiveFilter={setArchiveFilter}
                onNewDirekt={() => void newDirekt()}
                direktHinweis={
                  direkt.schluessel.mistral || direkt.schluessel.eurouter
                    ? null
                    : direkt.fehlerhaft.length
                      ? "Der Mistral-Schluessel laesst sich nicht oeffnen. Unter Einstellungen neu eintragen."
                      : "Einmal den Mistral-Schluessel unter Einstellungen eintragen, dann geht es ohne Rechner."
                }
                search
                tabletHinweis={tabletHinweis({
                  kbDa: !!direkt.schluessel.kb,
                  hinterlegt: direkt.hinterlegt.includes("kb"),
                  fehlerhaft: direkt.fehlerhaft.includes("kb"),
                  tresorDa: direkt.tresorDa,
                  fehler: tablet.fehler,
                  stand: tablet.stand,
                })}
              />
            ) : (
            <>
            <ChatTopBar
              title={currentInfo?.title || (loading ? "" : "(ohne Titel)")}
              hostName={multiHost && activeHostId ? hostLabel(activeHostId, hostsRef.current.get(activeHostId)?.name ?? activeHostId.slice(0, 6)) : null}
              live={isLive(currentInfo?.updatedAt)}
              config={selectConfig}
              configDisabled={busy && !activeRun}
              open={showConfig}
              onToggleConfig={() => setShowConfig((v) => !v)}
              onBack={leaveSession}
              onConfig={(id, value) => void setConfigOption(id, value)}
            />
            <div ref={logRef} id="log" className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-2">
              {items.length > logWindow && (
                <button
                  id="show-earlier"
                  type="button"
                  className="min-h-11 self-center rounded-full bg-elevated px-4 text-[14px] text-ink-muted"
                  onClick={() => {
                    const el = logRef.current;
                    const prevH = el?.scrollHeight ?? 0;
                    setLogWindow((w) => w + 200);
                    requestAnimationFrame(() => {
                      if (el) el.scrollTop += el.scrollHeight - prevH;
                    });
                  }}
                >
                  Fruehere zeigen · {items.length - logWindow} weitere
                </button>
              )}
              {loading && items.length === 0 && (
                <div aria-hidden className="flex flex-col gap-4">
                  <Skeleton className="ml-auto h-12 w-2/3 rounded-[20px]" />
                  <Skeleton className="h-4 w-11/12 rounded-md" />
                  <Skeleton className="h-4 w-4/5 rounded-md" />
                  <Skeleton className="h-4 w-3/5 rounded-md" />
                </div>
              )}
              {items.slice(-logWindow).map((it) => {
                switch (it.kind) {
                  case "system":
                    return <SystemLine key={it.id} text={it.text} />;
                  case "msg":
                    if (it.role === "thought") return <ThoughtBlock key={it.id} text={it.text} />;
                    if (it.role === "user") return <UserBubble key={it.id} text={it.text} />;
                    return <AgentMessage key={it.id} text={it.text} />;
                  case "tool":
                    return <ToolRow key={it.id} title={it.title} status={it.status} output={it.output} />;
                  case "plan":
                    return <PlanCard key={it.id} entries={it.entries} />;
                  case "perm":
                    return (
                      <PermCard
                        key={it.id}
                        title={it.title}
                        options={it.options}
                        chosen={it.chosen}
                        onChoose={(o) => {
                          it.resolve(o.optionId);
                          setItems((xs) =>
                            xs.map((x) => (x.id === it.id && x.kind === "perm" ? { ...x, chosen: o.name } : x)),
                          );
                        }}
                      />
                    );
                }
              })}
              {loading && items.length > 0 && <RefreshingHint />}
              {linkDown && !loading && (
                <div id="klon-leiste" className="fade-in flex flex-col items-center gap-2 rounded-2xl bg-elevated px-4 py-3 text-center">
                  <div className="text-[14px] text-ink-muted">
                    {activeHostId ? hostLabel(activeHostId, "Der Rechner") : "Der Rechner"} ist gerade nicht erreichbar.
                  </div>
                  <button
                    id="clone-to-iphone"
                    type="button"
                    onClick={() => void cloneToPhone()}
                    className="flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-semibold text-accent-ink active:opacity-80"
                  >
                    <Smartphone size={18} aria-hidden /> Auf dem iPhone weiterfuehren
                  </button>
                  {klonFehler && (
                    <div role="alert" className="text-[13px] text-danger">
                      {klonFehler}
                    </div>
                  )}
                </div>
              )}
              {busy && (
                <WorkingIndicator
                  steerable={!!activeRun}
                  startedAt={turnStartedAt}
                  cancelling={cancelling}
                  onStop={() => void cancelTurn()}
                />
              )}
              </div>
            </div>
            <Composer
              inputRef={inputRef}
              fileRef={fileRef}
              linkDownHost={linkDown ? (activeHostId ? hostLabel(activeHostId, "") : "") : null}
              externalGuard={externalActive && !externalOverride}
              onSendAnyway={() => setExternalOverride(true)}
              pending={pending}
              onRemove={(i) => setPending((xs) => xs.filter((_, j) => j !== i))}
              attachError={attachError}
              onFiles={async (list) => {
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
              locked={composerLocked}
              steering={!!activeRun}
              onSubmit={() => void send()}
            />
            </>
            )}
          </main>
        </section>
      )}
      {pickHost && (
        <HostPicker
          hosts={connectedHosts().map((h) => ({ endpointId: h.endpointId, label: hostLabel(h.endpointId, h.name) }))}
          offline={hostChoices.filter((h) => !hostsRef.current.has(h.endpointId))}
          creating={creating}
          onPick={(hid) => void newSession(hid)}
          onDirekt={() => void newDirekt()}
          onCancel={() => setPickHost(false)}
        />
      )}
      {!direktOffen && !tabletOffen && sessionId === null && (
        <UntereLeiste
          aktiv={einstellungen ? "einstellungen" : showHosts || (!connected && !reconnecting && addingHost) ? "rechner" : "chats"}
          hinweis={{ einstellungen: !direkt.schluessel.mistral && !direkt.schluessel.eurouter }}
          onWahl={(b) => {
            setSidebarOpen(false);
            setEinstellungen(b === "einstellungen");
            setShowHosts(b === "rechner");
            if (b !== "rechner") setAddingHost(false);
          }}
        />
      )}
    </div>
  );
}

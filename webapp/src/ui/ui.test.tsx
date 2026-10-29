import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppHeader, HostPicker, Sidebar, connectionView } from "./Shell";
import { Composer } from "./Composer";
import { PermCard, ToolRow, WorkingIndicator } from "./ChatItems";
import { ago } from "./Primitives";
import { ConnectPanel } from "../ConnectPanel";
import type { SessionGroup, TaggedSession } from "../sessions";

const NOW = new Date("2026-10-28T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const sess = (id: string, host: string, title: string | null, m = 1): TaggedSession =>
  ({ sessionId: id, cwd: "/", _host: host, title, updatedAt: minsAgo(m) }) as TaggedSession;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("connectionView", () => {
  it("verbunden: nur gruener Punkt, kein Wort", () => {
    expect(connectionView(true, false, "ok", "connected")).toMatchObject({ tone: "live", text: null, label: "verbunden" });
    // a running turn (busy) is not a connection problem
    expect(connectionView(true, false, "busy", "thinking…").tone).toBe("live");
  });
  it("verbindet: bernstein und pulsierend", () => {
    expect(connectionView(false, true, "idle", "")).toMatchObject({ tone: "warn", text: "verbinde…", pulse: true });
    expect(connectionView(false, false, "busy", "dialing").tone).toBe("warn");
  });
  it("Fehler ohne Verbindung: 'Verbindung weg', mit Verbindung: der Grund", () => {
    expect(connectionView(false, true, "err", "Verbinden ging nicht: x")).toMatchObject({ tone: "danger", text: "Verbindung weg" });
    expect(connectionView(true, false, "err", "Neuer Chat ging nicht: y").text).toBe("Neuer Chat ging nicht: y");
  });
  it("nichts los: grau", () => {
    expect(connectionView(false, false, "idle", "not connected")).toMatchObject({ tone: "faint", text: "nicht verbunden" });
  });
});

describe("ago", () => {
  it("ein Tag in der Einzahl, mehrere in der Mehrzahl", () => {
    expect(ago(minsAgo(1440))).toBe("vor 1 Tag");
    expect(ago(minsAgo(2 * 1440))).toBe("vor 2 Tagen");
    expect(ago(null)).toBe("");
  });
});

describe("AppHeader", () => {
  const base = {
    connecting: false,
    status: "connected",
    statusKind: "ok" as const,
    creating: false,
    hostCount: 2,
    modelName: "Modell A",
    agentId: "abcdef1234567890",
    build: "test",
    onToggleSidebar: () => {},
    onHosts: () => {},
  };
  it("verbunden: Knopf Neu und Rechner-Anzahl, Status vorlesbar", () => {
    const onNew = vi.fn();
    const onHosts = vi.fn();
    render(<AppHeader {...base} connected onNew={onNew} onHosts={onHosts} />);
    expect(document.getElementById("status")!.textContent).toBe("verbunden");
    fireEvent.click(document.getElementById("header-new-chat")!);
    fireEvent.click(screen.getByLabelText("Rechner verwalten, 2 verbunden"));
    expect(onNew).toHaveBeenCalledOnce();
    expect(onHosts).toHaveBeenCalledOnce();
  });
  it("Neu ist nur waehrend des Anlegens gesperrt", () => {
    render(<AppHeader {...base} connected creating onNew={() => {}} />);
    expect((document.getElementById("header-new-chat") as HTMLButtonElement).disabled).toBe(true);
  });
  it("ohne Verbindung kein Neu, kein Rechner-Knopf, keine Seitenleiste", () => {
    render(<AppHeader {...base} connected={false} statusKind="idle" onNew={() => {}} />);
    expect(document.getElementById("header-new-chat")).toBeNull();
    expect(document.getElementById("switch-host")).toBeNull();
    expect(document.getElementById("sidebar-toggle")).toBeNull();
    expect(document.getElementById("status")!.textContent).toContain("nicht verbunden");
  });
});

describe("Composer", () => {
  function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
    const onSubmit = vi.fn();
    const onRemove = vi.fn();
    const onSendAnyway = vi.fn();
    const onFiles = vi.fn();
    render(
      <Composer
        inputRef={createRef<HTMLTextAreaElement>()}
        fileRef={createRef<HTMLInputElement>()}
        linkDownHost={null}
        externalGuard={false}
        onSendAnyway={onSendAnyway}
        pending={[]}
        onRemove={onRemove}
        attachError={null}
        onFiles={onFiles}
        locked={false}
        steering={false}
        onSubmit={onSubmit}
        {...props}
      />,
    );
    return { onSubmit, onRemove, onSendAnyway, onFiles };
  }
  const input = () => document.getElementById("prompt-input") as HTMLTextAreaElement;

  it("Enter sendet, Shift+Enter macht eine neue Zeile", () => {
    const { onSubmit } = setup();
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
    fireEvent.click(document.getElementById("send-btn")!);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("Platzhalter und Knopfname folgen dem Zustand", () => {
    setup();
    expect(input().placeholder).toBe("Nachricht an Goose…");
    expect(document.getElementById("send-btn")!.getAttribute("aria-label")).toBe("senden");
    cleanup();
    setup({ steering: true });
    expect(input().placeholder).toBe("Laufenden Auftrag ergaenzen…");
    expect(document.getElementById("send-btn")!.textContent).toBe("nachschieben");
    cleanup();
    setup({ externalGuard: true, locked: true });
    expect(input().placeholder).toBe("Laeuft in einem anderen Goose, nur zuschauen…");
  });

  it("gesperrt: Feld, Bueroklammer und Senden aus", () => {
    setup({ locked: true });
    for (const id of ["prompt-input", "attach-btn", "send-btn"]) {
      expect((document.getElementById(id) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("fremder Lauf: Warnung mit 'trotzdem senden'", () => {
    const { onSendAnyway } = setup({ externalGuard: true });
    expect(document.getElementById("external-run-guard")!.textContent).toContain("anderen Goose aktiv");
    fireEvent.click(document.getElementById("external-run-override")!);
    expect(onSendAnyway).toHaveBeenCalledOnce();
  });

  it("Verbindung weg: Hinweis nennt den Rechner", () => {
    setup({ linkDownHost: "Mac Mini" });
    expect(document.getElementById("link-down")!.textContent).toContain("Verbindung zu Mac Mini wird wiederhergestellt");
  });

  it("Anhaenge einzeln entfernbar; Wartehinweis ist Information, Fehler ist Alarm", () => {
    const att = { name: "foto.jpg", mimeType: "image/jpeg", data: "", size: 1, isImage: true } as unknown as Parameters<typeof Composer>[0]["pending"][number];
    const { onRemove } = setup({ pending: [att, { ...att, name: "b.pdf" }], attachError: "Chat wird noch geladen. Deine Nachricht geht gleich automatisch raus." });
    fireEvent.click(screen.getByLabelText("b.pdf entfernen"));
    expect(onRemove).toHaveBeenCalledWith(1);
    expect(screen.getByText(/automatisch raus/).getAttribute("role")).toBe("status");
    cleanup();
    setup({ attachError: "Datei zu gross (max. 25 MB)" });
    expect(screen.getByText(/zu gross/).getAttribute("role")).toBe("alert");
  });

  it("gewaehlte Dateien gehen an App, das Feld wird geleert", () => {
    const { onFiles } = setup();
    const fileInput = document.getElementById("file-input") as HTMLInputElement;
    const f = new File(["x"], "a.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [f] } });
    expect(onFiles).toHaveBeenCalledWith([f]);
  });
});

describe("Chat-Eintraege", () => {
  it("Freigabe: erste Erlaubnis hervorgehoben, Wahl wird gemeldet, danach nur das Ergebnis", () => {
    const onChoose = vi.fn();
    const options = [
      { optionId: "o1", name: "Einmal erlauben", kind: "allow_once" },
      { optionId: "o2", name: "Immer erlauben", kind: "allow_always" },
      { optionId: "o3", name: "Ablehnen", kind: "reject_once" },
    ];
    const { rerender } = render(<PermCard title="Shell: rm -rf build" options={options} chosen={null} onChoose={onChoose} />);
    const buttons = [...document.querySelectorAll(".perm-actions button")] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(["Einmal erlauben", "Immer erlauben", "Ablehnen"]);
    expect(buttons[0].className).toContain("bg-warn");
    expect(buttons[1].className).not.toContain("bg-warn");
    expect(buttons[1].classList.contains("primary")).toBe(true);
    expect(buttons[2].classList.contains("primary")).toBe(false);
    fireEvent.click(buttons[2]);
    expect(onChoose).toHaveBeenCalledWith(options[2]);
    rerender(<PermCard title="Shell: rm -rf build" options={options} chosen="Ablehnen" onChoose={onChoose} />);
    expect(document.querySelector(".perm-actions")).toBeNull();
    expect(document.querySelector(".perm")!.textContent).toBe("→ Ablehnen");
  });

  it("Werkzeug: Ausgabe erst nach Tippen, leer heisst 'noch keine Ausgabe'", () => {
    render(<ToolRow title="Shell: ls" status="loading" output="" />);
    expect(document.querySelector(".tool pre")).toBeNull();
    fireEvent.click(document.querySelector(".tool button")!);
    expect(document.querySelector(".tool pre")!.textContent).toBe("noch keine Ausgabe");
    expect(document.querySelector(".tool button")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("Arbeitet-Anzeige: Stopp waehrend des Stoppens gesperrt", () => {
    const onStop = vi.fn();
    const { rerender } = render(<WorkingIndicator steerable startedAt={NOW.getTime() - 64_000} cancelling={false} onStop={onStop} />);
    expect(screen.getByText("Goose arbeitet, du kannst nachschieben")).toBeTruthy();
    expect(document.getElementById("turn-elapsed")!.textContent).toBe("1m 04s");
    fireEvent.click(document.getElementById("stop-turn")!);
    expect(onStop).toHaveBeenCalledOnce();
    rerender(<WorkingIndicator steerable={false} startedAt={NOW.getTime()} cancelling onStop={onStop} />);
    const stop = document.getElementById("stop-turn") as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    expect(stop.textContent).toBe("stoppe…");
    expect(screen.getByText("Goose arbeitet…")).toBeTruthy();
  });
});

describe("Sidebar", () => {
  const MINI = { endpointId: "mini-id", label: "Mac Mini" };
  const BOOK = { endpointId: "book-id", label: "MacBook" };
  function setup(groups: SessionGroup[], props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
    const onOpen = vi.fn();
    const onToggleGroup = vi.fn();
    render(
      <Sidebar
        open
        onClose={() => {}}
        creating={false}
        onNew={() => {}}
        hostChoices={[MINI, BOOK]}
        sessions={groups.flatMap((g) => g.sessions)}
        hostFilter="all"
        onHostFilter={() => {}}
        archiveFilter="active"
        onArchiveFilter={() => {}}
        groups={groups}
        collapsed={new Set()}
        onToggleGroup={onToggleGroup}
        activeSessionId="b"
        activeHostId="book-id"
        onOpen={onOpen}
        footer="Modell A"
        {...props}
      />,
    );
    return { onOpen, onToggleGroup };
  }

  it("Gruppen mit Anzahl, offener Chat markiert, Tippen oeffnet ihn", () => {
    const a = sess("a", "mini-id", "Eins");
    const b = sess("b", "book-id", null, 3);
    const { onOpen, onToggleGroup } = setup([
      { key: "~", label: "chats", sessions: [a] },
      { key: "~phone", label: "Vom iPhone gestartet", sessions: [b] },
    ]);
    const labels = [...document.querySelectorAll(".project-label")].map((el) => el.textContent);
    expect(labels).toEqual(["Chats(1)", "Vom iPhone gestartet(1)"]);
    const items = [...document.querySelectorAll(".session-item")];
    expect(items[1].getAttribute("aria-current")).toBe("page");
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(items[1].textContent).toContain("(ohne Titel)");
    expect(items[0].textContent).toContain("Mac Mini");
    fireEvent.click(items[0]);
    expect(onOpen).toHaveBeenCalledWith(a);
    fireEvent.click(document.querySelectorAll(".project-label")[1]);
    expect(onToggleGroup).toHaveBeenCalledWith("~phone");
  });

  it("zugeklappte Gruppe zeigt keine Chats; gefiltert kein Rechner-Abzeichen", () => {
    setup([{ key: "~", label: "chats", sessions: [sess("a", "mini-id", "Eins")] }], { collapsed: new Set(["~"]), hostFilter: "mini-id" });
    expect(document.querySelectorAll(".session-item")).toHaveLength(0);
    expect(document.querySelector(".project-label")!.getAttribute("aria-expanded")).toBe("false");
    cleanup();
    setup([{ key: "~", label: "chats", sessions: [sess("a", "mini-id", "Eins")] }], { hostFilter: "mini-id" });
    expect(document.querySelector(".session-item .host-badge")).toBeNull();
  });

  it("leer: 'noch keine'; geschlossen unsichtbar", () => {
    setup([], { open: false });
    expect(screen.getByText("noch keine")).toBeTruthy();
    expect(document.querySelector("aside")!.className).toContain("invisible");
  });
});

describe("HostPicker", () => {
  it("Rechner waehlen; Tippen daneben bricht ab, Tippen ins Blatt nicht", () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(<HostPicker hosts={[{ endpointId: "m", label: "Mac Mini" }, { endpointId: "b", label: "MacBook" }]} creating={false} onPick={onPick} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("MacBook"));
    expect(onPick).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(document.getElementById("host-picker")!);
    fireEvent.click(screen.getByText("abbrechen"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("ConnectPanel", () => {
  const MINI_ID = "19736644c81a262765fa4dc07f6d265769d45bcd105ba7fee65ec6b5bb9cb893";
  function setup(props: Partial<Parameters<typeof ConnectPanel>[0]> = {}) {
    const fns = { connect: vi.fn(async () => {}), setAddingHost: vi.fn(), setShowHosts: vi.fn(), setCard: vi.fn() };
    render(
      <ConnectPanel
        hosts={[{ name: "host 1973", card: "goose+roam://mini", endpointId: MINI_ID }, { name: "Laptop", card: "goose+roam://lap", endpointId: "ffff" }]}
        addingHost={false}
        connected
        busy={false}
        card=""
        hostName=""
        canScan={false}
        pairOpen={false}
        scanning={false}
        myCard="goose+roam://ich"
        myId="ich-id"
        isHostLive={(eid) => eid === MINI_ID}
        setShowHosts={fns.setShowHosts}
        setAddingHost={fns.setAddingHost}
        setCard={fns.setCard}
        setHostName={() => {}}
        setPairOpen={() => {}}
        connect={fns.connect}
        startScan={async () => {}}
        stopScan={() => {}}
        videoRef={createRef<HTMLVideoElement>()}
        {...props}
      />,
    );
    return fns;
  }

  it("Rechnerliste: eingebaute Namen, verbunden gesperrt, anderer verbindet", () => {
    const fns = setup();
    const rows = [...document.querySelectorAll(".host-row")] as HTMLButtonElement[];
    expect(rows[0].textContent).toContain("Mac Mini");
    expect(rows[0].textContent).toContain("verbunden");
    expect(rows[0].disabled).toBe(true);
    fireEvent.click(rows[1]);
    expect(fns.setCard).toHaveBeenCalledWith("goose+roam://lap");
    expect(fns.connect).toHaveBeenCalledWith("goose+roam://lap");
    fireEvent.click(document.getElementById("add-host")!);
    expect(fns.setAddingHost).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText("Zurueck zu den Chats"));
    expect(fns.setShowHosts).toHaveBeenCalledWith(false);
  });

  it("Hinzufuegen: eigene Karte und Schluessel liegen bereit, auch zugeklappt", () => {
    const fns = setup({ hosts: [], connected: false, addingHost: true });
    expect(document.getElementById("my-card")!.textContent).toBe("goose+roam://ich");
    expect(document.getElementById("my-endpoint-id")!.textContent).toBe("ich-id");
    expect(screen.queryByLabelText("Zurueck zu den Rechnern")).toBeNull();
    fireEvent.click(document.getElementById("connect-btn")!);
    expect(fns.connect).toHaveBeenCalledOnce();
  });

  it("waehrend des Verbindens: Knopf gesperrt mit 'Einen Moment…'", () => {
    setup({ hosts: [], connected: false, busy: true });
    const btn = document.getElementById("connect-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Einen Moment…");
  });
});

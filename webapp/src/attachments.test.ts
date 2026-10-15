import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_FILE_BYTES,
  type Attachment,
  attachmentBlocks,
  promptBlocks,
  promptPreview,
  readAttachment,
} from "./attachments";

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => btoa(s);

// A File whose reported size can be faked without allocating megabytes.
function fakeFile(name: string, type: string, content = "hallo", size?: number): File {
  const f = new File([enc(content)], name, { type });
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
}

// Stubs the browser image pipeline (createImageBitmap + canvas) that jsdom lacks.
function stubImagePipeline(width: number, height: number, jpegBytes = "JPEGDATA") {
  const drawn: number[][] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (_b: unknown, ...xywh: number[]) => drawn.push(xywh) }),
    toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => {
      expect(type).toBe("image/jpeg");
      expect(quality).toBe(0.85);
      cb(new Blob([enc(jpegBytes)], { type }));
    },
  };
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag)) as typeof document.createElement);
  return { canvas, drawn, close };
}

afterEach(() => vi.unstubAllGlobals());

describe("readAttachment", () => {
  it("normale Datei: Name, Typ, Groesse und base64-Inhalt", async () => {
    const a = await readAttachment(fakeFile("notiz.txt", "text/plain", "hallo welt"));
    expect(a).toEqual({ name: "notiz.txt", mime: "text/plain", data: b64("hallo welt"), size: 10, kind: "file" });
  });

  it("errät den Typ aus der Endung, wenn das Handy keinen mitliefert", async () => {
    expect((await readAttachment(fakeFile("Vertrag.PDF", ""))).mime).toBe("application/pdf");
    expect((await readAttachment(fakeFile("tabelle.xlsx", ""))).mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect((await readAttachment(fakeFile("sprachmemo.m4a", ""))).mime).toBe("audio/mp4");
    expect((await readAttachment(fakeFile("ohne-endung", ""))).mime).toBe("application/octet-stream");
  });

  it("lehnt Dateien ueber 25 MB mit verstaendlicher Meldung ab", async () => {
    const big = fakeFile("film.mov", "video/quicktime", "x", MAX_FILE_BYTES + 1);
    await expect(readAttachment(big)).rejects.toThrow("film.mov ist zu gross (25 MB, hoechstens 25 MB)");
  });

  it("genau 25 MB sind noch erlaubt", async () => {
    const edge = fakeFile("gross.bin", "application/octet-stream", "x", MAX_FILE_BYTES);
    await expect(readAttachment(edge)).resolves.toMatchObject({ kind: "file" });
  });

  it("kleines JPEG geht unveraendert als Bild", async () => {
    const created = vi.fn();
    vi.stubGlobal("createImageBitmap", created);
    const a = await readAttachment(fakeFile("foto.jpg", "image/jpeg", "JPG"));
    expect(a).toEqual({ name: "foto.jpg", mime: "image/jpeg", data: b64("JPG"), size: 3, kind: "image" });
    expect(created).not.toHaveBeenCalled();
  });

  it("HEIC wird zu JPEG umgerechnet und behaelt den Namen", async () => {
    const { canvas, close } = stubImagePipeline(1000, 800);
    const a = await readAttachment(fakeFile("IMG_0001.HEIC", "image/heic", "HEICDATA"));
    expect(a).toEqual({ name: "IMG_0001.jpg", mime: "image/jpeg", data: b64("JPEGDATA"), size: 8, kind: "image" });
    // small enough: no downscaling
    expect([canvas.width, canvas.height]).toEqual([1000, 800]);
    expect(close).toHaveBeenCalled();
  });

  it("grosses Foto wird auf 2400 Pixel laengste Kante verkleinert", async () => {
    const { canvas, drawn } = stubImagePipeline(3000, 4000);
    const a = await readAttachment(fakeFile("hoch.png", "image/png", "PNG", 2 * 1024 * 1024));
    expect(a.kind).toBe("image");
    expect(a.name).toBe("hoch.jpg");
    expect([canvas.width, canvas.height]).toEqual([1800, 2400]);
    expect(drawn[0]).toEqual([0, 0, 1800, 2400]);
  });

  it("Bild knapp unter 1,5 MB bleibt PNG", async () => {
    const created = vi.fn();
    vi.stubGlobal("createImageBitmap", created);
    const a = await readAttachment(fakeFile("screenshot.png", "image/png", "PNG", 1.5 * 1024 * 1024));
    expect(a).toMatchObject({ name: "screenshot.png", mime: "image/png", kind: "image" });
    expect(created).not.toHaveBeenCalled();
  });

  it("kann der Browser das Bild nicht lesen, geht das Original als Datei", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("decode failed"); }));
    const a = await readAttachment(fakeFile("IMG_2.heic", "", "HEICDATA"));
    expect(a).toEqual({ name: "IMG_2.heic", mime: "image/heic", data: b64("HEICDATA"), size: 8, kind: "file" });
  });

  it("Datei nur aus Endung (.heic) bekommt den Ersatznamen bild.jpg", async () => {
    stubImagePipeline(10, 10);
    const a = await readAttachment(fakeFile(".heic", "image/heic"));
    expect(a.name).toBe("bild.jpg");
  });

  it("base64 stimmt auch fuer Binaerdaten ueber der Stueckgrenze", async () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 256);
    const f = new File([bytes], "daten.bin", { type: "application/octet-stream" });
    const a = await readAttachment(f);
    const back = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
  });
});

const img: Attachment = { name: "Foto 1.jpg", mime: "image/jpeg", data: "QUJD", size: 3, kind: "image" };
const pdf: Attachment = { name: "Rechnung März.pdf", mime: "application/pdf", data: "UERG", size: 3, kind: "file" };

describe("attachmentBlocks", () => {
  it("Bild als image-Block, Datei als resource-Block, Name in der uri", () => {
    expect(attachmentBlocks([img, pdf])).toEqual([
      { type: "image", data: "QUJD", mimeType: "image/jpeg", uri: "file:///Foto%201.jpg" },
      {
        type: "resource",
        resource: { uri: "file:///Rechnung%20M%C3%A4rz.pdf", mimeType: "application/pdf", blob: "UERG" },
      },
    ]);
  });

  it("Schraegstriche im Namen koennen keinen Pfad bauen", () => {
    const [block] = attachmentBlocks([{ ...pdf, name: "../../etc/passwd" }]);
    expect(block).toMatchObject({ resource: { uri: "file:///..%2F..%2Fetc%2Fpasswd" } });
  });
});

describe("promptBlocks (was an Goose geht)", () => {
  it("nur Text", () => {
    expect(promptBlocks("hallo", [])).toEqual([{ type: "text", text: "hallo" }]);
  });

  it("Text plus Anhaenge: Text zuerst", () => {
    const blocks = promptBlocks("schau mal", [img, pdf]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "resource"]);
    expect(blocks[0]).toEqual({ type: "text", text: "schau mal" });
  });

  it("nur Anhaenge: kein leerer Textblock", () => {
    expect(promptBlocks("", [pdf]).map((b) => b.type)).toEqual(["resource"]);
  });

  it("gar nichts: ein leerer Textblock, nie eine leere Liste", () => {
    expect(promptBlocks("", [])).toEqual([{ type: "text", text: "" }]);
  });
});

describe("promptPreview (was im Chat angezeigt wird)", () => {
  it("Text und je Anhang eine Zeile mit Bueroklammer", () => {
    expect(promptPreview("schau mal", [img, pdf])).toBe("schau mal\n\u{1F4CE} Foto 1.jpg\n\u{1F4CE} Rechnung März.pdf");
  });

  it("ohne Text nur die Anhaenge", () => {
    expect(promptPreview("", [pdf])).toBe("\u{1F4CE} Rechnung März.pdf");
  });
});

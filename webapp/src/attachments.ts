// Files picked on the phone, turned into ACP prompt content.
//
// Images go as `image` blocks (the model sees them), everything else as an
// embedded `resource` blob. The host build (vibe-suite goose-fernzugang,
// patch anhaenge-speichern) saves both as real files and drops a copy into
// ~/in-die-datenbank/goose/, from where they land in the knowledge base.
// The file name rides the uri, so the saved file keeps its name.
import type { ContentBlock } from "@agentclientprotocol/sdk";

export type Attachment = {
  name: string;
  mime: string;
  /** base64 without the data: prefix */
  data: string;
  size: number;
  kind: "image" | "file";
};

// One JSON-RPC line carries the whole file; keep it to what a phone upload
// over the relay handles comfortably.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Photos straight off an iPhone are 3-8 MB HEIC. Re-encode large or HEIC
// images to JPEG at a size the model reads well; small JPEG/PNG pass as is.
const IMAGE_MAX_EDGE = 2400;
const IMAGE_REENCODE_ABOVE = 1.5 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function guessMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    heic: "image/heic",
    heif: "image/heif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

async function reencodeImage(file: File): Promise<Attachment | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return null;
    const base = file.name.replace(/\.[^.]+$/, "") || "bild";
    return {
      name: `${base}.jpg`,
      mime: "image/jpeg",
      data: toBase64(await blob.arrayBuffer()),
      size: blob.size,
      kind: "image",
    };
  } catch {
    return null;
  }
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} ist zu gross (${Math.round(file.size / 1048576)} MB, hoechstens 25 MB)`);
  }
  const mime = guessMime(file);
  if (mime.startsWith("image/")) {
    const heic = /hei[cf]/i.test(mime);
    if (heic || file.size > IMAGE_REENCODE_ABOVE) {
      const img = await reencodeImage(file);
      if (img) return img;
      // Browser could not decode it: send the original as a plain file.
      return { name: file.name, mime, data: toBase64(await file.arrayBuffer()), size: file.size, kind: "file" };
    }
    return { name: file.name, mime, data: toBase64(await file.arrayBuffer()), size: file.size, kind: "image" };
  }
  return { name: file.name, mime, data: toBase64(await file.arrayBuffer()), size: file.size, kind: "file" };
}

export function attachmentBlocks(files: Attachment[]): ContentBlock[] {
  return files.map((f): ContentBlock => {
    const uri = `file:///${encodeURIComponent(f.name)}`;
    if (f.kind === "image") return { type: "image", data: f.data, mimeType: f.mime, uri };
    return { type: "resource", resource: { uri, mimeType: f.mime, blob: f.data } };
  });
}

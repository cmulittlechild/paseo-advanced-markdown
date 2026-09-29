import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  FILE_PREVIEW_MAX_BYTES,
  FILE_PREVIEW_MAX_LINES,
  type FilePreviewInput,
  type FilePreviewOutput,
} from "../../shared/file-preview.js";
import { parseFileLink } from "../../shared/markdown/links.js";

const MAX_FILE_BYTES = 1024 * 1024;
const CONTEXT_BEFORE = 5;

// The handler only needs the authoritative agent directory, not the full API.
export interface FilePreviewContext {
  paseo: {
    agents: {
      ref(agentId: string): {
        readonly cwd: string | null;
        refresh(): Promise<unknown>;
      };
    };
  };
}

class PreviewFailure extends Error {}

export async function readFilePreview(
  input: FilePreviewInput,
  context: FilePreviewContext,
): Promise<FilePreviewOutput> {
  try {
    const target = parseFileLink(input.href);
    if (!target) return { ok: false, message: "This link is not a local file." };

    const agent = context.paseo.agents.ref(input.agentId);
    await agent.refresh();
    const cwd = agent.cwd;
    if (!cwd || !path.isAbsolute(cwd)) {
      return { ok: false, message: "This agent's working directory is unavailable." };
    }
    const filePath = resolveFilePath(target.path, cwd);
    const text = await readTextFile(filePath);
    const lines = text.split(/\r\n|\n|\r/);
    const anchor = (target.lineStart ?? 1) - 1;
    if (anchor >= lines.length) {
      return { ok: false, message: `This file has only ${lines.length} lines.` };
    }

    return {
      ok: true,
      path: filePath,
      ...selectWindow(lines, anchor),
      totalLines: lines.length,
      lineStart: target.lineStart,
      lineEnd: target.lineEnd,
    };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

function resolveFilePath(filePath: string, cwd: string): string {
  if (process.platform !== "win32" && /^[a-z]:[\\/]/i.test(filePath)) {
    throw new PreviewFailure("Windows file paths cannot be opened on this host.");
  }
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.resolve(homedir(), filePath.slice(2));
  }
  return path.resolve(cwd, filePath);
}

async function readTextFile(filePath: string): Promise<string> {
  // Nonblocking open prevents a FIFO link from hanging the plugin before fstat.
  const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new PreviewFailure("Only regular text files can be previewed.");
    if (stat.size > MAX_FILE_BYTES) throw new PreviewFailure("File previews are limited to 1 MiB.");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE_BYTES) throw new PreviewFailure("File previews are limited to 1 MiB.");
    const bytes = buffer.subarray(0, length);
    if (bytes.includes(0)) throw new PreviewFailure("This file is not UTF-8 text.");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new PreviewFailure("This file is not UTF-8 text.");
    }
  } finally {
    await file.close();
  }
}

function selectWindow(lines: string[], anchor: number) {
  const anchorLine = truncateUtf8(lines[anchor]!, FILE_PREVIEW_MAX_BYTES);
  const selected = [anchorLine];
  let bytes = Buffer.byteLength(anchorLine, "utf8");
  let start = anchor;
  let end = anchor + 1;
  for (let i = anchor - 1; i >= Math.max(0, anchor - CONTEXT_BEFORE); i--) {
    const length = Buffer.byteLength(lines[i]!, "utf8") + 1;
    if (bytes + length > FILE_PREVIEW_MAX_BYTES) break;
    selected.unshift(lines[i]!);
    bytes += length;
    start = i;
  }
  while (end < lines.length && selected.length < FILE_PREVIEW_MAX_LINES) {
    const length = Buffer.byteLength(lines[end]!, "utf8") + 1;
    if (bytes + length > FILE_PREVIEW_MAX_BYTES) break;
    selected.push(lines[end]!);
    bytes += length;
    end++;
  }
  return {
    content: selected.join("\n"),
    startLine: start + 1,
    truncated: start > 0 || end < lines.length || anchorLine !== lines[anchor],
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  // A streaming decoder omits an incomplete final codepoint at the byte limit.
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.from(value).subarray(0, maxBytes),
    { stream: true },
  );
}

function failureMessage(error: unknown): string {
  if (error instanceof PreviewFailure) return error.message;
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return "This file could not be found.";
    if (error.code === "EACCES" || error.code === "EPERM") return "This file could not be read.";
  }
  return "Unable to read this file on the host.";
}

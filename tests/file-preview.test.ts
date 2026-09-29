import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FILE_PREVIEW_MAX_BYTES,
  FILE_PREVIEW_MAX_LINES,
  filePreviewOutput,
} from "../shared/file-preview.js";
import { readFilePreview, type FilePreviewContext } from "../server/files/preview.js";

let root: string;
const agentId = "source-agent";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pam-file-preview-"));
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "src", "example.ts"),
    "const 中文 = 1;\r\nconsole.log(中文);\r\n",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function context(directory = root): FilePreviewContext {
  return {
    paseo: {
      agents: {
        ref(id) {
          expect(id).toBe(agentId);
          let cwd: string | null = null;
          return {
            get cwd() {
              return cwd;
            },
            async refresh() {
              cwd = directory;
            },
          };
        },
      },
    },
  };
}

async function preview(href: string) {
  const result = await readFilePreview({ agentId, href }, context());
  expect(filePreviewOutput.safeParse(result).success).toBe(true);
  return result;
}

describe("local file previews", () => {
  it("uses the refreshed agent directory for relative file links and preserves line targets", async () => {
    expect(await preview("src/example.ts:2:4")).toEqual({
      ok: true,
      path: path.join(root, "src", "example.ts"),
      content: "const 中文 = 1;\nconsole.log(中文);\n",
      startLine: 1,
      totalLines: 3,
      lineStart: 2,
      lineEnd: 2,
      truncated: false,
    });
  });

  it("opens absolute paths and file URLs with line ranges", async () => {
    const filePath = path.join(root, "src", "example.ts");
    expect(await preview(`${filePath}#L1-L2`)).toMatchObject({
      ok: true,
      path: filePath,
      lineEnd: 2,
    });
    expect(await preview(`${pathToFileURL(filePath).href}#L2`)).toMatchObject({
      ok: true,
      path: filePath,
      lineStart: 2,
    });
  });

  it("keeps the requested line visible in a bounded window of a longer file", async () => {
    await writeFile(
      path.join(root, "many.txt"),
      Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
    const result = await preview("many.txt#L350-L355");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startLine).toBe(345);
    expect(result.totalLines).toBe(500);
    expect(result.content.split("\n").length).toBeLessThanOrEqual(FILE_PREVIEW_MAX_LINES);
    expect(result.content.split("\n")[350 - result.startLine]).toBe("line 350");
    expect(result.truncated).toBe(true);
  });

  it("bounds multibyte output without losing the selected line after a large context line", async () => {
    await writeFile(
      path.join(root, "wide.txt"),
      `${"中".repeat(20_000)}\nselected line\nlast line`,
    );
    const selected = await preview("wide.txt:2");
    expect(selected).toMatchObject({
      ok: true,
      startLine: 2,
      content: "selected line\nlast line",
      truncated: true,
    });
    const wide = await preview("wide.txt:1");
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    expect(Buffer.byteLength(wide.content, "utf8")).toBeLessThanOrEqual(FILE_PREVIEW_MAX_BYTES);
    expect(wide.content).not.toContain("�");
    expect(wide.truncated).toBe(true);
  });

  it("reports missing files, directories, and lines outside a file", async () => {
    expect(await preview("missing.ts")).toMatchObject({
      ok: false,
      message: "This file could not be found.",
    });
    expect(await preview("./src")).toMatchObject({
      ok: false,
      message: "Only regular text files can be previewed.",
    });
    expect(await preview("src/example.ts:999")).toEqual({
      ok: false,
      message: "This file has only 3 lines.",
    });
  });

  it("rejects binary, invalid UTF-8, and over-limit files", async () => {
    await writeFile(path.join(root, "binary.txt"), Buffer.from([65, 0, 66]));
    await writeFile(path.join(root, "encoding.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(path.join(root, "large.txt"), Buffer.alloc(1024 * 1024 + 1, 65));
    expect(await preview("binary.txt")).toEqual({
      ok: false,
      message: "This file is not UTF-8 text.",
    });
    expect(await preview("encoding.txt")).toEqual({
      ok: false,
      message: "This file is not UTF-8 text.",
    });
    expect(await preview("large.txt")).toEqual({
      ok: false,
      message: "File previews are limited to 1 MiB.",
    });
  });

  it("rejects external and script schemes before accessing the agent", async () => {
    const inaccessible: FilePreviewContext = {
      paseo: {
        agents: {
          ref() {
            throw new Error("Agent lookup must not happen");
          },
        },
      },
    };
    for (const href of [
      "https://example.com/code.ts",
      "javascript:alert(1)",
      "file://example.com/code.ts",
    ]) {
      expect(await readFilePreview({ agentId, href }, inaccessible)).toEqual({
        ok: false,
        message: "This link is not a local file.",
      });
    }
  });
});

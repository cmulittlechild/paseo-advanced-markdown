import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { isSupportedLink, parseFileLink } from "../shared/markdown/links.js";

describe("local Markdown link destinations", () => {
  it.each([
    ["src/main.ts", "src/main.ts", null, null],
    ["../README.md", "../README.md", null, null],
    ["~/notes.md:12", "~/notes.md", 12, 12],
    ["/Users/example/My%20Project/main.py:120:4", "/Users/example/My Project/main.py", 120, 120],
    ["src/main.ts:10:2-20:4", "src/main.ts", 10, 20],
    ["src/main.ts#L10C2-L20C4", "src/main.ts", 10, 20],
    ["file:///tmp/main.ts#L2", "/tmp/main.ts", 2, 2],
    ["FILE://localhost/tmp/main.ts:2", "/tmp/main.ts", 2, 2],
    ["C:/project/main.ts:42", "C:/project/main.ts", 42, 42],
    [String.raw`C:\project\main.ts#L42`, "C:/project/main.ts", 42, 42],
    ["file:///C:/project/main.ts#L42", "C:/project/main.ts", 42, 42],
    ["/tmp/%E4%B8%AD%E6%96%87%23notes.md", "/tmp/中文#notes.md", null, null],
  ])("parses %s without losing its path or line range", (href, path, lineStart, lineEnd) => {
    expect(parseFileLink(String(href))).toEqual({ path, lineStart, lineEnd });
  });

  it.each([
    "",
    "#section",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "vscode://file/tmp/a",
    "https://example.org/file.ts:12",
    "mailto:a@example.org",
    "//remote/file.ts",
    "file://remote/tmp/a",
    "file:relative.ts",
    "file:////remote/a",
    "file:///tmp/a?query",
    "src/main.ts#L0",
    "src/main.ts:0",
    "src/main.ts#L20-L10",
    "src/main.ts:20-10",
    "src/main.ts:9007199254740992",
    "src/main.ts#section",
    "/tmp/%00file",
    "/tmp/%0Afile",
    "/tmp/%ZZ",
    "%2F%2Fremote/file",
    "javascript%3Aalert(1)",
  ])("does not treat %s as a readable local destination", (href) => {
    expect(parseFileLink(href)).toBeNull();
  });

  it("uses the same link policy in the renderer, including file URLs and reference links", () => {
    const parser = new MarkdownIt();
    parser.validateLink = isSupportedLink;
    const source = "[source](file:///tmp/my%20file.ts:10) [ref]\n\n[ref]: src/main.ts#L2";
    const tokens = parser.parse(source, {}).flatMap((token) => token.children ?? []);
    expect(
      tokens.filter((token) => token.type === "link_open").map((token) => token.attrGet("href")),
    ).toEqual(["file:///tmp/my%20file.ts:10", "src/main.ts#L2"]);
    expect(parser.render("[bad](javascript:alert(1))")).not.toContain("<a ");
  });
});

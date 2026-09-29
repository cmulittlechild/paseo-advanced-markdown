export interface FileLink {
  path: string;
  lineStart: number | null;
  lineEnd: number | null;
}

export function isExternalLink(href: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(href);
}

/** Parse destinations only. File access happens on the host after a user's press. */
export function parseFileLink(href: string): FileLink | null {
  let path = href.trim();
  if (!path || path.length > 8192 || isExternalLink(path) || path.includes("?")) return null;
  if (/^file:/i.test(path)) {
    const file = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(path);
    if (!file) return null;
    path = file[1];
    if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
  }

  let lineStart: number | null = null;
  let lineEnd: number | null = null;
  const hash = path.indexOf("#");
  if (hash !== -1) {
    const lines = /^#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i.exec(path.slice(hash));
    if (!lines) return null;
    lineStart = Number(lines[1]);
    lineEnd = Number(lines[2] ?? lines[1]);
    path = path.slice(0, hash);
  } else {
    const lines = /^(.+?):(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?$/.exec(path);
    if (lines) {
      path = lines[1];
      lineStart = Number(lines[2]);
      lineEnd = Number(lines[3] ?? lines[2]);
    }
  }
  if (
    lineStart !== null &&
    (!Number.isSafeInteger(lineStart) ||
      lineStart < 1 ||
      !Number.isSafeInteger(lineEnd) ||
      lineEnd! < lineStart)
  )
    return null;

  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  path = path.replace(/\\/g, "/");
  // Refuse network paths and URI schemes; a Windows drive is a local path.
  const localPath = /^[a-z]:\//i.test(path) ? path.slice(2) : path;
  if (!localPath || localPath.includes(":") || path.startsWith("//")) return null;
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  return { path, lineStart, lineEnd };
}

export function isSupportedLink(href: string): boolean {
  return isExternalLink(href) || parseFileLink(href) !== null;
}

const mediaPath = "/_emdash/api/media/file/";

export function requiresAccess(request: Request): boolean {
  const rawPath = new URL(request.url).pathname;
  let path: string;
  try {
    path = decodeURIComponent(rawPath)
      .replaceAll("\\", "/")
      .replace(/\/{2,}/g, "/")
      .toLowerCase();
  } catch {
    return true;
  }

  if (path !== "/_emdash" && !path.startsWith("/_emdash/")) return false;

  const isRead = request.method === "GET" || request.method === "HEAD";
  const key = rawPath.startsWith(mediaPath)
    ? rawPath.slice(mediaPath.length)
    : "";
  return !(
    isRead &&
    key.length > 0 &&
    key
      .split("/")
      .every(
        (part) => /^[a-z0-9_.-]+$/i.test(part) && part !== "." && part !== "..",
      )
  );
}

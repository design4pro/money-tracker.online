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

  return path === "/_emdash" || path.startsWith("/_emdash/");
}

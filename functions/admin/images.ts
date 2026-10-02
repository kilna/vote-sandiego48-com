export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"] as const;

const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function safeFilename(name: string) {
  const base = name.split(/[/\\]/).pop() || "";
  return FILENAME.test(base) ? base : null;
}

export function imageKey(eventId: string, filename: string) {
  return `${eventId}/${filename}`;
}

export function keyBelongs(eventId: string, key: string) {
  const prefix = `${eventId}/`;
  if (!key.startsWith(prefix)) return false;
  return FILENAME.test(key.slice(prefix.length));
}

export function imageContentType(header: string | null) {
  const value = (header || "").split(";", 1)[0].trim().toLowerCase();
  return IMAGE_TYPES.find((type) => type === value) || null;
}

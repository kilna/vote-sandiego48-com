const encoder = new TextEncoder();

export function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export async function hashCode(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(normalizeCode(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

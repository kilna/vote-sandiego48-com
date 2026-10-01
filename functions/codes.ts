const encoder = new TextEncoder();
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function randomCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += ALPHABET[byte % ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export async function hashCode(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(normalizeCode(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

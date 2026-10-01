export function assetUrl(key: string) {
  return `/api/assets/${key.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

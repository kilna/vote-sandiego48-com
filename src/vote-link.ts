export function voteCodeUrl(code: string) {
  return `https://vote.sandiego48.com/c/${encodeURIComponent(code.trim())}`;
}

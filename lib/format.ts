export function formatSol(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)} SOL`;
}

export function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function shortSignature(signature?: string) {
  if (!signature) return "demo transaction";
  return `${signature.slice(0, 6)}…${signature.slice(-5)}`;
}

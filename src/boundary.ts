// Defense in depth behind guard-paths.sh (the PreToolUse hook): that hook
// only sees Edit/Write tool calls, so `Bash("cat > src/auth/x.ts")`, `bun -e`
// or `sed -i` all bypass it (audit finding #12). Before any push, the runner
// independently diffs the branch against its base and refuses to ship if a
// protected path was touched by any means.

export function touchesProtectedPath(changedFiles: readonly string[], protectedPaths: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of changedFiles) {
    for (const pattern of protectedPaths) {
      if (new Bun.Glob(pattern).match(file)) {
        hits.push(file);
        break;
      }
    }
  }
  return hits;
}

// Inverse check for `factory learn` (plan v2.10.0 item 4): a learning PR is
// exempt from protectedPaths but is only ever allowed to touch its own two
// globs, so this refuses anything outside them rather than checking for a hit.
export function outsideAllowedPaths(changedFiles: readonly string[], allowedPaths: readonly string[]): string[] {
  const misses: string[] = [];
  for (const file of changedFiles) {
    if (!allowedPaths.some((pattern) => new Bun.Glob(pattern).match(file))) {
      misses.push(file);
    }
  }
  return misses;
}

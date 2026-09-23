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

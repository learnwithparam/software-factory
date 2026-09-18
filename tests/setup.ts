// A killed test run skips afterAll, so its worktrees must land in the OS temp dir, not the repo.
// realpath: macOS tmpdir is a symlink, and list() matches git's resolved paths by prefix.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.FACTORY_WORKTREES ??= realpathSync(mkdtempSync(join(tmpdir(), 'factory-worktrees-')))

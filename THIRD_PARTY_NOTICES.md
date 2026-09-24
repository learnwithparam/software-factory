# Third-party notices

Code ported from other projects. Each ported file starts with a `Ported from` header naming the
upstream repo, commit, path and lines; `tests/provenance.test.ts` keeps this file and those headers
in step. Only MIT-licensed code is copied.

## owainlewis/machinist@3943516

Source: https://github.com/owainlewis/machinist (MIT, Copyright (c) 2026 Owain Lewis)

- `dashboard/public/styles.css` from `internal/controlplane/web/src/styles.css`
- `dashboard/public/lib/run-metrics.js` from `internal/controlplane/web/src/run-metrics.js`
- `dashboard/public/lib/runs-board.js` from `internal/controlplane/web/src/runs-board.js`
- `dashboard/public/lib/status-loader.js` from `internal/controlplane/web/src/status-loader.js`
- `dashboard/public/lib/analytics-state.js` from `internal/controlplane/web/src/analytics-state.js`
- `dashboard/public/lib/task-presentation.js` from `internal/controlplane/web/src/task-presentation.js`
- `dashboard/public/lib/routes.js` from `internal/controlplane/web/src/routes.js`
- `src/revision.ts` from `internal/runner/revision.go` (shape from `internal/protocol/revision.go`)
- `src/agents/executor.ts` from `internal/runner/runner.go` (process group kill from `process_unix.go`)
- `src/agents/env.ts` from `internal/runner/runner.go`
- `src/agents/final-message.ts` from `internal/runner/codex_usage.go`
- `src/agents/presets/codex.ts` from `internal/runner/codex_usage.go`
- `src/agents/usage.ts` from `internal/runner/codex_usage.go`

## owainlewis/assembler@7cac671

Source: https://github.com/owainlewis/assembler (MIT, Copyright (c) 2026 Owain Lewis)

- `src/display.ts` from `src/display.ts`
- `src/logs.ts` from `src/runs.ts`

## License text (both projects)

MIT License

Copyright (c) 2026 Owain Lewis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Manrope (font)

`dashboard/public/fonts/manrope-latin.woff2` is the Latin subset of Manrope, copied from the build output
of owainlewis/machinist@3943516. Copyright 2018 The Manrope Project Authors
(https://github.com/sharanda/manrope), SIL Open Font License 1.1. The licence text is in
`dashboard/public/fonts/OFL.txt`, shipped beside the font.

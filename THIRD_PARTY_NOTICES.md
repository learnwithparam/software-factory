# Third-party notices

Code ported from other projects. Each ported file starts with a `Ported from` header naming the
upstream repo, commit, path and lines; `tests/provenance.test.ts` keeps this file and those headers
in step. Only MIT-licensed code is copied.

## owainlewis/machinist@3943516

Source: https://github.com/owainlewis/machinist (MIT, Copyright (c) 2026 Owain Lewis)

- `dashboard/public/styles.css` from `internal/controlplane/web/src/styles.css` [no upstream test]
- `dashboard/public/lib/run-metrics.js` from `internal/controlplane/web/src/run-metrics.js` [tested by `tests/ported/machinist/run-metrics.test.ts`]
- `dashboard/public/lib/runs-board.js` from `internal/controlplane/web/src/runs-board.js` [tested by `tests/ported/machinist/runs-board.test.ts`]
- `dashboard/public/lib/status-loader.js` from `internal/controlplane/web/src/status-loader.js` [tested by `tests/ported/machinist/status-ui.test.ts`]
- `dashboard/public/lib/analytics-state.js` from `internal/controlplane/web/src/analytics-state.js` [no upstream test]
- `dashboard/public/lib/task-presentation.js` from `internal/controlplane/web/src/task-presentation.js` [tested by `tests/ported/machinist/task-presentation.test.ts`]
- `dashboard/public/lib/routes.js` from `internal/controlplane/web/src/routes.js` [tested by `tests/ported/machinist/routes.test.ts`]
- `src/revision.ts` from `internal/runner/revision.go` (shape from `internal/protocol/revision.go`) [tested by `tests/ported/machinist/revision.test.ts`]
- `src/agents/executor.ts` from `internal/runner/runner.go` (process group kill from `process_unix.go`) [tested by `tests/ported/machinist/runner.test.ts`]
- `src/agents/env.ts` from `internal/runner/runner.go` [tested by `tests/ported/machinist/runner.test.ts`]
- `src/event-budget.ts` from `internal/runner/events.go` [tested by `tests/ported/machinist/events.test.ts`]
- `src/agents/final-message.ts` from `internal/runner/codex_usage.go` [tested by `tests/ported/machinist/final-message.test.ts`]
- `src/agents/presets/codex.ts` from `internal/runner/codex_usage.go` [tested by `tests/ported/machinist/usage.test.ts`]
- `src/agents/usage.ts` from `internal/runner/codex_usage.go` [tested by `tests/ported/machinist/usage.test.ts`]
- `src/artifacts.ts` from `internal/protocol/workflow.go` [tested by `tests/ported/machinist/workflow.test.ts`]

## owainlewis/assembler@7cac671

Source: https://github.com/owainlewis/assembler (MIT, Copyright (c) 2026 Owain Lewis)

- `src/display.ts` from `src/display.ts` [tested by `tests/ported/assembler/display.test.ts`]
- `src/logs.ts` from `src/runs.ts` [tested by `tests/ported/assembler/logs.test.ts`]
- `src/config.ts` from `src/index.ts` [tested by `tests/ported/assembler/config.test.ts`]
- `src/agents/reply.ts` from `src/index.ts` [tested by `tests/ported/assembler/outputs.test.ts`]

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

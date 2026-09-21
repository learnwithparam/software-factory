/** Types for scripts/diagram.mjs, which is plain Node and carries none. */
export const PAGES: string[]
export const CANVAS: number
export const PRINT_WIDTH_PT: number
export const MIN_PRINT_PT: number
export const LIMITS: { words: number; figure: number }
export function labels(spec: unknown): string[]
export function problems(id: string, spec: unknown): string[]
export function drawSvg(id: string, spec: unknown): string

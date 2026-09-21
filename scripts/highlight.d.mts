export const PAGES: string[]
export const LANGS: string[]
export function plainText(inner: string): string
export function highlight(lang: string, plain: string): string
export function render(page: string): string
export function stale(page: string): string[]
export function unlabelled(page: string): number

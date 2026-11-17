/** Text sanitization and formatting helpers for plain-text previews and HTML-free Markdown in views. */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
const decodeEntities = (text: string): string => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match, name: string) => ENTITIES[name]!)
/**
 * Replaces each complete tag with one space.
 *
 * Either `<` or `>` is enough to start a tag, so replacing it with a space —
 * never with nothing — keeps neighbouring text from fusing into a new one
 * (`<script>x</script\nscript>y` would otherwise leave `xscript>y`). A tag
 * still consumes exactly the text it matched, so spacing around it is
 * unchanged; the separator only appears where two pieces of text meet.
 */
const stripTags = (text: string): string => text.replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
/**
 * Remove HTML comments, including unterminated ones.
 *
 * `[\s\S]*?` cannot match the `-` between `--` and `>`, so the loop handles a
 * `<!--` that runs into a following `-->` in pieces. Each step removes at least
 * the `<!--` it found, so the loop ends. The replacement is a space for the
 * same fusion reason as {@link stripTags}.
 */
const stripComments = (text: string): string => {
  let current = text
  for (let step = 0; step < 16; step += 1) {
    const next = current.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<!--/g, ' ')
    if (next === current) return next
    current = next
  }
  return current
}
/**
 * Strip HTML comments and tags for Markdown-free display.
 *
 * Entities are decoded in a loop rather than once: `&amp;lt;script&amp;gt;`
 * decodes to `&lt;script&gt;`, which a single post-decode strip would leave as
 * `<script>`. The loop ends when a pass changes nothing; it also ends the
 * cycle `<script``<!-->`, where the comment rule produces the tag the tag rule
 * then produces back. The bound only guards pathological input.
 */
const withoutHtml = (text: string): string => {
  let current = text
  for (let pass = 0; pass < 8; pass += 1) {
    const next = stripComments(stripTags(decodeEntities(current)))
    if (next === current) return next
    current = next
  }
  // Still changing after the bound: return only what carries no markup at all.
  return stripComments(stripTags(current))
}
export function plain(text: string, lines = false): string {
  const result = withoutHtml(text)
    .replace(/!\[[^\]]*\]\([^)]*\)|\[Image: [^\]]*\]/g, '[image]')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+/gm, lines ? '• ' : '').replace(/(\*\*|__|`)/g, '')
  return lines ? result.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : result.replace(/\s+/g, ' ').trim()
}
export const markdown = (text: string): string => withoutHtml(text).replace(/!\[[^\]]*\]\([^)]*\)|\[Image: [^\]]*\]/g, '[image]').trim()
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value !== 'object'
function inline(value: unknown): string {
  if (scalar(value)) return value === null ? '' : String(value)
  return (Array.isArray(value) ? value : Object.values(value as object)).map(inline).filter(Boolean).join(Array.isArray(value) ? ', ' : ' · ')
}
function jsonLines(value: unknown): string[] {
  if (Array.isArray(value) && !value.every(scalar)) return value.map(item => `- ${inline(item)}`)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([name, item]) => scalar(item) || (Array.isArray(item) && item.every(scalar)) ? [`${name}: ${inline(item)}`]
      : [`${name}:`, ...jsonLines(item)])
  }
  return [inline(value)]
}
/** Formats JSON payloads (or `label: <JSON>` notices) as key-value lines; returns non-JSON text unchanged. */
export function readable(text: string): string {
  const match = /^(?:([^\n{[]{1,200}): )?(\{[\s\S]*\}|\[[\s\S]*\])$/.exec(text.trim())
  if (!match) return text
  try { return [...match[1] ? [match[1]] : [], ...jsonLines(JSON.parse(match[2]!))].join('\n') }
  catch (error) { void error /* Text that only looks like JSON is shown as written. */; return text }
}
export function preview(text: string, length = 160): string { return plain(readable(text)).slice(0, length) }
export const attribute = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined

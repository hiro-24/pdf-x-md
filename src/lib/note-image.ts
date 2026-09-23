import type { Field } from './markdown-edit'

/**
 * How a note refers to an image it owns.
 *
 * Not a data: URL. The note body is read in bulk - every note in the library is
 * concatenated to build the search index at startup - so a screenshot spelled
 * out inside it would be paid for on every launch. The body carries a name; the
 * bytes live in their own store and in the sync folder under the same name.
 */
export const IMAGE_PREFIX = 'img:'

/** Names are ours to choose, so choose ones that are also legal filenames. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

export function isImage(type: string): boolean {
  return type in EXTENSIONS
}

/** A fresh name for an image of this type: id and extension in one string. */
export function imageName(type: string, random = () => Math.random().toString(36).slice(2, 10)): string {
  return `${random()}.${EXTENSIONS[type] ?? 'png'}`
}

/** The media type a name implies, for handing a file back to the browser. */
export function typeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return Object.keys(EXTENSIONS).find((type) => EXTENSIONS[type] === ext) ?? 'application/octet-stream'
}

const REFERENCE = /!\[[^\]]*\]\(img:([A-Za-z0-9_-]+\.[A-Za-z0-9]+)\)/g

/** Every image this note refers to, without repeats. */
export function imagesIn(body: string): string[] {
  return [...new Set([...body.matchAll(REFERENCE)].map((match) => match[1]))]
}

/**
 * Put an image where the caret is, on a line of its own.
 *
 * On its own line because Markdown renders an image inside a paragraph as part
 * of the text, which puts a screenshot in the middle of a sentence; and because
 * what follows a pasted picture is usually a new thought.
 */
export function insertImage(field: Field, name: string, alt = ''): Field {
  const { value, start, end } = field
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before === '' || before.endsWith('\n') ? '' : '\n'
  const tail = after.startsWith('\n') || after === '' ? '' : '\n'
  const block = `${lead}![${alt}](${IMAGE_PREFIX}${name})\n${tail}`
  const caret = start + block.length
  return { value: before + block + after, start: caret, end: caret }
}

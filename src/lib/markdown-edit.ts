/**
 * The text edits behind the note editor's formatting buttons.
 *
 * Kept as plain functions over a string and a selection, with no textarea in
 * sight, so that the fiddly parts - what a half-selected line counts as, where
 * the caret lands afterwards - can be pinned down in tests.
 */

export interface Field {
  value: string
  start: number
  end: number
}

/** A marker that goes in front of a line, numbered ones included. */
export interface LineMark {
  /** The marker for the nth selected line, counting from zero. */
  make: (index: number) => string
  /** Recognises the marker, including the markers this one replaces. */
  match: RegExp
}

export const BULLET: LineMark = { make: () => '- ', match: /^(\s*)(?:[-*]\s\[[ xX]\]\s|[-*]\s|\d+\.\s)/ }
export const NUMBER: LineMark = { make: (i) => `${i + 1}. `, match: BULLET.match }
export const TASK: LineMark = { make: () => '- [ ] ', match: BULLET.match }
export const QUOTE: LineMark = { make: () => '> ', match: /^(\s*)>\s?/ }
export const HEADING: LineMark = { make: () => '## ', match: /^(\s*)#{1,6}\s/ }

/** The lines the selection touches, even if it only clips their ends. */
function lineSpan(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const to = value.indexOf('\n', end)
  return [from, to === -1 ? value.length : to]
}

/**
 * Put a marker in front of every touched line, or take it off if they all
 * already have it. Lines that carry a different list marker are converted
 * rather than doubled up, which is what pressing "numbered" over a bullet list
 * is asking for.
 */
export function toggleLines(field: Field, mark: LineMark): Field {
  const [from, to] = lineSpan(field.value, field.start, field.end)
  const lines = field.value.slice(from, to).split('\n')
  const wanted = lines.map((_, index) => mark.make(index))
  // A blank line inside a selection is a gap between paragraphs, and stays one.
  // But a line with nothing on it anywhere near it is not a gap - it is where
  // the writing is about to start, which is exactly when the button gets
  // pressed on a new note. There, the marker goes in.
  const blank = lines.every((line) => line.trim() === '')
  const already = !blank && lines.every((line, index) => line.startsWith(wanted[index]) || line.trim() === '')

  const next = lines.map((line, index) => {
    const indent = line.match(/^\s*/)?.[0] ?? ''
    const bare = line.replace(mark.match, '$1').slice(indent.length)
    if (already) return line.startsWith(wanted[index]) ? indent + line.slice(wanted[index].length) : line
    if (line.trim() === '' && !blank) return line
    return indent + wanted[index] + bare
  })

  const block = next.join('\n')
  const value = field.value.slice(0, from) + block + field.value.slice(to)

  // Something selected stays selected, so the next button can be pressed on the
  // same lines. A bare caret keeps its place instead, moved along by however
  // much its line grew: selecting the line it had just marked would mean the
  // next keystroke wiped the marker straight off again.
  if (field.start !== field.end) return { value, start: from, end: from + block.length }
  const at = Math.max(from, field.start + block.length - (to - from))
  return { value, start: at, end: at }
}

/**
 * Wrap the selection, or unwrap it if it is already wrapped. With nothing
 * selected the markers go in and the caret lands between them, ready to type.
 */
export function toggleWrap(field: Field, marker: string): Field {
  const { value, start, end } = field
  const selected = value.slice(start, end)

  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    const bare = selected.slice(marker.length, -marker.length)
    return { value: value.slice(0, start) + bare + value.slice(end), start, end: start + bare.length }
  }
  // The markers may sit just outside the selection - the reader picked the word,
  // not the asterisks around it.
  const before = value.slice(start - marker.length, start)
  const after = value.slice(end, end + marker.length)
  if (before === marker && after === marker) {
    return {
      value: value.slice(0, start - marker.length) + selected + value.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    }
  }
  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    start: start + marker.length,
    end: end + marker.length,
  }
}

const ITEM = /^(\s*)([-*]\s\[[ xX]\]\s|[-*]\s|(\d+)\.\s)(.*)$/

/**
 * What Enter should do inside a list: carry the marker onto the next line, and
 * numbered lists count on. Pressing it on an item with nothing in it ends the
 * list instead, which is how you stop without reaching for backspace.
 *
 * Returns null when the caret is not in a list, leaving Enter alone.
 */
export function continueList(field: Field): Field | null {
  const { value, start, end } = field
  if (start !== end) return null

  const from = value.lastIndexOf('\n', start - 1) + 1
  const line = value.slice(from, start)
  const parts = ITEM.exec(line)
  if (!parts) return null

  const [, indent, marker, number, content] = parts
  if (content.trim() === '') {
    // An empty item: clear it and leave the list.
    return { value: value.slice(0, from) + value.slice(start), start: from, end: from }
  }

  const next = number ? `${Number(number) + 1}. ` : marker.replace(/\[[xX]\]/, '[ ]')
  const inserted = `\n${indent}${next}`
  return {
    value: value.slice(0, start) + inserted + value.slice(start),
    start: start + inserted.length,
    end: start + inserted.length,
  }
}

/** Four spaces. Tabs render at whatever width the reader's editor feels like,
 *  and Markdown counts spaces when it decides how deep a list item sits. */
const INDENT = '    '

/**
 * What Tab should do.
 *
 * On a list item it moves the whole line, because that is what Tab means in a
 * list: put this item under the one above it. Anywhere else, with nothing
 * selected, it is a plain indent where the caret is. With something selected it
 * always moves every touched line, and leaves them selected so it can be
 * pressed again.
 *
 * Shift+Tab is the same in reverse, taking one step of indentation off each
 * line - four spaces, or a tab if that is what is there.
 */
export function shiftLines(field: Field, out: boolean): Field {
  const { value, start, end } = field

  if (!out && start === end) {
    const at = value.lastIndexOf('\n', start - 1) + 1
    const ends = value.indexOf('\n', start)
    // Not a list item: Tab is four spaces where you are, not a moved line.
    if (!ITEM.test(value.slice(at, ends === -1 ? value.length : ends))) {
      const caret = start + INDENT.length
      return { value: value.slice(0, start) + INDENT + value.slice(start), start: caret, end: caret }
    }
  }

  const [from, to] = lineSpan(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const moved = lines.map((line) => {
    if (out) return line.replace(/^(\t| {1,4})/, '')
    // A blank line inside a selection is a gap between paragraphs; indenting it
    // would leave trailing spaces on an otherwise empty line.
    return line.trim() === '' ? line : INDENT + line
  })

  const block = moved.join('\n')
  const next = value.slice(0, from) + block + value.slice(to)
  if (start !== end) return { value: next, start: from, end: from + block.length }
  const caret = Math.max(from, start + block.length - (to - from))
  return { value: next, start: caret, end: caret }
}

/**
 * The first line with something on it, with its Markdown taken off - a note's
 * name, in other words. Notes have no title field: the first line is the title,
 * the way it is in every notebook.
 */
export function firstLine(body: string): string {
  const line = body.split('\n').find((candidate) => candidate.trim() !== '') ?? ''
  return line
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s*/, '')
    .replace(/[*_`]/g, '')
    .trim()
}

import { TAG_COLORS, type Tag, type TagColor } from '../types'

/** Give a new tag a colour that isn't already crowding the palette. */
export function nextColor(palette: Tag[]): TagColor {
  const used = new Map<TagColor, number>()
  for (const tag of palette) used.set(tag.color, (used.get(tag.color) ?? 0) + 1)
  return [...TAG_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]
}

/** How many documents carry each tag, for the management table's usage column. */
export function tagUsage(docs: { tags?: string[] }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const doc of docs) {
    for (const name of doc.tags ?? []) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

import { useEffect, useState } from 'react'
import * as db from '../db'
import { IMAGE_PREFIX } from '../lib/note-image'

/**
 * Object URLs, made once and kept for as long as the tab lives.
 *
 * The same image can be on screen in several places at once - a note beside its
 * page, the same note in another window of the app, a summary quoting it - so
 * revoking one on unmount would blank the others. They are released when the
 * image itself goes.
 */
const urls = new Map<string, string>()

export function releaseImage(name: string): void {
  const url = urls.get(name)
  if (!url) return
  URL.revokeObjectURL(url)
  urls.delete(name)
}

/** Renders `![](img:name.png)` by looking the bytes up; anything else is a
 *  plain image, so a note can still point at a URL on the web. */
export default function NoteImage({ src, alt }: { src?: string; alt?: string }) {
  const name = src?.startsWith(IMAGE_PREFIX) ? src.slice(IMAGE_PREFIX.length) : null
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!name) return
    const cached = urls.get(name)
    if (cached) {
      setUrl(cached)
      return
    }
    let cancelled = false
    db.getImage(name).then((image) => {
      if (cancelled) return
      if (!image) {
        setMissing(true)
        return
      }
      const made = urls.get(name) ?? URL.createObjectURL(image.blob)
      urls.set(name, made)
      setUrl(made)
    }, console.error)
    return () => {
      cancelled = true
    }
  }, [name])

  if (!name) return <img src={src} alt={alt ?? ''} />
  // Said out loud rather than shown as a broken image: the note still has the
  // words around it, and the reader needs to know which picture went missing.
  if (missing) return <span className="markdown__gone">画像が見つかりません（{name}）</span>
  if (!url) return <span className="markdown__waiting" aria-hidden="true" />
  return <img className="markdown__image" src={url} alt={alt ?? ''} />
}

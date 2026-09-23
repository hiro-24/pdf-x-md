import { parseBundle, parsePaletteFile, type Bundle, type PaletteFile } from './bundle'
import { imagesIn } from './note-image'

/**
 * A "vault" is a folder on the real filesystem that mirrors every document's
 * notes. IndexedDB stays the working store, but it is no longer the only copy:
 * clearing site data, or moving to another machine, costs nothing as long as the
 * folder survives. Put it in iCloud Drive or Dropbox and backup comes for free.
 */

export const vaultSupported = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

const SUFFIX = '.notes.json'

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    return await window.showDirectoryPicker({ id: 'pdf-note-vault', mode: 'readwrite', startIn: 'documents' })
  } catch (cause) {
    // The user dismissed the picker; that isn't an error worth surfacing.
    if (cause instanceof DOMException && cause.name === 'AbortError') return null
    throw cause
  }
}

export async function permissionState(dir: FileSystemDirectoryHandle): Promise<PermissionState> {
  return dir.queryPermission({ mode: 'readwrite' })
}

/** Must be called from a user gesture, or Chrome rejects it out of hand. */
export async function requestAccess(dir: FileSystemDirectoryHandle): Promise<boolean> {
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'
}

const baseName = (pdfName: string) => pdfName.replace(/\.pdf$/i, '').replace(/[/\\:]/g, '_')

async function readFileText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name)
    return await (await handle.getFile()).text()
  } catch {
    return null
  }
}

async function writeFileText(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

/**
 * Where this document's notes live. Two different PDFs can share a filename, so
 * a name that is already taken by another fingerprint gets a short suffix.
 */
async function resolveFileName(dir: FileSystemDirectoryHandle, bundle: Bundle): Promise<string> {
  const base = baseName(bundle.doc.name)
  const preferred = `${base}${SUFFIX}`
  const existing = await readFileText(dir, preferred)
  if (!existing) return preferred
  try {
    const other = parseBundle(existing)
    if (!other.doc.fingerprint || other.doc.fingerprint === bundle.doc.fingerprint) return preferred
  } catch {
    return preferred
  }
  return `${base}.${(bundle.doc.fingerprint ?? 'x').slice(0, 8)}${SUFFIX}`
}

export async function writeBundle(
  dir: FileSystemDirectoryHandle,
  bundle: Bundle,
  markdown: string,
  /** Asked only for pictures the folder does not already hold. */
  imageFor?: (name: string) => Promise<Blob | null>,
): Promise<string> {
  const name = await resolveFileName(dir, bundle)
  await writeFileText(dir, name, JSON.stringify(bundle, null, 2))
  // The .md is a courtesy copy for reading and grepping; the .json is the record.
  await writeFileText(dir, name.replace(/\.json$/, '.md'), markdown)
  if (imageFor) await writeImages(dir, bundle.notes.flatMap((note) => imagesIn(note.body)), imageFor)
  return name
}

/* ------------------------------------------------------------------- images */

/**
 * Pictures live in one folder shared by every document, under the name the
 * note refers to them by.
 *
 * Shared rather than one folder per PDF because the name is already unique, and
 * because the same screenshot can end up quoted in notes on two different
 * documents. The leading underscore sorts it above the notes and reads as
 * something the app keeps rather than something you wrote.
 */
export const IMAGE_DIR = '_images'

async function held(folder: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await folder.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/** Write the ones that are not there yet. Written once and then left alone:
 *  a note is saved on every pause in typing, and a screenshot is not small. */
async function writeImages(
  dir: FileSystemDirectoryHandle,
  names: string[],
  imageFor: (name: string) => Promise<Blob | null>,
): Promise<void> {
  const wanted = [...new Set(names)]
  if (!wanted.length) return
  const folder = await dir.getDirectoryHandle(IMAGE_DIR, { create: true })
  for (const name of wanted) {
    if (await held(folder, name)) continue
    const blob = await imageFor(name)
    if (!blob) continue
    const writable = await (await folder.getFileHandle(name, { create: true })).createWritable()
    await writable.write(blob)
    await writable.close()
  }
}

/** Read one back, for a browser that has the notes but not the pictures. */
export async function readImage(dir: FileSystemDirectoryHandle, name: string): Promise<Blob | null> {
  try {
    const folder = await dir.getDirectoryHandle(IMAGE_DIR)
    return await (await folder.getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

/**
 * Find this PDF's notes in the folder, by fingerprint first and filename second.
 *
 * Scans to the end rather than stopping at the first hit: Google Drive, Dropbox
 * and iCloud all leave a conflict copy beside the original when two machines
 * write at once, so several files can carry the same fingerprint. Taking the
 * newest keeps this consistent with how the app resolves a sync everywhere else.
 */
export async function findBundle(
  dir: FileSystemDirectoryHandle,
  fingerprint: string | null,
  pdfName: string,
): Promise<Bundle | null> {
  let byFingerprint: Bundle | null = null
  let byName: Bundle | null = null

  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith(SUFFIX)) continue
    const text = await readFileText(dir, entry.name)
    if (!text) continue
    let bundle: Bundle
    try {
      bundle = parseBundle(text)
    } catch {
      continue
    }

    if (fingerprint && bundle.doc.fingerprint === fingerprint) {
      if (!byFingerprint || bundle.savedAt > byFingerprint.savedAt) byFingerprint = bundle
    } else if (bundle.doc.name === pdfName) {
      if (!byName || bundle.savedAt > byName.savedAt) byName = bundle
    }
  }

  // Only trust the filename when neither side has a fingerprint to compare.
  return fingerprint ? byFingerprint : byName
}

/* ------------------------------------------------------------------ palette */

/** Leading underscore so it sorts above the notes and reads as metadata. It
 *  deliberately doesn't end in `.notes.json`, which is what findBundle scans for. */
const PALETTE_FILE = '_tags.json'

export async function readPalette(dir: FileSystemDirectoryHandle): Promise<PaletteFile | null> {
  const text = await readFileText(dir, PALETTE_FILE)
  if (!text) return null
  try {
    return parsePaletteFile(text)
  } catch {
    return null
  }
}

export async function writePalette(dir: FileSystemDirectoryHandle, file: PaletteFile): Promise<void> {
  await writeFileText(dir, PALETTE_FILE, JSON.stringify(file, null, 2))
}

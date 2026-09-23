import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import NoteImage from './NoteImage'
import { IMAGE_PREFIX } from '../lib/note-image'

/** `img:` is ours, so react-markdown's url cleaning has to be told to let it
 *  through - it keeps only the schemes a browser can follow, and rightly so. */
const allow = (url: string) => (url.startsWith(IMAGE_PREFIX) ? url : defaultUrlTransform(url))

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={allow} components={{ img: NoteImage }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

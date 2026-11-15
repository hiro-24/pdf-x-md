import ReactMarkdown, { defaultUrlTransform, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'katex/dist/katex.min.css'
import NoteImage from './NoteImage'
import { IMAGE_PREFIX } from '../lib/note-image'

/** `img:` is ours, so react-markdown's url cleaning has to be told to let it
 *  through - it keeps only the schemes a browser can follow, and rightly so. */
const allow = (url: string) => (url.startsWith(IMAGE_PREFIX) ? url : defaultUrlTransform(url))

/**
 * `$...$` in a line, `$$...$$` on lines of their own - the spelling Obsidian,
 * Typora and GitHub read too, so the exported `.md` renders there as well.
 * A literal dollar is written `\$`.
 */
const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath]

/**
 * KaTeX before highlighting: a ```` ```math ```` block is drawn as display
 * math, and it has to be taken out before the highlighter sees a code block.
 *
 * `strict: 'ignore'` because notes here are Japanese - `$v = 速度$` is LaTeX
 * that a TeX engine would reject, but KaTeX draws it fine, and the default
 * would print a console warning for every such character on every render.
 *
 * The highlighter only colours blocks that name their language. Guessing at
 * the rest would paint a pasted paragraph as if it were code.
 */
const rehypePlugins: Options['rehypePlugins'] = [[rehypeKatex, { strict: 'ignore' }], rehypeHighlight]

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={allow}
        components={{ img: NoteImage }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

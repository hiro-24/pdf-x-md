// The note editor's formatting buttons, as text in and text out.
import {
  BULLET, HEADING, NUMBER, QUOTE, TASK,
  continueList, toggleLines, toggleWrap, type Field,
} from '../../src/lib/markdown-edit'

let bad = 0
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`)
}

/** "a|b" marks the caret, "a[bc]d" marks a selection. */
const field = (marked: string): Field => {
  if (marked.includes('|')) {
    const start = marked.indexOf('|')
    return { value: marked.replace('|', ''), start, end: start }
  }
  const start = marked.indexOf('[')
  const end = marked.indexOf(']') - 1
  return { value: marked.replace('[', '').replace(']', ''), start, end }
}
/** Render a result back into the same notation, so failures read as text. */
const show = (f: Field) =>
  f.start === f.end
    ? `${f.value.slice(0, f.start)}|${f.value.slice(f.start)}`
    : `${f.value.slice(0, f.start)}[${f.value.slice(f.start, f.end)}]${f.value.slice(f.end)}`

/* ------------------------------------------------------------- line markers */

check('a bullet goes on the caret line', show(toggleLines(field('買うも|の'), BULLET)), '- 買うも|の')
check('an empty note starts a list rather than shrugging',
  show(toggleLines(field('|'), BULLET)), '- |')
check('so does a fresh line under a paragraph',
  show(toggleLines(field('あ\n|'), BULLET)), 'あ\n- |')
check('the same for a heading on an empty note', show(toggleLines(field('|'), HEADING)), '## |')
check('and a checkbox', show(toggleLines(field('|'), TASK)), '- [ ] |')
check('pressing it again takes it off', show(toggleLines(field('[- 買うもの]'), BULLET)), '[買うもの]')
check('every selected line gets one',
  show(toggleLines(field('[りんご\nみかん]'), BULLET)), '[- りんご\n- みかん]')
check('a half-touched line still counts',
  show(toggleLines(field('りん[ご\nみか]ん'), BULLET)), '[- りんご\n- みかん]')
check('blank lines are left alone', show(toggleLines(field('[a\n\nb]'), BULLET)), '[- a\n\n- b]')

check('numbers count up', show(toggleLines(field('[a\nb\nc]'), NUMBER)), '[1. a\n2. b\n3. c]')
check('a bullet list converts rather than doubling up',
  show(toggleLines(field('[- a\n- b]'), NUMBER)), '[1. a\n2. b]')
check('and back again', show(toggleLines(field('[1. a\n2. b]'), BULLET)), '[- a\n- b]')

check('a task box', show(toggleLines(field('牛乳を買|う'), TASK)), '- [ ] 牛乳を買|う')
check('a quote', show(toggleLines(field('引用|文'), QUOTE)), '> 引用|文')
check('a heading', show(toggleLines(field('見出|し'), HEADING)), '## 見出|し')
check('a deeper heading is replaced, not stacked',
  show(toggleLines(field('[#### 見出し]'), HEADING)), '[## 見出し]')
check('indentation is kept', show(toggleLines(field('  ネス|ト'), BULLET)), '  - ネス|ト')
check('taking one off pulls the caret back with it',
  show(toggleLines(field('- 買う|もの'), BULLET)), '買う|もの')
check('a caret inside the marker does not fall off the line',
  show(toggleLines(field('-| 買うもの'), BULLET)), '|買うもの')

/* -------------------------------------------------------------- wrapping */

check('bold wraps the selection', show(toggleWrap(field('これは[大事]です'), '**')), 'これは**[大事]**です')
check('and unwraps it', show(toggleWrap(field('これは[**大事**]です'), '**')), 'これは[大事]です')
check('markers just outside the selection count too',
  show(toggleWrap(field('これは**[大事]**です'), '**')), 'これは[大事]です')
check('with nothing selected the caret lands inside',
  show(toggleWrap(field('a|b'), '**')), 'a**|**b')
check('inline code', show(toggleWrap(field('[npm test]'), '`')), '`[npm test]`')

/* ------------------------------------------------------------ list on Enter */

check('Enter carries the bullet on', show(continueList(field('- りんご|'))!), '- りんご\n- |')
check('numbered lists count up', show(continueList(field('3. みっつめ|'))!), '3. みっつめ\n4. |')
check('a ticked box comes back empty', show(continueList(field('- [x] やった|'))!), '- [x] やった\n- [ ] |')
check('indentation carries too', show(continueList(field('  - ネスト|'))!), '  - ネスト\n  - |')
check('an empty item ends the list', show(continueList(field('- あ\n- |'))!), '- あ\n|')
check('an empty numbered item too', show(continueList(field('1. あ\n2. |'))!), '1. あ\n|')
check('plain text is left to Enter', continueList(field('ただの文|')), null)
check('a selection is left alone', continueList(field('[- あ]')), null)
check('the caret mid-item still continues', show(continueList(field('- りん|ご'))!), '- りん\n- |ご')

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

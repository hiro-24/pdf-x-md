// Runs the test suites. Browser suites need `npm run dev` up on :5173 and a
// real Chrome - pdf.js under a CDP-attached browser is not the same program.
//
//   node tests/run.mjs              every suite
//   node tests/run.mjs shelf lanes  just these
import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { makeFixtures } from './fixtures/make.mjs'

const root = new URL('.', import.meta.url).pathname
const only = process.argv.slice(2)
const wanted = (name) => !only.length || only.includes(name.replace(/\.(mjs|ts)$/, ''))

const run = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: root })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })

const dev = await fetch('http://localhost:5173').then((r) => r.ok).catch(() => false)
if (!dev) {
  console.error('tests: nothing is serving http://localhost:5173 - start `npm run dev` first')
  process.exit(1)
}

await makeFixtures()

const units = readdirSync(`${root}unit`).filter((f) => f.endsWith('.ts') && wanted(f))
const browsers = readdirSync(`${root}browser`).filter((f) => f.endsWith('.mjs') && wanted(f))

let failed = 0
for (const file of units) {
  const built = `${root}unit/.${file.replace(/\.ts$/, '.mjs')}`
  const compile = await run('npx', ['esbuild', `unit/${file}`, '--bundle', '--platform=node', '--format=esm',
    `--outfile=${built}`, '--log-level=error'])
  if (compile.code) { console.log(`FAIL  unit/${file} (did not compile)\n${compile.out}`); failed += 1; continue }
  const { code, out } = await run('node', [built])
  report(`unit/${file}`, code, out)
}
for (const file of browsers) {
  const { code, out } = await run('node', [`browser/${file}`])
  report(`browser/${file}`, code, out)
}

function report(name, code, out) {
  const passes = (out.match(/^PASS/gm) ?? []).length
  const fails = out.split('\n').filter((line) => line.startsWith('FAIL'))
  const noisy = out.includes('CONSOLE ERRORS')
  if (code || fails.length || noisy) {
    failed += 1
    console.log(`\nFAIL  ${name}\n${out.trim()}`)
  } else {
    console.log(`ok    ${name.padEnd(26)} ${passes} checks`)
  }
}

console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed')
process.exit(failed ? 1 : 0)

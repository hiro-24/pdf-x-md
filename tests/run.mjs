// Runs the test suites, against a server of their own.
//
// Browser suites need a real Chrome - pdf.js under a CDP-attached browser is
// not the same program - and they need their own origin: each one starts by
// deleting the database, and the database belongs to the origin. Sharing a
// port with the app you read in would mean `npm test` wiping your library, so
// this starts its own server on 5175 and stops it on the way out.
//
//   node tests/run.mjs              every suite
//   node tests/run.mjs shelf lanes  just these
import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { makeFixtures } from './fixtures/make.mjs'
import { APP, PORT } from './app-url.mjs'

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

const answering = () => fetch(APP).then((r) => r.ok).catch(() => false)

/** Start the suites' own server, unless one is already there from last time. */
async function serve() {
  if (await answering()) return null

  // The worker files the app imports by URL are copied in, not bundled.
  await run('node', ['../scripts/copy-pdfjs-assets.mjs'])
  const server = spawn('npx', ['vite', '--port', PORT, '--strictPort', '--clearScreen', 'false'], {
    cwd: `${root}..`,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let noise = ''
  server.stdout.on('data', (d) => (noise += d))
  server.stderr.on('data', (d) => (noise += d))

  for (let i = 0; i < 60; i += 1) {
    if (server.exitCode !== null) {
      console.error(`tests: the server would not start\n${noise.trim()}`)
      process.exit(1)
    }
    if (await answering()) return server
    await new Promise((done) => setTimeout(done, 250))
  }
  server.kill()
  console.error(`tests: ${APP} never answered\n${noise.trim()}`)
  process.exit(1)
}

const server = await serve()
const stop = () => server?.kill()
process.on('exit', stop)
process.on('SIGINT', () => { stop(); process.exit(130) })

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

stop()
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed')
process.exit(failed ? 1 : 0)

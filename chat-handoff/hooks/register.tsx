import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, SessionMessage } from 'claude-code'

import type { Panel, Step } from '../types'

// One value for the whole band: offer, steps, buttons.
const panel = atom({ plugin: 'chat-handoff', key: 'panel' } as const, null)

// The Refresh offer opens at this many tokens; the "offerAtTokens" option in plugin.json
// changes it. Closing a finished handoff, or hiding the offer, moves it up by SNOOZE_SHARE
// of that (100k at the default). Chats auto-compact near 300k to 324k, so 250k opens well before.
const DEFAULT_OFFER_AT = 250_000
const SNOOZE_SHARE = 0.4
const POLL_MS = 5000
const SWITCH_MS = 3000
const TICK_MS = 110
// A quick step still shows its bar filling for this long, so the rows read one by one.
const MIN_STEP_MS = 300
// The handoff step's bar creeps toward full on this time scale while the model writes.
const WRITE_SCALE_MS = 40_000
// A write longer than this most likely lost the person's attention: a notification calls them back.
const NOTIFY_AFTER_MS = 15_000
const BAR = 18
const PANE = 'chat-handoff-preview'

// Orange to yellow: deep at the start of a bar, bright at its tip. Text and glyphs use the
// deep and middle tones, which read on light and dark; yellow is only ever a bar's fill.
const O_DEEP = '#ea580c'
const O_MID = '#f59e0b'
const O_LIGHT = '#facc15'
const ACCENT = O_DEEP
const GOOD = O_MID
const BAD = 'error'
const BAD_HEX = '#dc2626'
// The desktop bar, in CSS pixels; its shine moves this many pixels a tick.
const SVG_W = 160
const SVG_H = 10
const SHINE_W = 44
const SHINE_STEP = 6
const SPIN = ['◐', '◓', '◑', '◒']

// The gathering is one row: it is local and quick, and the model step is where the time goes.
const LABELS = ['Gathering the chat', 'Writing the handoff', 'Saving and checking']
const WRITE = 1
// Ranked file candidates checked at once, and how many of those that exist the fork is told about.
const FILE_CANDIDATES = 60
const FILES_KEPT = 20

// Module variables reset on a reload; the band itself lives in the atom.
let sid = ''
let home = ''
let petDir = ''
let busy = false
// The model asked for a refresh in the middle of its turn: it starts when the turn ends,
// because a fork while a tool call is open would send a tool use with no result.
let pending = false
let offerAt = DEFAULT_OFFER_AT
let snoozedTo = DEFAULT_OFFER_AT
let handoffText = ''
let handoffPath = ''
let ticker: { cancel: () => void } | null = null
let writeStartedAt = 0
let writeMs = 0
let running = -1
let stepStartedAt = 0

// ~/.claude/mods/switches.json: "chat-handoff": false turns this mod off in every chat, which
// /chat-handoff on|off writes; "chat-handoff:hidden": true stops the automatic Refresh offer
// (set by hand). /chat-refresh brings the offer up now.
const NAME = 'chat-handoff'
const HIDE_KEY = `${NAME}:hidden`
let off = false
let hidden = false
// The offer was asked for (/chat-refresh): it stays whatever the token count.
let forced = false

async function readSwitch($: EngineInterface) {
  let nowOff = off
  let nowHidden = hidden
  try {
    const path = `${home}/.claude/mods/switches.json`
    const json = (await $.fs.exists(path)) ? (JSON.parse(String(await $.fs.read(path))) as unknown) : {}
    const sw = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
    nowOff = sw[NAME] === false
    nowHidden = sw[HIDE_KEY] === true
  } catch {
    // A broken or missing file changes nothing.
  }
  if (nowOff === off && nowHidden === hidden) return
  off = nowOff
  const hiding = nowHidden && !hidden
  hidden = nowHidden
  if (hiding) await dropOffer($)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

// Turns the mod on or off in every chat: "chat-handoff": false in the shared switches file is off, and on removes
// the key. False when the file cannot be written.
async function writeSwitch($: EngineInterface, on: boolean): Promise<boolean> {
  try {
    const path = `${home}/.claude/mods/switches.json`
    let json: Record<string, unknown> = {}
    try {
      const parsed = (await $.fs.exists(path)) ? (JSON.parse(String(await $.fs.read(path))) as unknown) : {}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
    } catch {
      // Not JSON: it starts from empty.
    }
    if (on) delete json[NAME]
    else json[NAME] = false
    await $.process.run(['mkdir', '-p', `${home}/.claude/mods`])
    await $.fs.write(path, `${JSON.stringify(json, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

// Hidden: an offer on screen goes; the steps and a finished handoff stay.
async function dropOffer($: EngineInterface) {
  forced = false
  const p = await read($, panel)
  if (p?.phase === 'offer') await update($, panel, () => null)
}

// Brings the Refresh offer up now, whatever the token count.
async function showOffer($: EngineInterface) {
  const p = await read($, panel)
  // Steps running, or a handoff ready or failed: that panel is already up.
  if (busy || (p && p.phase !== 'offer')) return
  const { context } = await $.session.usage()
  forced = true
  await setPanel($, { phase: 'offer', tokens: context.tokens ?? 0, steps: freshSteps(), tick: 0, file: '', words: 0, error: '', note: '' })
}

const short = (tokens: number) => `${Math.round(tokens / 1000)}k`
const tilde = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p)
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

function freshSteps(): Step[] {
  return LABELS.map(label => ({ label, detail: '', status: 'wait', progress: 0 }))
}

async function setPanel($: EngineInterface, p: Panel | null) {
  await update($, panel, () => p)
}

async function patchStep($: EngineInterface, i: number, change: Partial<Step>) {
  const p = await read($, panel)
  if (!p) return
  await setPanel($, { ...p, steps: p.steps.map((s, k) => (k === i ? { ...s, ...change } : s)) })
}

// Moves the spinner and the running step's bar.
async function tick($: EngineInterface) {
  const p = await read($, panel)
  if (!p || p.phase !== 'working') return
  const now = await $.clock.now()
  const steps = p.steps.map((s, k) => {
    if (k !== running || s.status !== 'run') return s
    if (k === WRITE) {
      const t = now - writeStartedAt
      return { ...s, progress: Math.min(0.95, 1 - Math.exp(-t / WRITE_SCALE_MS)), detail: `${Math.round(t / 1000)} s` }
    }
    return { ...s, progress: Math.min(0.9, (now - stepStartedAt) / MIN_STEP_MS) }
  })
  await setPanel($, { ...p, steps, tick: p.tick + 1 })
}

// Runs one step: its work, and at least MIN_STEP_MS of bar.
async function step<T>($: EngineInterface, i: number, work: () => Promise<T>, detail: (v: T) => string): Promise<T> {
  running = i
  stepStartedAt = await $.clock.now()
  if (i === WRITE) writeStartedAt = stepStartedAt
  await patchStep($, i, { status: 'run', progress: 0.02 })
  const value = await work()
  const left = MIN_STEP_MS - ((await $.clock.now()) - stepStartedAt)
  if (left > 0 && i !== WRITE) await $.clock.sleep(left)
  await patchStep($, i, { status: 'done', progress: 1, detail: detail(value) })
  return value
}

type Gathered = { messages: SessionMessage[]; tools: number; files: string[]; skills: string[]; links: string[] }

const PATH_RE = /(?:~|\/Users)\/[^\s'"`<>()|;,*]+/g
const URL_RE = /https?:\/\/[^\s'"`<>()\]]+/g

async function gatherFiles($: EngineInterface, messages: SessionMessage[]) {
  const count = new Map<string, number>()
  const add = (raw: string, weight: number) => {
    let p = raw.replace(/[.:]+$/, '')
    if (p.startsWith('~/')) p = home + p.slice(1)
    if (p.includes('/.claude/projects/') || p.includes('/tool-results/') || p.startsWith('/private/tmp') || p.startsWith('/tmp')) return
    count.set(p, (count.get(p) ?? 0) + weight)
  }
  for (const m of messages) {
    for (const u of m.toolUses) {
      const fp = u.input.file_path ?? u.input.notebook_path ?? u.input.path
      if (typeof fp === 'string' && fp.startsWith('/')) add(fp, u.tool === 'Read' ? 2 : 3)
      if (u.tool === 'Bash' && typeof u.input.command === 'string') {
        for (const hit of u.input.command.match(PATH_RE) ?? []) add(hit, 1)
      }
    }
  }
  // Checked at once; the order stays the ranking's.
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, FILE_CANDIDATES)
  const exists = await Promise.all(ranked.map(p => $.fs.exists(p).catch(() => false)))
  return ranked.filter((_, k) => exists[k]).slice(0, FILES_KEPT)
}

// Skills only: the fork sees its own transcript, so tool and MCP names would repeat it.
function gatherSkills(messages: SessionMessage[]) {
  const skills = new Set<string>()
  for (const m of messages) {
    for (const u of m.toolUses) {
      if (u.tool === 'Skill' && typeof u.input.skill === 'string') skills.add(`/${u.input.skill}`)
    }
  }
  return [...skills]
}

// Only links that name work the next session picks up: PRs, issues, tickets, wiki pages, artifacts.
const KEEP_LINK = /github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+|atlassian\.net\/(browse|wiki)\/|claude\.ai\/(code\/)?artifact\//

function gatherLinks(messages: SessionMessage[]) {
  const links = new Set<string>()
  for (const m of messages) {
    for (const hit of m.text.match(URL_RE) ?? []) {
      const url = hit.replace(/[.,:;]+$/, '')
      if (KEEP_LINK.test(url)) links.add(url)
    }
  }
  return [...links].slice(-10)
}

function forkPrompt(cwd: string, g: Gathered) {
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- none found')
  return `Write a handoff prompt for a fresh Claude Code session that continues this work. Do not call any tool. Reply with the prompt only: no preamble, no code fence around it.

The reader starts with an empty context. It can open files on this machine, but it cannot see this chat. It loads CLAUDE.md, AGENTS.md and its memory index by itself, so do not repeat those.

Facts the handoff mod checked on disk (the files exist; drop what the next step does not need):
Working directory: ${cwd}
Files read or changed, most used first:
${list(g.files.map(tilde))}
Skills used:
${list(g.skills)}
PR, ticket and artifact links:
${list(g.links)}

Use this shape in plain, short English. Leave out a section that has nothing in it. Every line must help the next step; say each thing once.

# Handoff: <the goal, in a few words>

Continue work in \`${tilde(cwd)}\`. Goal: <what the user is working toward right now>.

## Status
- **done** / **in progress** / **not started**: <a goal the user set, in their key words>: <the outcome, or what is left>.
One line per goal, in order; fold small asks into the goal they served. Then, in at most 4 lines: the key decisions and why, and what was tested and what was not.

## Rules from this chat
Only constraints the user gave in this chat that are not already in CLAUDE.md or memory: things never to do, approval steps, words to avoid.

## Files to open first
- \`<path>\`: why it matters, in one line. At most 8, only what the next step needs. Paths only; never copy file content.

## Skills and tools
- \`<skill, CLI or connector>\`: when to use it, and any trap found in this chat.

## Errors already solved
- <the error>: <the fix>. At most 5, only ones the next step could hit again.

## Carried-over data
Only data that exists nowhere on disk: ids, URLs, numbers and decisions that live only in this chat. Verbatim.

## Next steps
1. The very next action, specific enough to start without asking a question.

Never write an API key, token or password; write where it lives instead (for example "in ~/.zshrc"). Keep it under 900 words.`
}

// Anything shaped like a secret is cut out before the handoff is saved or copied.
function redact(text: string) {
  return text
    .replace(
      /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|(?:AKIA|ASIA)[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
      '<secret removed>',
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{20,}/g, '$1<secret removed>')
}

function slug(text: string) {
  const title = /^#\s*Handoff:\s*(.+)$/m.exec(text)?.[1] ?? 'session'
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'session'
  )
}

async function stamp($: EngineInterface) {
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

// Every run leaves a line here, so a failure is never silent.
async function log($: EngineInterface, line: string) {
  try {
    const path = `${home}/.claude/handoffs/handoff.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const at = new Date(await $.clock.now()).toISOString()
    const lines = old ? old.trimEnd().split('\n').slice(-400) : []
    lines.push(`${at} ${sid.slice(0, 8)} ${line}`)
    await $.fs.write(path, `${lines.join('\n')}\n`)
  } catch {
    // The log must never break a run.
  }
}

// A plain handoff built from the transcript alone, saved before the model step,
// so a failed or slow model call still leaves something to start from.
function draftText(cwd: string, g: Gathered) {
  const asks = g.messages
    .filter(m => m.role === 'user' && m.text.trim() && !m.text.trim().startsWith('<'))
    .slice(-25)
    .map(m => `- ${m.text.trim().replace(/\s+/g, ' ').slice(0, 300)}`)
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- none found')
  return `# Handoff draft (no model step)

Continue work in \`${tilde(cwd)}\`. This draft was saved before the model wrote the full handoff. Read the requests below, open the files, then ask the user what is next.

## What the user asked for (newest last)
${asks.join('\n') || '- none found'}

## Files to open first
${list(g.files.slice(0, 15).map(f => `\`${tilde(f)}\``))}

## Skills and tools used
${list(g.skills)}

## Links in the chat
${list(g.links)}
`
}

async function run($: EngineInterface) {
  if (busy) return
  busy = true
  let draftPath = ''
  const { context } = await $.session.usage()
  await setPanel($, { phase: 'working', tokens: context.tokens ?? 0, steps: freshSteps(), tick: 0, file: '', words: 0, error: '', note: '' })
  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => {
    void tick($).catch(() => undefined)
  })
  try {
    const cwd = await $.session.cwd()
    const g = await step(
      $,
      0,
      async (): Promise<Gathered> => {
        const messages = await $.session.messages()
        const tools = messages.reduce((n, m) => n + m.toolUses.length, 0)
        return { messages, tools, files: await gatherFiles($, messages), skills: gatherSkills(messages), links: gatherLinks(messages) }
      },
      v => [plural(v.messages.length, 'message'), plural(v.files.length, 'file'), plural(v.skills.length, 'skill')].join(' · '),
    )
    const { messages } = g
    draftPath = `${home}/.claude/handoffs/${await stamp($)}-draft.md`
    const draft = redact(draftText(cwd, g))
    await $.fs.write(draftPath, draft)
    handoffText = draft
    handoffPath = draftPath
    await log($, `start ${short(context.tokens ?? 0)} ${messages.length} messages, draft ${tilde(draftPath)}`)
    const reply = await step(
      $,
      WRITE,
      async () => {
        const r = await $.model.fork({ prompt: forkPrompt(cwd, g) })
        writeMs = (await $.clock.now()) - writeStartedAt
        return r
      },
      r => (r.isAnswered ? `${Math.round(writeMs / 1000)} s` : 'failed'),
    )
    if (!reply.isAnswered) {
      throw new Error(reply.reason === 'api-error' ? `the model call failed (${reply.status ?? '?'})` : `no handoff came back (${reply.reason})`)
    }
    const text = redact(reply.text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1'))
    const saved = await step(
      $,
      WRITE + 1,
      async () => {
        const path = `${home}/.claude/handoffs/${await stamp($)}-${slug(text)}.md`
        await $.fs.write(path, `${text}\n`)
        const back = String(await $.fs.read(path))
        if (back.trim() !== text) throw new Error('the saved file does not match')
        return path
      },
      p => tilde(p).split('/').pop() ?? '',
    )
    handoffText = text
    handoffPath = saved
    const words = text.split(/\s+/).length
    const p = await read($, panel)
    if (p) await setPanel($, { ...p, phase: 'ready', file: tilde(saved), words })
    if (sid) await $.store.set(`last:${sid}`, { path: saved })
    // What the fork cost: a large cache write means the cache had lapsed and the chat was billed afresh.
    const u = reply.usage
    await log(
      $,
      `ok ${tilde(saved)} ${words} words in ${Math.round(writeMs / 1000)} s · tokens out ${u?.output_tokens ?? 0}, in ${u?.input_tokens ?? 0}, cache read ${u?.cache_read_input_tokens ?? 0}, cache write ${u?.cache_creation_input_tokens ?? 0}`,
    )
    if (writeMs > NOTIFY_AFTER_MS) await $.ui.notify(`Handoff ready: ${words.toLocaleString('en-US')} words. Copy it or start a new chat.`, { title: 'Chat handoff' }).catch(() => undefined)
    // The full handoff replaces the draft.
    if (draftPath) await $.process.run(['rm', '-f', draftPath])
  } catch (err) {
    const p = await read($, panel)
    const steps = (p?.steps ?? freshSteps()).map((s, k) => (k === running && s.status === 'run' ? { ...s, status: 'fail' as const } : s))
    const why = String(err instanceof Error ? err.message : err).slice(0, 160)
    await setPanel($, {
      ...(p as Panel),
      steps,
      phase: 'failed',
      error: why,
      file: draftPath ? tilde(draftPath) : '',
      note: draftPath ? 'A basic draft is saved. Open it or copy it, or try again.' : '',
    })
    await log($, `failed at step ${running + 1}: ${why}`)
  } finally {
    ticker?.cancel()
    ticker = null
    running = -1
    busy = false
  }
}

// Transient confirmations go to a toast; the band keeps only what stays true.
const toast = ($: EngineInterface, text: string, timeoutMs = 4000) => {
  try {
    $.ui.toast(text, { timeoutMs })
  } catch {
    // No surface to draw on: nothing to tell.
  }
}

// The surface's own clipboard first; pbcopy when it reports nothing was copied.
async function copy($: EngineInterface, surface?: RenderSurface) {
  if (!handoffText) return
  const r = await $.ui.copy({ text: handoffText, surface }).catch(() => ({ isCopied: false as const }))
  const ok = r.isCopied || (await $.process.run(['pbcopy'], { stdin: handoffText })).exitCode === 0
  toast($, ok ? 'Copied. Paste it into a new chat.' : 'Copy failed. Use Preview or Open file instead.')
}

async function petAlive($: EngineInterface) {
  try {
    const j = JSON.parse(String(await $.fs.read(`${petDir}/pet.json`))) as { at?: number }
    return (await $.clock.now()) - (j.at ?? 0) < 10_000
  } catch {
    return false
  }
}

// Claude Pet starts the chat in the app and stays on it. Without the pet, the app's own
// link fills a new chat and you press Return.
async function startNew($: EngineInterface) {
  if (!handoffText) return
  const cwd = await $.session.cwd()
  if (await petAlive($)) {
    toast($, 'Starting the new chat…')
    const id = `handoff-${await $.clock.now()}`
    await $.fs.write(`${petDir}/requests/${id}.json`, JSON.stringify({ id, at: await $.clock.now(), action: 'newchat', text: handoffText, folder: cwd, stay: true }))
    const done = `${petDir}/requests/${id}.done`
    for (let k = 0; k < 120; k += 1) {
      await $.clock.sleep(500)
      if (await $.fs.exists(done)) {
        const answer = String(await $.fs.read(done)).trim()
        await $.process.run(['rm', '-f', done])
        toast($, answer)
        return
      }
    }
    toast($, 'Claude Pet did not answer. Use Copy instead.')
    return
  }
  const r = await $.process.run(['open', `claude://code/new?q=${encodeURIComponent(handoffText)}`])
  toast($, r.exitCode === 0 ? 'A new chat is filled in with the handoff. Press Return there to start it.' : 'The new chat did not open. Use Copy instead.', 8000)
}

async function checkOffer($: EngineInterface) {
  if (busy || off) return
  // Another mod asks for a handoff by leaving this file.
  const request = `${home}/.claude/handoffs/.request-${sid}`
  if (sid && (await $.fs.exists(request).catch(() => false))) {
    await $.process.run(['rm', '-f', request])
    await log($, 'asked by another mod')
    void run($).catch(() => undefined)
    return
  }
  const p = await read($, panel)
  if (p && p.phase !== 'offer') return
  // An offer asked for by /chat-refresh stays until it is answered.
  if (forced && p) return
  forced = false
  if (hidden) {
    if (p) await setPanel($, null)
    return
  }
  const { context } = await $.session.usage()
  const tokens = context.tokens ?? 0
  // A compaction or /clear brings the count down: the offer starts over.
  if (tokens < offerAt && snoozedTo > offerAt) {
    snoozedTo = offerAt
    if (sid) await $.store.set(`snooze:${sid}`, snoozedTo)
  }
  if (tokens >= snoozedTo) {
    if (!p || Math.abs(p.tokens - tokens) >= 1000) {
      await setPanel($, { phase: 'offer', tokens, steps: freshSteps(), tick: 0, file: '', words: 0, error: '', note: '' })
    }
  } else if (p) {
    await setPanel($, null)
  }
}

// Closing counts as an answer up to here: the offer waits for a snooze's worth of more tokens.
async function close($: EngineInterface) {
  const p = await read($, panel)
  if (p) {
    forced = false
    snoozedTo = Math.max(snoozedTo, p.tokens + Math.round(offerAt * SNOOZE_SHARE))
    if (sid) await $.store.set(`snooze:${sid}`, snoozedTo)
  }
  await setPanel($, null)
}

/** A colour between `a` and `b`, both #rrggbb; `t` from 0 to 1. */
function mix(a: string, b: string, t: number): string {
  const at = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(at(a, i) + (at(b, i) - at(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

// Cell k of a bar takes its colour from where it sits, so the gradient stays put as the fill grows.
const cellColor = (k: number) => (k < BAR / 2 ? mix(O_DEEP, O_MID, k / (BAR / 2)) : mix(O_MID, O_LIGHT, (k - BAR / 2) / (BAR / 2 - 1)))

/** The terminal bar: gradient blocks, a blinking tip while it runs, a dim track. Red blocks when it failed. */
function barCells(progress: number, status: Step['status'], tick: number) {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * BAR)
  const tip = status === 'run' && filled < BAR ? 1 : 0
  return { filled, tip, track: BAR - filled - tip, failed: status === 'fail', tipColor: tick % 2 ? O_MID : O_LIGHT }
}

/**
 * The desktop bar, one drawing: a rounded track, the orange-to-yellow fill, and a shine that
 * sweeps the fill. The shine moves by the tick, not a CSS animation, so a redraw never restarts it.
 */
function barSvg(progress: number, status: Step['status'], tick: number): string {
  const fill = Math.round(SVG_W * Math.max(0, Math.min(1, progress)))
  const failed = status === 'fail'
  const sweep = fill > 0 ? ((tick * SHINE_STEP) % (fill + SHINE_W)) - SHINE_W : -SHINE_W
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
<style>.k{fill:#f4ece2}@media (prefers-color-scheme: dark){.k{fill:#3b2f25}}</style>
<defs>
<linearGradient id="ch-g" gradientUnits="userSpaceOnUse" x1="0" x2="${SVG_W}"><stop offset="0" stop-color="${O_DEEP}"/><stop offset=".55" stop-color="${O_MID}"/><stop offset="1" stop-color="${O_LIGHT}"/></linearGradient>
<linearGradient id="ch-s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="ch-c"><rect width="${SVG_W}" height="${SVG_H}" rx="${SVG_H / 2}"/></clipPath>
<clipPath id="ch-f"><rect width="${fill}" height="${SVG_H}"/></clipPath>
</defs>
<g clip-path="url(#ch-c)">
<rect class="k" width="${SVG_W}" height="${SVG_H}"/>
<rect width="${fill}" height="${SVG_H}" fill="${failed ? BAD_HEX : 'url(#ch-g)'}"/>
${!failed && fill > 0 ? `<g clip-path="url(#ch-f)"><rect x="${sweep}" width="${SHINE_W}" height="${SVG_H}" fill="url(#ch-s)"/></g>` : ''}
</g>
</svg>`
}

export const register: Register = (on, options) => {
  const chosen = Number(options.offerAtTokens)
  offerAt = chosen > 0 ? chosen : DEFAULT_OFFER_AT
  snoozedTo = offerAt

  on('session.start', async ($, e, next) => {
    sid = await $.session.id()
    home = (await $.env.get('HOME')) ?? ''
    petDir = `${home}/.claude/pet`
    await readSwitch($)
    $.clock.every(SWITCH_MS, () => {
      void readSwitch($).catch(() => undefined)
    })
    await $.command.register({ name: 'chat-handoff', description: 'Write a handoff of this chat now, then copy it or start a new chat with it' })
    await $.command.register({ name: 'chat-refresh', description: 'Show the Refresh panel now, to move this work to a fresh chat', immediate: true })
    await $.tool.register({
      name: 'refresh',
      description:
        'Open the Refresh panel above the prompt: it writes a handoff of this whole chat (what was asked, done, decided, files to open, next steps) and offers Copy and Start new chat. Use when the user asks to refresh, hand off, or move this work to a new chat. It starts when your turn ends.',
      inputSchema: { type: 'object', properties: {} },
    })
    const saved = await $.store.get(`snooze:${sid}`)
    // A snooze saved under a lower threshold must not open the offer below a threshold raised since.
    if (typeof saved === 'number') snoozedTo = Math.max(saved, offerAt)
    try {
      const last = (await $.store.get(`last:${sid}`)) as { path?: string } | undefined
      if (last?.path && (await $.fs.exists(last.path))) {
        handoffPath = last.path
        handoffText = String(await $.fs.read(last.path)).trim()
      }
    } catch {
      // No earlier handoff for this chat.
    }
    // A reload while the steps ran leaves a dead "working" band behind.
    const p = await read($, panel)
    if (p && p.phase === 'working') await setPanel($, null)
    $.clock.every(POLL_MS, () => {
      void checkOffer($).catch(() => undefined)
    })
    void checkOffer($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (off) return next(e)
    const result = await next(e)
    if (pending) {
      pending = false
      void run($).catch(() => undefined)
    } else {
      void checkOffer($).catch(() => undefined)
    }
    return result
  })

  on('command.run', { command: 'chat-refresh' }, async $ => {
    if (off) return { text: 'Chat Handoff is off. Turn it on with /chat-handoff on.' }
    await showOffer($)
    return { text: 'Refresh panel shown above the prompt. Press Later on it to snooze it.' }
  })

  on('command.run', { command: 'chat-handoff' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'status') return { text: `Chat Handoff is ${off ? 'off' : 'on'}.` }
    if (arg === 'on' || arg === 'off') {
      if (!(await writeSwitch($, arg === 'on'))) return { text: 'Chat Handoff: could not write ~/.claude/mods/switches.json, so nothing changed.' }
      await readSwitch($)
      return { text: arg === 'on' ? 'Chat Handoff is on.' : 'Chat Handoff is off in every chat. Type /chat-handoff on to turn it on again.' }
    }
    if (off) return { text: 'Chat Handoff is off. Turn it on with /chat-handoff on.' }
    void run($).catch(() => undefined)
    return { text: 'Writing the handoff. Watch the panel above the prompt.' }
  })

  // One unfiltered hook: a typed tool matcher makes tsc recurse through the connector types.
  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) !== 'mcp__chat-handoff__refresh') return next(e)
    if (!off) pending = true
    const said = off
      ? 'Chat Handoff is off. Tell the user to turn it on with /chat-handoff on.'
      : 'The Refresh panel opens above the prompt when this turn ends. Tell the user in one short line, then end your turn.'
    return { result: said } as never
  }).catch(($, e, next) => next(e))

  // Presses go to these hooks, not to onPress: a closure lives one drawing, and the
  // band redraws ten times a second while the steps run.
  on('ui.press', { plugin: 'chat-handoff', element: 'refresh' }, async ($, e) => {
    void run($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'chat-handoff', element: 'retry' }, async ($, e) => {
    void run($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'chat-handoff', element: 'copy' }, async ($, e) => {
    await copy($, e.surface)
    return { element: e.element }
  })
  // A press counts as asked, so the pane opens at any width.
  on('ui.press', { plugin: 'chat-handoff', element: 'preview' }, async ($, e) => {
    if (handoffText) await $.ui.open({ id: PANE, title: 'Handoff preview', focus: true, closeOnEscape: true })
    return { element: e.element }
  })
  on('ui.press', { plugin: 'chat-handoff', element: 'pclose' }, async ($, e) => {
    await $.ui.close({ id: PANE })
    return { element: e.element }
  })
  on('ui.press', { plugin: 'chat-handoff', element: 'start' }, async ($, e) => {
    void startNew($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'chat-handoff', element: 'open' }, async ($, e) => {
    if (handoffPath) await $.process.run(['open', handoffPath])
    return { element: e.element }
  })
  on('ui.press', { plugin: 'chat-handoff', element: 'close' }, async ($, e) => {
    await close($)
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off) return next(e)
    const p = await read($, panel)
    if (!p || e.props.hasSurvey) return next(e)
    // The offer waits out a running turn; the steps and the result do not.
    if (p.phase === 'offer' && e.props.isWorking) return next(e)
    const rest = await next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // The desktop draws the bars as SVG; the terminal as gradient blocks.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const noop = () => undefined

    // One hierarchy in every state: one primary (chrome, the focus, a hotkey), at most one secondary (chrome),
    // the rest plain and dim with a hotkey, and a dismiss. `plain` wins over `variant`, so the first two never take it.
    if (p.phase === 'offer') {
      return (
        <Box flexDirection="column" rowGap="sm">
          {rest}
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Text wrap="truncate-end">
              <Text color={ACCENT}>●</Text>
              <Text tabular> {short(p.tokens)} context</Text>
              <Text dimColor> · Hand off to a fresh chat before auto-compact</Text>
            </Text>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              <Button key="refresh" label="Refresh chat" variant="primary" hotkey="r" autoFocus onPress={noop} />
              <Button plain dimColor role="dismiss" key="close" hotkey="l" label="Later" onPress={noop} />
            </Box>
          </Box>
        </Box>
      )
    }

    if (p.phase === 'ready') {
      const wrote = p.steps[WRITE]?.detail
      const facts = [`${p.words.toLocaleString('en-US')} words`, p.steps[0]?.detail, wrote ? `written in ${wrote}` : '']
        .filter(Boolean)
        .join(' · ')
      return (
        <Box flexDirection="column" rowGap="sm">
          {rest}
          {/* Step names add room on desktop only: down, xs and sm are 0 rows on the terminal. */}
          <Box flexDirection="column" rowGap="sm" paddingBottom="xs">
            <Box flexDirection="column">
              <Box flexDirection="row" alignItems="center" gap={1}>
                <Text color={GOOD}>✓</Text>
                <Text size="heading" weight="semibold">
                  Handoff ready
                </Text>
                <Text dimColor tabular wrap="truncate-end">
                  {facts}
                </Text>
              </Box>
              <Box paddingLeft={2}>
                <Text dimColor size="footnote" wrap="truncate-middle">
                  {p.file}
                </Text>
              </Box>
            </Box>
            <Box flexDirection="row" gap={1} paddingLeft={2}>
              <Button key="copy" label="Copy handoff" variant="primary" hotkey="c" autoFocus onPress={noop} />
              <Button key="start" label="New chat" variant="secondary" hotkey="n" onPress={noop} />
              <Button plain dimColor key="preview" hotkey="p" label="Preview" onPress={noop} />
              <Button plain dimColor key="open" hotkey="o" label="Open file" onPress={noop} />
              <Button plain dimColor role="dismiss" key="close" hotkey="x" label="Close" onPress={noop} />
            </Box>
          </Box>
        </Box>
      )
    }

    // Working or failed: one row per step; only the running (or failed) step carries a bar.
    const failed = p.phase === 'failed'
    const rows = p.steps.map((s, i) => {
      const icon =
        s.status === 'done' ? (
          <Text color={GOOD}>✓</Text>
        ) : s.status === 'fail' ? (
          <Text color={BAD}>✗</Text>
        ) : s.status === 'run' ? (
          <Text color={ACCENT}>{SPIN[p.tick % SPIN.length]}</Text>
        ) : (
          <Text dimColor>○</Text>
        )
      const hasBar = s.status === 'run' || s.status === 'fail'
      const c = barCells(s.progress, s.status, p.tick)
      const drawn = !hasBar ? null : Svg ? (
        <Svg key={`bar${i}`} source={barSvg(s.progress, s.status, p.tick)} alt={`${s.label}: ${Math.round(s.progress * 100)}%`} width={SVG_W} height={SVG_H} />
      ) : (
        <Text key={`bar${i}`}>
          {Array.from({ length: c.filled }, (_, k) => (
            <Text key={`c${k}`} color={c.failed ? BAD : cellColor(k)}>
              █
            </Text>
          ))}
          {c.tip ? <Text color={c.tipColor}>▓</Text> : null}
          <Text dimColor>{'░'.repeat(c.track)}</Text>
        </Text>
      )
      return (
        <Box key={`row${i}`} flexDirection="row" alignItems="center" gap={1}>
          <Box width={2}>{icon}</Box>
          <Box width={32}>
            <Text dimColor={s.status === 'wait'} wrap="truncate-end">
              {s.label}
            </Text>
          </Box>
          {drawn}
          <Text dimColor tabular wrap="truncate-end">
            {s.detail}
          </Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column" rowGap="sm">
        {rest}
        <Box flexDirection="column" rowGap="sm" paddingBottom="xs">
          <Text size="heading" weight="semibold" color={failed ? BAD : ACCENT}>
            {failed ? 'The handoff did not finish' : 'Building your handoff'}
          </Text>
          <Box flexDirection="column" rowGap="xs">
            {rows}
          </Box>
          {failed ? (
            <Box flexDirection="column" rowGap="xs" paddingLeft={2}>
              <Text color={BAD}>{p.error}</Text>
              {p.file ? (
                <Text dimColor wrap="truncate-middle">
                  Draft saved to {p.file}
                </Text>
              ) : null}
              {p.note ? <Text dimColor>{p.note}</Text> : null}
              <Box flexDirection="row" gap={1}>
                <Button key="retry" label="Try again" variant="primary" hotkey="t" autoFocus onPress={noop} />
                {p.file ? <Button key="copy" label="Copy draft" variant="secondary" hotkey="c" onPress={noop} /> : null}
                {p.file ? <Button plain dimColor key="preview" hotkey="p" label="Preview draft" onPress={noop} /> : null}
                {p.file ? <Button plain dimColor key="open" hotkey="o" label="Open draft" onPress={noop} /> : null}
                <Button plain dimColor role="dismiss" key="close" hotkey="x" label="Close" onPress={noop} />
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>
    )
  })

  // The handoff drawn as markdown, with the same actions as the band.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const noop = () => undefined
    return (
      <Box flexDirection="column" rowGap="sm">
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Text dimColor wrap="truncate-middle">
            {tilde(handoffPath)}
          </Text>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            <Button key="copy" label="Copy handoff" variant="primary" hotkey="c" autoFocus onPress={noop} />
            <Button key="start" label="New chat" variant="secondary" hotkey="n" onPress={noop} />
            <Button plain dimColor key="open" hotkey="o" label="Open file" onPress={noop} />
            <Button plain dimColor role="dismiss" key="pclose" hotkey="x" label="Close" onPress={noop} />
          </Box>
        </Box>
        {handoffText ? <Markdown key="handoff" text={handoffText} /> : <Text dimColor>No handoff yet.</Text>}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { Clock, Warm } from '../types'

const clock = atom({ plugin: 'cache-timer', key: 'clock' } as const, null)
const warm = atom({ plugin: 'cache-timer', key: 'warm' } as const, null)
const isHidden = atom({ plugin: 'cache-timer', key: 'isHidden' } as const, false)
const armed = atom({ plugin: 'cache-timer', key: 'armed' } as const, null)
const invalid = atom({ plugin: 'cache-timer', key: 'invalid' } as const, null)

const FIVE_MIN = 5 * 60_000
const ONE_HOUR = 60 * 60_000

// Keep warm: one small background ping this long before the cache would go cold.
// $.model.fork repeats the main thread's last request with this one line after it,
// so the API reads the chat from its cache and the timer starts again. It never
// writes the transcript.
const LEAD = 45_000
const MAX_PINGS = 30
const MAX_MS = 2 * 60 * 60_000
const MAX_FAILS = 3
const RETRY_MS = 20_000
const PING_PROMPT = 'Reply with the single word: ok'
// The cold band's "Rewarm now" writes the whole chat to the cache again, so it takes a second press within this long.
const ARM_MS = 8000
// Turns that are not the person typing: they do not count as "they are back".
const BACKGROUND = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation'])

// Theme keys for the band's text lines, so they follow the person's theme (light, dark, custom).
const BAD = 'error'
const COLD = 'suggestion'

// The countdown bar is three blocks, as plan-bar draws one block per step. Left to right they are the
// last third of the cache life, the middle third and the first third, and the bar drains from the right.
// The palette is the third the countdown is in, drawn as one gradient across every block still in play,
// as if they were a single block: in the first third greens only across all three, in the middle third
// orange to yellow across the first two (the third is empty), in the last third dark red to orange in the first.
type Palette = readonly [left: string, mid: string, right: string]
export const PALETTES: readonly [Palette, Palette, Palette] = [
  ['#991b1b', '#ef4444', '#f97316'],
  ['#f97316', '#f59e0b', '#facc15'],
  ['#16a34a', '#4ade80', '#86efac'],
]
/** Which third the countdown is in, as a block index: 2 for the first third of the life (most left), 0 for the last. */
export const tierOf = (share: number) => (share > 2 / 3 ? 2 : share > 1 / 3 ? 1 : 0)
/** The label's colour, a strong one of the third the countdown is in: the palette's pale ends do not read as text. */
export const labelColor = (share: number) => (share > 2 / 3 ? '#16a34a' : share > 1 / 3 ? '#ea580c' : '#991b1b')

/** A colour between `a` and `b`, both #rrggbb; `t` from 0 to 1. The same blend as plan-bar's. */
function mix(a: string, b: string, t: number): string {
  const at = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(at(a, i) + (at(b, i) - at(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

/** The palette's colour at `t` (0 left, 1 right), through its middle stop at 0.55, as plan-bar's gradient stops. */
const shade = (p: Palette, t: number) => (t <= 0.55 ? mix(p[0], p[1], t / 0.55) : mix(p[1], p[2], (t - 0.55) / 0.45))

/** How many of `room` cells each of the three blocks gets (the cells between the blocks are not counted). */
export const blockLens = (room: number): [number, number, number] => [Math.round(room / 3), Math.round((room * 2) / 3) - Math.round(room / 3), room - Math.round((room * 2) / 3)]

/** The colour of cell `k` (0 is the far left) of a bar of `room` cells while `share` of the cache life is left:
 * the palette of the third the countdown is in, spread over the blocks up to that third as one gradient. */
export function cellColor(room: number, k: number, share: number): string {
  const tier = tierOf(share)
  const lens = blockLens(room)
  const span = lens.slice(0, tier + 1).reduce((a, b) => a + b, 0)
  const p = PALETTES[tier] ?? PALETTES[0]
  return shade(p, span > 1 ? Math.min(1, k / (span - 1)) : 0.5)
}

const SVG_H = 14
const SVG_GAP = 3
/** The desktop bar: three rounded blocks filled left to right as far as the cache life left, under one gradient
 * that spans the blocks up to the third the countdown is in. */
function barSvg(share: number, px: number): string {
  const segW = (px - SVG_GAP * 2) / 3
  // At least a sliver stays filled while any life is left.
  const filled = Math.max(2, share * segW * 3)
  const x = (j: number) => Math.round(j * (segW + SVG_GAP) * 10) / 10
  const tier = tierOf(share)
  const p = PALETTES[tier] ?? PALETTES[0]
  const end = x(tier) + Math.round(segW * 10) / 10
  const defs = `<linearGradient id="ct-g" gradientUnits="userSpaceOnUse" x1="0" x2="${end}"><stop offset="0" stop-color="${p[0]}"/><stop offset=".55" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient>`
  const segs = [0, 1, 2].map(j => {
    const w = Math.max(0, Math.min(segW, filled - j * segW))
    const rect = (width: number, extra: string) => `<rect x="${x(j)}" width="${Math.round(width * 10) / 10}" height="${SVG_H}" rx="2.5" ${extra}/>`
    return rect(segW, 'class="k"') + (w > 0 ? rect(w, 'fill="url(#ct-g)"') : '')
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${SVG_H}" viewBox="0 0 ${px} ${SVG_H}">
<style>.k{fill:#ece9fb}@media (prefers-color-scheme: dark){.k{fill:#2a2640}}</style>
<defs>${defs}</defs>
${segs}
</svg>`
}

// Band layout by the cells it has (`bodyColumns`): the bar shrinks, then the details go, then the bar.
const BAR_WIDE = 20
const BAR_SHORT = 10
const COLS_WIDE = 96
const COLS_DETAIL = 84
const COLS_BAR = 56
// The band's rounded frame: a border and two columns of padding on each side.
const FRAME_COLS = 6

// Module variables start over on a reload; the clock itself lives in the atoms.
let ttlMs = FIVE_MIN
let ttlKnown = false
let working = false
let pinging = false
// When the person's current (or last) main-chat turn started; 0 before the first one this load.
let sentAt = 0

// ~/.claude/mods/switches.json: "cache-timer": false turns this mod off, which /cache-timer on|off
// writes; "cache-timer:hidden": true hides the band (set by hand). Read every 3 s.
const SWITCH_MS = 3000
let switchOff = false
let switchHidden = false

const short = (tokens: number) => `${Math.round(tokens / 1000)}k`
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const hm = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`
}

const lengthLabel = (c: Clock) => (c.known ? (c.ttlMs === ONE_HOUR ? '1 hour cache' : '5 min cache') : '5 min cache (guess)')

function say($: EngineInterface, text: string) {
  try {
    $.ui.toast(text)
  } catch {
    // The toast is only a hint.
  }
}

// shortcut: $.fs.read has no partial read, so a transcript over this size is not read and the
// length stays a guess; upgrade when the API can read a file's tail.
const MAX_TRANSCRIPT = 20_000_000

type Reply = {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number; cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } } }
}

// Reads transcript lines newest first and answers from the first main-thread reply that wrote to the cache.
export function ttlOf(transcript: string): '1h' | '5m' | 'unknown' {
  const lines = transcript.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let reply: Reply
    try {
      reply = JSON.parse(lines[i] ?? '') as Reply
    } catch {
      continue
    }
    if (reply.type !== 'assistant' || reply.isSidechain) continue
    const cc = reply.message?.usage?.cache_creation
    if ((cc?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
    if ((cc?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  }
  return 'unknown'
}

export type Usage = { read: number; write: number }

// The cache read and write of the first main-thread reply recorded at or after `since` (epoch ms): the request
// that met the cache as the turn found it. Later requests of the same turn read what that one wrote.
export function firstReplySince(transcript: string, since: number): Usage | null {
  const lines = transcript.split('\n')
  let first: Usage | null = null
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let reply: Reply
    try {
      reply = JSON.parse(lines[i] ?? '') as Reply
    } catch {
      continue
    }
    if (reply.type !== 'assistant' || reply.isSidechain || !reply.timestamp) continue
    const at = Date.parse(reply.timestamp)
    if (Number.isNaN(at)) continue
    if (at < since) break
    const u = reply.message?.usage
    first = { read: u?.cache_read_input_tokens ?? 0, write: u?.cache_creation_input_tokens ?? 0 }
  }
  return first
}

// A turn's first request should read what the last reply cached. One that wrote more than it read, at least
// REWRITE_MIN, and read under half of what was cached found the cache reset (a model switch, a compaction)
// while the countdown still said warm. A cache that had already lapsed is the cold band's case, not this one.
export const REWRITE_MIN = 10_000
export function rewroteWarm(prev: Clock | null, sentAt: number, u: Usage | null): number {
  if (!prev || !u || !sentAt) return 0
  if (sentAt - prev.lastEnd >= prev.ttlMs) return 0
  return u.write > u.read && u.write >= REWRITE_MIN && u.read < prev.tokens / 2 ? u.write : 0
}

// The transcript's path for one session id: it never moves, so the folder search runs once per id (a /clear gives a new id).
let found = { id: '', path: '' }

async function transcriptPath($: EngineInterface, id: string) {
  if (found.id === id) return found.path
  const projects = `${(await $.env.get('HOME')) ?? ''}/.claude/projects`
  for (const dir of await $.fs.list(projects)) {
    if (dir.kind !== 'dir') continue
    const path = `${projects}/${dir.name}/${id}.jsonl`
    const file = await $.fs.stat(path).catch(() => null)
    if (file?.kind === 'file') {
      found = { id, path }
      return path
    }
  }
  return ''
}

// This chat's transcript, ~/.claude/projects/<project>/<session id>.jsonl; null when it is missing, unreadable or too big.
async function readTranscript($: EngineInterface): Promise<string | null> {
  const id = await $.session.id()
  // The id becomes part of a path, so only a plain session id is accepted.
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return null
  const path = await transcriptPath($, id)
  if (!path) return null
  const file = await $.fs.stat(path).catch(() => null)
  if (!file) {
    found = { id: '', path: '' }
    return null
  }
  if (file.size > MAX_TRANSCRIPT) return null
  return String(await $.fs.read(path))
}

// Learns which cache length this chat's replies were written with. No answer leaves the last known length as it is.
function learnTtl(transcript: string) {
  const out = ttlOf(transcript)
  if (out === 'unknown') return
  ttlMs = out === '1h' ? ONE_HOUR : FIVE_MIN
  ttlKnown = true
}

async function detect($: EngineInterface) {
  const text = await readTranscript($)
  if (text !== null) learnTtl(text)
}

// Reads the shared switches. A missing or broken file means nothing is switched.
async function pollSwitches($: EngineInterface) {
  let json: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(String(await $.fs.read(`${(await $.env.get('HOME')) ?? ''}/.claude/mods/switches.json`))) as unknown
    if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
  } catch {
    // No file yet, or not JSON: both switches stay as they are by default.
  }
  const off = json['cache-timer'] === false
  const hidden = json['cache-timer:hidden'] === true
  if (off === switchOff && hidden === switchHidden) return
  switchOff = off
  switchHidden = hidden
  if (off) await stopWarm($, 'Keep warm stopped: Cache Timer was switched off.')
  $.ui.invalidate('ui.render')
}

// Turns the mod on or off in every chat: "cache-timer": false in the shared switches file is off, and on removes the
// key. False when the file cannot be written.
async function writeSwitch($: EngineInterface, on: boolean): Promise<boolean> {
  try {
    const path = `${(await $.env.get('HOME')) ?? ''}/.claude/mods/switches.json`
    let json: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(String(await $.fs.read(path))) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
    } catch {
      // No file yet, or not JSON: it starts from empty.
    }
    if (on) delete json['cache-timer']
    else json['cache-timer'] = false
    await $.fs.write(path, `${JSON.stringify(json, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

// A main-chat reply just ended: the cache is warm again from now. The transcript also says whether the turn's
// first request found the cache reset while the band still showed it warm: a reset whose hook never arrived
// (another plugin ahead in the chain can keep classic.* events from reaching this one) still shows, after the fact.
async function restart($: EngineInterface) {
  const now = await $.clock.now()
  const { context } = await $.session.usage()
  const prev = await read($, clock)
  const text = await readTranscript($).catch(() => null)
  if (text !== null) learnTtl(text)
  const rewrote = text !== null ? rewroteWarm(prev, sentAt, firstReplySince(text, sentAt)) : 0
  await update($, armed, () => null)
  // A completed main-chat turn wrote the cache afresh, whatever reset it before.
  await update($, invalid, () => null)
  await update($, clock, () => ({ lastEnd: now, ttlMs, known: ttlKnown, tokens: context.tokens ?? 0, now, rewrote }))
}

// Something reset the cache before its time ran out (a model switch, a compaction): the countdown
// no longer says what the next request pays, and a keep warm ping on the old schedule would write the
// whole chat unasked. The band says so until a main-chat turn completes.
async function invalidate($: EngineInterface, why: string, tokens: number | null) {
  if (!(await read($, clock))) return
  await update($, armed, () => null)
  await update($, invalid, () => ({ why, tokens }))
  await stopWarm($, `Keep warm stopped: the cache was reset by ${why}.`)
}

const modelName = (id: string) => id.replace(/^claude-/, '')

// Once a second: moves the countdown. A cold clock only needs a redraw once a minute.
// Keep warm's chip shows while the band is hidden, so the clock keeps moving for it.
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const a = await read($, armed)
  if (a !== null && now >= a) await update($, armed, () => null)
  const c = await read($, clock)
  if (!c) return
  // A reset cache has no countdown to move.
  if (await read($, invalid)) return
  if (!(await read($, warm)) && (switchHidden || (await read($, isHidden)))) return
  if (c.now - c.lastEnd >= c.ttlMs && Math.floor((now - c.lastEnd) / 60_000) === Math.floor((c.now - c.lastEnd) / 60_000)) return
  await update($, clock, cur => (cur ? { ...cur, now } : cur))
}

// Turns keep warm on. 'none' when there is no reply yet whose cache could be kept; 'cold' when the
// cache already lapsed, as the first ping would then write the whole chat again (`force` does it anyway).
async function startWarm($: EngineInterface, force = false): Promise<'started' | 'none' | 'cold'> {
  const c = await read($, clock)
  if (!c) return 'none'
  const startedAt = await $.clock.now()
  const reset = (await read($, invalid)) !== null
  if (!force && (reset || startedAt - c.lastEnd >= c.ttlMs)) return 'cold'
  if (reset) {
    // Rewarming a reset cache: put the clock where a lapsed cache has it, so the first ping goes out at once.
    await update($, invalid, () => null)
    await update($, clock, cur => (cur ? { ...cur, lastEnd: startedAt - cur.ttlMs, now: startedAt } : cur))
  }
  await update($, armed, () => null)
  await update($, warm, () => ({ startedAt, pings: 0, read: 0, write: 0, cold: false, error: '', sending: false, failures: 0, retryAt: 0, totalRead: 0, totalWrite: 0 }))
  return 'started'
}

async function stopWarm($: EngineInterface, why: string) {
  if (!(await read($, warm))) return
  await update($, warm, () => null)
  say($, why)
}

const NOTHING_YET = "Nothing to keep warm yet. It works after Claude's first reply."

async function toggleWarm($: EngineInterface) {
  if (await read($, warm)) return stopWarm($, 'Keep warm is off.')
  const r = await startWarm($)
  say($, r === 'started' ? 'Keep warm is on. Type /cache-timer warm again to stop it.' : r === 'cold' ? 'The cache just went cold. Use Rewarm now to write it again.' : NOTHING_YET)
}

// The cold band's button: the first press arms it, a second press within ARM_MS rewarms.
async function rewarm($: EngineInterface) {
  const now = await $.clock.now()
  const a = await read($, armed)
  if (a === null || now >= a) {
    await update($, armed, () => now + ARM_MS)
    return
  }
  const r = await startWarm($, true)
  say($, r === 'started' ? 'Rewarming: the first ping writes the chat to the cache again, then keep warm holds it.' : NOTHING_YET)
}

async function hide($: EngineInterface) {
  await update($, isHidden, () => true)
  say($, (await read($, warm)) ? 'Cache Timer hidden. Keep warm is still on, so its one-line chip stays. Type /cache-timer on to show the timer.' : 'Cache Timer hidden. Type /cache-timer on to show it again.')
}

// Once a second: sends the ping when the cache is LEAD from going cold, and keeps the caps.
async function warmTick($: EngineInterface) {
  const w = await read($, warm)
  if (!w || pinging || working || switchOff) return
  const now = await $.clock.now()
  if (now - w.startedAt >= MAX_MS) return stopWarm($, 'Keep warm stopped after 2 hours. Type /cache-timer warm to start it again.')
  if (w.pings >= MAX_PINGS) return stopWarm($, `Keep warm stopped after ${MAX_PINGS} pings. Type /cache-timer warm to start it again.`)
  if (now < w.retryAt) return
  const c = await read($, clock)
  if (!c || c.lastEnd + c.ttlMs - now > LEAD) return
  pinging = true
  void ping($, w, now).catch(() => {
    pinging = false
  })
}

async function ping($: EngineInterface, w: Warm, start: number) {
  await update($, warm, cur => (cur ? { ...cur, sending: true } : cur))
  let r: ModelForkResult | null = null
  try {
    r = await $.model.fork({ prompt: PING_PROMPT })
  } catch {
    // Counted as a failed ping below.
  }
  pinging = false
  if (r && !r.isAnswered && r.reason === 'nothing-to-fork') return stopWarm($, 'Keep warm stopped: there is no reply to keep warm yet.')
  const usage = r && 'usage' in r ? r.usage : null
  const cacheRead = usage?.cache_read_input_tokens ?? 0
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0
  // An answer, or a reply with no words, still read the chat: the cache timer restarted.
  const ok = r !== null && (r.isAnswered || r.reason === 'empty-reply')
  const error = ok ? '' : r && !r.isAnswered ? (r.reason === 'api-error' ? `${r.error}${r.status ? ` ${r.status}` : ''}` : r.reason) : 'error'
  const now = await $.clock.now()
  if (ok) {
    const n = w.pings + 1
    await update($, warm, cur =>
      cur
        ? { ...cur, pings: n, read: cacheRead, write: cacheWrite, cold: cacheWrite > cacheRead, error: '', sending: false, failures: 0, retryAt: 0, totalRead: (cur.totalRead ?? 0) + cacheRead, totalWrite: (cur.totalWrite ?? 0) + cacheWrite }
        : cur,
    )
    await update($, clock, cur => (cur ? { ...cur, lastEnd: Math.max(cur.lastEnd, start), now } : cur))
    if (n >= MAX_PINGS) await stopWarm($, `Keep warm stopped after ${MAX_PINGS} pings. Type /cache-timer warm to start it again.`)
    return
  }
  // A failed ping did not reach the cache, so it does not count toward MAX_PINGS; MAX_FAILS bounds the retries.
  await update($, warm, cur => (cur ? { ...cur, error, sending: false, failures: cur.failures + 1, retryAt: now + RETRY_MS } : cur))
  const after = await read($, warm)
  if (after && after.failures >= MAX_FAILS) await stopWarm($, `Keep warm stopped: ${MAX_FAILS} pings in a row failed (${error}).`)
}

// Where keep warm is in its cycle: shared by the band's keep-warm line and the hidden-band chip.
function pingStatus(w: Warm, left: number): string {
  if (w.sending) return `sending ping ${w.pings + 1}`
  if (w.pings === 0) return left > LEAD ? `first ping in ${mmss(left - LEAD)}` : 'first ping now'
  return `ping ${w.pings}/${MAX_PINGS} · next in ${mmss(left - LEAD)}`
}

function warmLine(w: Warm, left: number, now: number): string {
  const parts = ['Keeping warm', pingStatus(w, left)]
  if (w.error) parts.push(`last ping failed (${w.error}), retrying`)
  else if (w.pings > 0 && w.cold) parts.push(`the cache had gone cold, so ping ${w.pings} wrote ${short(w.write)} tokens to it again`)
  else if (w.pings > 0) parts.push(`last ping read ${short(w.read)} cached tokens`)
  if (w.pings > 1) parts.push(`${short(w.totalRead ?? 0)} read in all`)
  parts.push(`stops in ${hm(MAX_MS - (now - w.startedAt))}`)
  return parts.join(' · ')
}

// /cache-timer warm: starts keep warm, or stops it when it runs. A cold cache is not rewarmed from here, since that
// writes the whole chat again: the cold band's Rewarm now button does it, with a confirming second press.
async function warmCommand($: EngineInterface) {
  if ((await read($, warm)) !== null) {
    await update($, warm, () => null)
    return { text: 'Keep warm is off. Type /cache-timer warm to start it again.' }
  }
  const r = await startWarm($, false)
  if (r === 'none') return { text: NOTHING_YET }
  if (r === 'cold') {
    const c = await read($, clock)
    return {
      text: `The cache is already cold, so the first ping would write all ${short(c?.tokens ?? 0)} tokens to it again, at the cache-write price. Press Rewarm now on the band to do that anyway, or just send your next message.`,
    }
  }
  return { text: 'Keep warm is on: one small background ping about 45 s before the cache goes cold, so the chat is read from the cache instead of written again. It stops after 2 hours, 30 pings, or when you send a message. Type /cache-timer warm again to stop it.' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache-timer',
      description: 'Cache Timer: "on" or "off" switches the mod in every chat; "warm" starts or stops keep warm, a small ping 45 s before the cache goes cold; no word says whether each is on',
      argumentHint: '[on|off|warm]',
      immediate: true,
    })
    $.clock.every(1000, () => {
      void tick($).catch(() => undefined)
      void warmTick($).catch(() => undefined)
    })
    void detect($).catch(() => undefined)
    void pollSwitches($).catch(() => undefined)
    $.clock.every(SWITCH_MS, () => void pollSwitches($).catch(() => undefined))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // The ping's own fork is not the person's turn.
    if (!(pinging && e.text === PING_PROMPT)) {
      working = true
      if (e.agentId === undefined) sentAt = await $.clock.now()
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A subagent's turn does not touch the main chat's cache.
    if (e.agentId === undefined) {
      working = false
      void restart($).catch(() => undefined)
    }
    return result
  })

  // Each model has its own cache, so a switch leaves the next request uncached. A restored model on resume
  // changes nothing, and a switch made after the cache already lapsed has nothing left to reset.
  on('classic.PostModelSwitch', async ($, e, next) => {
    if (e.source !== 'resume' && e.prompt_cache_warm && e.from_model !== e.to_model) {
      void invalidate($, `switching to ${modelName(e.to_model)}`, e.context_tokens).catch(() => undefined)
    }
    return next(e)
  }).catch(async ($, e, next) => next(e)) // only watches: if it fails, the switch still goes through

  // Compaction replaces the history with a summary, so the conversation layer of the cache starts over.
  // A subagent's own compaction does not touch the main chat's cache.
  on('classic.PostCompact', async ($, e, next) => {
    if (e.agent_id === undefined) void invalidate($, e.trigger === 'auto' ? 'auto-compaction' : 'compaction', null).catch(() => undefined)
    return next(e)
  }).catch(async ($, e, next) => next(e)) // only watches: if it fails, the compaction still goes through

  // The person is back: a prompt of theirs ends keep warm. Its own commands do not.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim().toLowerCase()
    const own = text.startsWith('/cache-timer') || text === PING_PROMPT.toLowerCase()
    if (!own && !BACKGROUND.has(e.origin?.kind ?? '')) {
      void stopWarm($, 'Keep warm stopped: you sent a message.').catch(() => undefined)
    }
    return next(e)
  }).catch(async ($, e, next) => next(e)) // only watches: if it fails, the message still goes through

  on('command.run', { command: 'cache-timer' }, async ($, e) => {
    // Three actions: on/off switch the mod in every chat, warm toggles keep warm, and no word says where both stand.
    const arg = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')
    if (arg === 'warm') return warmCommand($)
    if (arg === 'on' || arg === 'off') {
      if (!(await writeSwitch($, arg === 'on'))) return { text: 'Cache Timer: could not write ~/.claude/mods/switches.json, so nothing changed.' }
      await pollSwitches($)
      if (arg === 'off') return { text: 'Cache Timer is off in every chat. Type /cache-timer on to turn it on again.' }
      // On also brings back a band hidden in this chat with its Hide button.
      await update($, isHidden, () => false)
      return { text: 'Cache Timer is on.' }
    }
    const keepWarm = (await read($, warm)) !== null
    const state = switchOff
      ? 'Cache Timer is off. Type /cache-timer on to turn it on.'
      : `Cache Timer is on. Keep warm is ${keepWarm ? 'on' : 'off'}. Type /cache-timer warm to ${keepWarm ? 'stop' : 'start'} it, or /cache-timer off to turn the mod off.`
    return { text: arg ? `${state} Usage: /cache-timer [on|off|warm]` : state }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, clock)
    if (!c || switchOff || working || e.props.isWorking || e.props.hasSurvey) return next(e)
    const w = await read($, warm)
    const reset = await read($, invalid)
    // Hidden means the band goes; keep warm, which spends tokens, never runs out of sight: it keeps a chip.
    const hidden = switchHidden || (await read($, isHidden))
    if (hidden && !w) return next(e)
    const rest = await next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const left = c.lastEnd + c.ttlMs - c.now
    // A surface with no column count gets the wide layout. The frame (border and padding) takes 6 columns.
    const cols: number = (e.props.bodyColumns ?? COLS_WIDE + FRAME_COLS) - FRAME_COLS
    // Quiet when calm, framed when it needs you: a state that asks for something sits in a rounded frame, its border
    // the colour of the state; a calm one is a single line with no frame, which saves the frame's two rows.
    const frame = { borderStyle: 'round', paddingX: 2, paddingY: 'xs' } as const
    const calm = { paddingX: 2 } as const

    if (hidden && w) {
      return (
        <Box flexDirection="column">
          {rest}
          <Box key="cache-band" flexDirection="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" gap={1} {...(w.error || w.cold ? { ...frame, borderColor: BAD } : calm)}>
            <Text wrap="truncate-end" color={w.error || w.cold ? BAD : COLD}>
              {`◷ Keeping cache warm · ${pingStatus(w, left)}`}
            </Text>
            <Button variant="secondary" key="stop" hotkey="w" label="Keep warm · on" onPress={() => stopWarm($, 'Keep warm is off.')} />
          </Box>
        </Box>
      )
    }

    // The mods share one button language: a secondary with a letter (a key badge on the desktop), a setting drawn as
    // `Label · state`, and ✕ (x) on the far right to dismiss.
    const hideButton = <Button variant="secondary" key="hide" role="dismiss" hotkey="x" label="✕" onPress={() => hide($)} />
    const warmButton = <Button variant="secondary" key="keepwarm" hotkey="w" label={`Keep warm · ${w ? 'on' : 'off'}`} onPress={() => toggleWarm($)} />
    const warmRow = w ? <Text color={w.cold || w.error ? BAD : COLD}>{warmLine(w, left, c.now)}</Text> : null
    const showDetail = cols >= COLS_DETAIL
    // The last turn's first request found the cache reset while this band said warm: say what it cost, until the next reply.
    // It is about the previous reply, so it is the bottom line, under what the cache is doing now.
    const rewroteRow = c.rewrote ? (
      <Text key="rewrote" size="footnote" wrap="truncate-end" color={COLD}>
        {showDetail
          ? `↻ The cache had been reset (a model switch, a compaction or similar), so that reply wrote ${short(c.rewrote)} tokens to it again`
          : `↻ Cache was reset · that reply rewrote ${short(c.rewrote)}`}
      </Text>
    ) : null

    // Something reset the cache before its time ran out: the countdown would promise a discount the next request will not get.
    if (reset) {
      const cost = reset.tokens !== null ? `your next message writes ${short(reset.tokens)} tokens to it again` : 'your next message writes the shorter conversation to it again'
      return (
        <Box flexDirection="column" rowGap="sm">
          {rest}
          <Box key="cache-band" flexDirection="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" gap={1} {...frame} borderColor={COLD}>
            <Text wrap="truncate-end">
              <Text color={COLD}>{`↻ Cache reset by ${reset.why}`}</Text>
              {showDetail ? <Text dimColor>{` · ${cost}`}</Text> : null}
            </Text>
            {hideButton}
          </Box>
        </Box>
      )
    }

    if (left > 0) {
      const share = left / c.ttlMs
      const barWidth = cols >= COLS_WIDE ? BAR_WIDE : cols >= COLS_BAR ? BAR_SHORT : 0
      const color = labelColor(share)
      let bar: unknown = null
      if (barWidth > 0 && e.surface !== 'terminal' && 'Svg' in els) {
        // A surface that draws pictures gets three rounded blocks, as plan-bar draws its steps; about 8 px a cell.
        // The terminal has an Svg element too, but plan-bar keeps it to blocks there, and so does this.
        const { Svg } = els
        bar = <Svg key="cache-bar" source={barSvg(share, barWidth * 8)} alt={`${Math.round(share * 100)}% of the cache life left`} width={barWidth * 8} height={SVG_H} />
      } else if (barWidth > 0) {
        // The terminal: three runs of cells with a blank between them. A filled cell is a █ in the colour of
        // its place in the bar, filling from the left; what is used up is ░, so the blocks stay in view.
        const room = barWidth - 2
        const filled = Math.max(1, Math.round(share * room))
        let start = 0
        bar = (
          <Text key="cache-bar">
            {blockLens(room).map((len, j) => {
              const first = start
              start += len
              const f = Math.max(0, Math.min(len, filled - first))
              return (
                <Text key={`block-${j}`}>
                  {j ? ' ' : ''}
                  {Array.from({ length: f }, (_, i) => (
                    <Text key={`f-${j}-${i}`} color={cellColor(room, first + i, share)}>
                      █
                    </Text>
                  ))}
                  {f < len ? <Text dimColor>{'░'.repeat(len - f)}</Text> : null}
                </Text>
              )
            })}
          </Text>
        )
      }
      return (
        <Box flexDirection="column" rowGap="sm">
          {rest}
          {/* Calm: one line. A keep warm that failed or found the cache cold is the exception, and gets the frame. */}
          <Box key="cache-band" flexDirection="column" rowGap="xs" {...(w?.error || w?.cold ? { ...frame, borderColor: BAD } : calm)}>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" gap={1}>
              <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
                <Text>
                  <Text color={color}>◷ Cache warm </Text>
                  <Text bold color={color}>
                    {mmss(left)}
                  </Text>
                </Text>
                {bar as never}
                {/* Keep warm's progress takes the detail's place, at every width: a failed ping must stay in view. */}
                {w ? (
                  <Text color={w.error || w.cold ? BAD : undefined} dimColor={!w.error && !w.cold} wrap="truncate-end">
                    {warmLine(w, left, c.now)}
                  </Text>
                ) : showDetail ? (
                  <Text dimColor wrap="truncate-end">
                    {`${short(c.tokens)} cached · ${lengthLabel(c)}`}
                  </Text>
                ) : null}
              </Box>
              <Box flexDirection="row" gap={1}>
                {warmButton}
                {hideButton}
              </Box>
            </Box>
            {rewroteRow}
          </Box>
        </Box>
      )
    }

    // Cold. A running keep warm (retrying after a failure) keeps its own Stop button; otherwise
    // the action is a rewarm, which writes the whole chat again, so it asks for a second press.
    const isArmed = (await read($, armed)) !== null
    const coldButton = w ? (
      warmButton
    ) : isArmed ? (
      // The second press is the safeguard, so the confirm never takes the focus by itself.
      <Button variant="secondary" key="rewarm" hotkey="w" label={`Confirm: write ${short(c.tokens)} tokens`} onPress={() => rewarm($)} />
    ) : (
      <Button variant="secondary" key="rewarm" hotkey="w" label="Rewarm now" onPress={() => rewarm($)} />
    )
    const coldParts = [
      <Text key="label" color={COLD}>
        ❄ Cache cold
      </Text>,
      <Text key="since" dimColor>{` · went cold ${ago(-left)}`}</Text>,
    ]
    if (showDetail) coldParts.push(<Text key="detail" dimColor>{` · your next message writes ${short(c.tokens)} tokens to it again`}</Text>)
    return (
      <Box flexDirection="column" rowGap="sm">
        {rest}
        <Box key="cache-band" flexDirection="column" rowGap="xs" {...frame} borderColor={COLD}>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" gap={1}>
            <Text wrap="truncate-end">{coldParts}</Text>
            <Box flexDirection="row" gap={1}>
              {coldButton}
              {hideButton}
            </Box>
          </Box>
          {warmRow}
          {rewroteRow}
        </Box>
      </Box>
    )
  })
}

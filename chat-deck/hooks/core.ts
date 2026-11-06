// Pure data: defaults, reducers, formatting and layout math. Nothing here touches `$`, so every
// behaviour is testable directly (the test kit cannot raise a subagent's tool call or a
// permission check inside a call; these functions are what the hooks apply).
import type {
  AgentCard,
  Architect,
  Bucket,
  Check,
  Edge,
  FileTouch,
  Gate,
  GitInfo,
  Layout,
  LogLine,
  Loop,
  Main,
  Moment,
  Msg,
  Receipt,
  Roster,
  SlowCall,
  Tally,
  TestRun,
  ToolNote,
  Turn,
  Usage,
  View,
} from '../types'

export const SCHEMA_VERSION = 2

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { model: '', effort: '', mode: '', steps: 0, isRunning: false, speed: null }
export const DEFAULT_USAGE: Usage = {
  pct: null,
  tokens: null,
  window: 0,
  compactWindow: null,
  compactFor: 0,
  compactMisses: 0,
  costUsd: null,
  limits: [],
  compactions: 0,
  lastCompactAt: null,
}
export const DEFAULT_ARCHITECT: Architect = { consults: [], ids: [], seen: [], lastAdvice: '' }
const ZERO: Tally = { rule: 0, ask: 0, cleared: 0, deny: 0 }
export const DEFAULT_GATE: Gate = { recent: [], totals: { file: ZERO, shell: ZERO, other: ZERO } }
export const DEFAULT_TURN: Turn = { edits: 0, errorStreak: 0, errors: 0, isReviewing: false, startedAt: 0, costAtStart: null }
export const DEFAULT_VIEW: View = { expanded: null, gateOpen: null, layout: null }
export const DEFAULT_ROSTER: Roster = { architectTypes: [] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value saved under an older shape still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

export const normalizeGate = (stored: unknown): Gate => {
  const g = normalize(DEFAULT_GATE, stored)
  const totals = normalize(DEFAULT_GATE.totals, g.totals)
  return {
    recent: listOf<Check>(g.recent),
    totals: { file: normalize(ZERO, totals.file), shell: normalize(ZERO, totals.shell), other: normalize(ZERO, totals.other) },
  }
}

export const normalizeCard = (stored: unknown): AgentCard =>
  normalize<AgentCard>(
    {
      id: '',
      type: 'agent',
      model: '',
      description: '',
      status: 'running',
      spawnedAt: 0,
      endedAt: null,
      ctx: 0,
      out: 0,
      steps: 0,
      lastStop: null,
      tools: [],
      answer: '',
    },
    stored,
  )

export const normalizeLog = (stored: unknown): LogLine[] =>
  listOf<Record<string, unknown>>(stored).map(l => ({
    at: typeof l.at === 'number' ? l.at : 0,
    who: String(l.who ?? ''),
    text: String(l.text ?? ''),
    agentId: typeof l.agentId === 'string' ? l.agentId : null,
    kind: l.kind === 'error' || l.kind === 'consult' || l.kind === 'done' ? l.kind : 'info',
  }))

// ---------------------------------------------------------------- config

export type Panel = 'main' | 'plan' | 'git' | 'architect' | 'gate' | 'checks' | 'agents' | 'loops' | 'receipt' | 'files' | 'comms' | 'log'
// 0.8.0 order: what is happening now (main, plan), what needs attention (checks, git), the work (agents to
// comms), then history (gate, architect, log).
export const PANELS: readonly Panel[] = ['main', 'plan', 'checks', 'git', 'agents', 'loops', 'receipt', 'files', 'comms', 'gate', 'architect', 'log']

/** What used to be options and never needed to be: fixed, not configurable. */
export const FIXED = {
  architectLabel: 'ARCHITECT',
  gateLabel: 'GATE',
  moments: true,
  maxCards: 3,
  motion: true,
  statusLine: true,
} as const

export type Config = {
  architect: RegExp
  paneColumns: number
  layout: Layout
  palette: Palette
  openOnStart: boolean
}

const safeRegExp = (source: string, fallback: string) => {
  try {
    return new RegExp(source || fallback, 'i')
  } catch {
    return new RegExp(fallback, 'i')
  }
}

/** The panels hidden through the pane's own toggles, read from stored view state: unknown names and repeats are dropped. */
export const hiddenPanels = (stored: unknown): Panel[] => [...new Set(listOf<unknown>(stored).filter((p): p is Panel => (PANELS as readonly unknown[]).includes(p)))]

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const str = (k: string, d: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : d)
  const bool = (k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const layout = str('layout', 'auto')
  const cols = typeof o.paneColumns === 'number' && Number.isFinite(o.paneColumns) ? Math.round(o.paneColumns) : 66
  return {
    architect: safeRegExp(str('architectPattern', ''), 'advisor|architect'),
    // The body clamps its drawing at 40 columns, so a narrower dock would only clip it.
    paneColumns: Math.max(40, cols),
    layout: layout === 'compact' || layout === 'wide' || layout === 'mini' ? layout : 'auto',
    palette: str('palette', 'theme') === 'pastel' ? 'pastel' : 'theme',
    openOnStart: bool('openOnStart', true),
  }
}

// ---------------------------------------------------------------- palette

export type Palette = 'theme' | 'pastel'
export type Colors = Record<'main' | 'agent' | 'gate' | 'cleared' | 'arch' | 'amber' | 'warn' | 'dim' | 'faint' | 'text', string>

/**
 * `theme` names the person's own theme colours (they follow light, dark and colour-blind themes);
 * `pastel` is fixed hex tuned for dark terminals.
 */
export const PALETTES: Record<Palette, Colors> = {
  theme: {
    main: 'claude',
    agent: 'suggestion',
    gate: 'success',
    cleared: 'permission',
    arch: 'merged',
    amber: 'warning',
    warn: 'error',
    dim: 'inactive',
    faint: 'subtle',
    text: 'text',
  },
  pastel: {
    main: '#7dd3fc',
    agent: '#93c5fd',
    gate: '#86efac',
    cleared: '#5eead4',
    arch: '#c4b5fd',
    amber: '#fcd34d',
    warn: '#fca5a5',
    dim: '#6b7280',
    faint: '#3f4654',
    text: '#e5e7eb',
  },
}

// ---------------------------------------------------------------- formatting

/** `claude-opus-5-5` → `Opus 5.5`; anything else is shown as given. */
/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` → `Opus 5.5 1M`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Sonnet 4.5`, `claude-3-5-haiku-20241022` →
 * `Haiku 3.5`. Anything else is shown as given, cut to 22 characters.
 */
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

export const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

export const kTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** A running clock as the live cards draw it: m:ss, or XhYY past an hour. */
export const fmtTimer = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtClock = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '--:--:--')

/** `1 error`, `2 errors`. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

/**
 * How soon a request began to answer: from when it was sent to its first piece of response; null when
 * none came. No output rate: the reported tokens include thinking, which may arrive unstreamed before
 * that first piece, so tokens over the visible stream read in the thousands per second.
 */
export const stepSpeed = (sentAt: number, firstAt: number | null) => (firstAt === null ? null : { ttftMs: Math.max(0, firstAt - sentAt) })

/** `ttft 0.8s`. */
export const fmtSpeed = (s: { ttftMs: number }) => `ttft ${(s.ttftMs / 1000).toFixed(1)}s`

/** The compaction window a context breakdown reports: its `rawMaxTokens` when auto-compaction is on and that is smaller than the model's `window`; else null. */
export const compactWindowOf = (b: { rawMaxTokens: number; isAutoCompactEnabled: boolean } | null | undefined, window: number): number | null =>
  b && b.isAutoCompactEnabled && b.rawMaxTokens > 0 && b.rawMaxTokens < window ? b.rawMaxTokens : null

/**
 * What the context gauge measures: the compaction window when one is set smaller than the model's,
 * else the model's window, and the fill of it from the real `tokens` reading. No gauge (null) without one.
 */
export const contextFill = (u: Pick<Usage, 'tokens' | 'window' | 'compactWindow'>): { pct: number | null; window: number } => {
  const window = u.compactWindow !== null && u.compactWindow > 0 && u.compactWindow < u.window ? u.compactWindow : u.window
  return { window, pct: u.tokens !== null && window > 0 ? (u.tokens * 100) / window : null }
}

/** Reads of the compaction window that may miss (no session bound yet) before a model window stops asking. */
export const COMPACT_TRIES = 3

/**
 * A measurement of model window `window`: whether it reads the compaction window (not read for this
 * window yet, fewer than COMPACT_TRIES misses), and the usage with that read claimed. A new window
 * starts its misses afresh.
 */
export const claimCompactRead = (u: Usage, window: number): { usage: Usage; isClaimed: boolean } => {
  const misses = u.window === window ? u.compactMisses : 0
  const isClaimed = window > 0 && u.compactFor !== window && misses < COMPACT_TRIES
  return { usage: { ...u, compactFor: isClaimed ? window : u.compactFor, compactMisses: misses }, isClaimed }
}

/**
 * The usage after a compaction-window read for model window `window`. Dropped when a newer claim took
 * its place (a model switch); a read that failed or came back with no breakdown is a miss, asked
 * again at the next measurement.
 */
export const afterCompactRead = (
  u: Usage,
  window: number,
  b: { rawMaxTokens: number; isAutoCompactEnabled: boolean } | null | undefined,
): Usage =>
  u.compactFor !== window
    ? u
    : b
      ? { ...u, compactWindow: compactWindowOf(b, window), compactMisses: 0 }
      : { ...u, compactWindow: null, compactFor: 0, compactMisses: u.compactMisses + 1 }

/** A new main-loop model may compact in another window (`modelSettings`): read afresh at the next measurement. */
export const forgetCompactRead = (u: Usage): Usage => ({ ...u, compactWindow: null, compactFor: 0, compactMisses: 0 })

/** A gauge of `width` cells: ▰ filled, ▱ empty. */
export const gauge = (pct: number, width: number) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}

/** A rate-limit reading as the pane keeps it, its ISO reset time turned into ms since the epoch. */
export const limitOf = (r: { kind: string; percentUsed: number; resetsAt?: string }) => {
  const at = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  return { kind: r.kind, pct: r.percentUsed, resetsAt: Number.isFinite(at) ? at : null }
}

/** Time left until a window resets, its two largest units: `25m`, `3h10m`, `4d2h`; empty when unknown or past. */
export const fmtResetIn = (resetsAt: number | null | undefined, now: number) => {
  if (resetsAt === null || resetsAt === undefined || resetsAt <= now) return ''
  const m = Math.max(1, Math.floor((resetsAt - now) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

/** A rate-limit window's short name: `five_hour` → `5h`, `seven_day_opus` → `7d opus`. */
export const limitLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

// ---------------------------------------------------------------- redaction

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]

/** What the gate drill-down may store: credentials masked before anything is written to state. */
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

// ---------------------------------------------------------------- tools and gate

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export const bucketOf = (tool: string): Bucket =>
  FILE_TOOLS.has(tool) ? 'file' : SHELL_TOOLS.has(tool) ? 'shell' : 'other'

/** One line saying what a call was about: its command, path or pattern; redacted. */
export const describeInput = (tool: string, input: unknown) => {
  const i = isObject(input) ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const what =
    typeof i.command === 'string'
      ? i.command
      : path || (typeof i.pattern === 'string' ? i.pattern : typeof i.url === 'string' ? i.url : typeof i.description === 'string' ? i.description : '')
  return redact(what ? `${tool} → ${what}` : tool)
}

/** Keeps the last `max` checks, but never drops a pending ask: its settle must still find it. */
export const trimRecent = (list: Check[], max: number): Check[] => {
  let extra = list.length - max
  if (extra <= 0) return list
  const out: Check[] = []
  for (const c of list) {
    if (extra > 0 && c.verdict !== 'ask') {
      extra -= 1
      continue
    }
    out.push(c)
  }
  return out.slice(-max * 2)
}

export const recordCheck = (g: Gate, c: Check): Gate => {
  const t = g.totals[c.bucket]
  return {
    recent: trimRecent([...g.recent, c], 80),
    totals: { ...g.totals, [c.bucket]: { ...t, [c.verdict]: t[c.verdict] + 1 } },
  }
}

/** An `ask` settled by the call that followed it: it ran (cleared) or was refused (deny). */
export const settleCheck = (g: Gate, id: string, didRun: boolean): Gate => {
  const c = g.recent.find(r => r.id === id && r.verdict === 'ask')
  if (!c) return g
  const verdict = didRun ? 'cleared' : 'deny'
  const t = g.totals[c.bucket]
  return {
    recent: g.recent.map(r => (r === c ? { ...r, verdict } : r)),
    totals: { ...g.totals, [c.bucket]: { ...t, ask: Math.max(0, t.ask - 1), [verdict]: t[verdict] + 1 } },
  }
}

export const gateSummary = (g: Gate) => {
  const all = (['file', 'shell', 'other'] as const).reduce(
    (s, k) => ({
      rule: s.rule + g.totals[k].rule,
      ask: s.ask + g.totals[k].ask,
      cleared: s.cleared + g.totals[k].cleared,
      deny: s.deny + g.totals[k].deny,
    }),
    { ...ZERO },
  )
  return { ...all, total: all.rule + all.ask + all.cleared + all.deny }
}

// ---------------------------------------------------------------- turn and architect

/**
 * The turn after one tool call. Errors count in the main loop only (a subagent's failure is its
 * own); edits count from every loop, so delegated work still reaches "before done".
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  ...t,
  errorStreak: c.inSubagent ? t.errorStreak : c.hasFailed ? t.errorStreak + 1 : 0,
  errors: t.errors + (!c.inSubagent && c.hasFailed ? 1 : 0),
  edits: t.edits + (c.isEdit ? 1 : 0),
})

/** Which of the architect's three moments a consult falls at: an inference over this turn so far. */
export const momentOf = (t: Pick<Turn, 'edits' | 'errorStreak'>): Moment =>
  t.errorStreak >= 2 ? 'error repeats' : t.edits === 0 ? 'before a plan' : 'before done'

export const startConsult = (a: Architect, c: { id: string; at: number; moment: Moment; via: string }): Architect =>
  a.consults.some(x => x.id === c.id) ? a : { ...a, consults: [...a.consults, { ...c, endAt: null }].slice(-40) }

/** Ends the open consult (the latest without an end), or the one named. */
export const endConsult = (a: Architect, at: number, advice: string | null, id?: string): Architect => {
  const open = [...a.consults].reverse().find(c => c.endAt === null && (id === undefined || c.id === id))
  return {
    ...a,
    consults: a.consults.map(c => (c === open ? { ...c, endAt: at } : c)),
    lastAdvice: advice ?? a.lastAdvice,
  }
}

export const isAdvising = (a: Architect) => a.consults.some(c => c.endAt === null)

/** A one-row timeline of consults across `width` cells: ◆ a consult, ━ while it ran. */
export const consultTimeline = (a: Architect, now: number, width: number) => {
  if (a.consults.length === 0 || width < 4) return '─'.repeat(Math.max(0, width))
  const first = a.consults[0]?.at ?? now
  const span = Math.max(1, now - first)
  const cells = Array.from({ length: width }, () => '─')
  for (const c of a.consults) {
    const from = Math.min(width - 1, Math.floor(((c.at - first) / span) * (width - 1)))
    const to = Math.min(width - 1, Math.floor((((c.endAt ?? now) - first) / span) * (width - 1)))
    for (let i = from + 1; i <= to; i += 1) cells[i] = '━'
    cells[from] = '◆'
  }
  return cells.join('')
}

export const receiptOf = (t: Turn, o: { durationMs: number; agentsSince: number; costNow: number | null; reason: string }): Receipt => ({
  durationMs: o.durationMs,
  agents: o.agentsSince,
  edits: t.edits,
  errors: t.errors,
  costDelta: o.costNow !== null && t.costAtStart !== null && o.costNow - t.costAtStart >= 0.005 ? o.costNow - t.costAtStart : null,
  reason: o.reason,
  slow: t.slow ?? [],
})

// ---------------------------------------------------------------- agents and loops

type StepUsage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | null

/** A card after one of its model requests: its context is the latest step's whole input; output adds up. */
export const applyStep = (c: AgentCard, s: { model: string; usage: StepUsage; stopReason: string | null }): AgentCard => {
  const u = s.usage ?? {}
  const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    ...c,
    model: c.model || s.model,
    steps: c.steps + 1,
    ctx: ctx > 0 ? ctx : c.ctx,
    out: c.out + (u.output_tokens ?? 0),
    lastStop: s.stopReason,
  }
}

export const noteTool = (c: AgentCard, n: ToolNote): AgentCard => ({
  ...c,
  tools: [...c.tools, n].slice(-3),
  toolTally: { ...c.toolTally, [n.tool]: (c.toolTally?.[n.tool] ?? 0) + 1 },
})

/** An agent's busiest tools as chips, like `bash ×5 · edit ×2`; empty when it called none. */
export const chipsOf = (tally: Readonly<Record<string, number>> | undefined, top = 2) =>
  Object.entries(tally ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([tool, n]) => `${shorten(tool, 10)} ×${n}`)
    .join(' · ')

/** A surface module's fault key, `desktop:rail.tsx`, from `hooks/rail.tsx` or `hooks\rail.tsx` alike. */
export const faultKey = (surface: string, module: string) => `${surface}:${module.split(/[\\/]/).pop()}`

/** A card whose agent was resumed after it finished (SendMessage): running again, its clock from its first spawn. */
export const resumeCard = (c: AgentCard): AgentCard => ({ ...c, status: 'running', endedAt: null })

/**
 * A spawned card joins the list. An id already there is that agent resumed: its card runs again
 * where it stands, with its tallies and the new task and model, so no two cards share keys.
 */
export const addCard = (cards: AgentCard[], card: AgentCard): AgentCard[] =>
  cards.some(c => c.id === card.id)
    ? cards.map(c => (c.id === card.id ? resumeCard({ ...c, description: card.description || c.description, model: card.model || c.model, prompt: card.prompt || c.prompt }) : c))
    : [...cards, card].slice(-24)

export const stepLoop = (loops: Loop[], id: string, at: number): Loop[] => {
  const found = loops.find(l => l.id === id)
  const next = found
    ? loops.map(l => (l === found ? { ...l, steps: l.steps + 1, lastAt: at } : l))
    : [...loops, { id, steps: 1, firstAt: at, lastAt: at, isDone: false }]
  return next.slice(-60)
}

export const LOOP_ACTIVE_MS = 15_000
export const isLoopActive = (l: Loop, now: number) => !l.isDone && now - l.lastAt < LOOP_ACTIVE_MS

/** Swimlane geometry: each agent's bar on one shared axis from the first spawn to now. */
export const lanes = (cards: AgentCard[], now: number, width: number) => {
  const start = Math.min(...cards.map(c => c.spawnedAt).filter(n => n > 0), now)
  const span = Math.max(1, now - start)
  return cards.map(c => {
    const from = Math.floor(((Math.max(c.spawnedAt, start) - start) / span) * width)
    const to = Math.max(from + 1, Math.ceil((((c.endedAt ?? now) - start) / span) * width))
    return { id: c.id, before: Math.min(from, width), bar: Math.min(to, width) - Math.min(from, width), after: width - Math.min(to, width) }
  })
}

// ---------------------------------------------------------------- layout

/** How many log lines fit: what the other panels leave, never fewer than 4 nor more than 8. */
export const logRows = (bodyRows: number, used: number) => Math.max(4, Math.min(8, bodyRows - used - 3))

/** How many events the log holds and how many of them failed: the log's header tally. */
export const logTally = (lines: readonly { kind: string }[]) => ({
  events: lines.length,
  errors: lines.filter(l => l.kind === 'error').length,
})

/**
 * A failed call's log text (`✗ <reason> · <Tool> → <command>`) in its two parts, so the reason can be drawn
 * apart from the command; null for any other text (a denial, a failed test run).
 */
export const splitFailure = (text: string): { reason: string; call: string } | null => {
  const m = /^✗ (.+?) · ([A-Za-z][\w:.-]* → .*)$/.exec(text)
  return m?.[1] && m[2] ? { reason: m[1], call: m[2] } : null
}

/** A bar `cells` wide, filled in proportion to `ms` of `total`, never empty: where a call sits in the turn's time. */
export const slowBar = (ms: number, total: number, cells: number) => {
  const n = total > 0 ? Math.min(cells, Math.max(1, Math.round((cells * ms) / total))) : 1
  return '█'.repeat(n) + '░'.repeat(cells - n)
}

/** The cells a string takes in a terminal: one per character. */
export const cellWidth = (s: string) => [...s].length

/**
 * How many pieces of a line fit in `room` cells, in order from the start: each piece is `lead` extra cells
 * then `width`, and pieces sit `gap` cells apart. The rest are left out, as the legend's items are.
 */
export const piecesThatFit = (pieces: readonly { width: number; lead?: number }[], room: number, gap: number) => {
  let used = 0
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i]!
    const next = used + (i > 0 ? gap : 0) + (p.lead ?? 0) + p.width
    if (next > room) return i
    used = next
  }
  return pieces.length
}

/**
 * How many marks (■ ✗ ● ○ ✓) a row of `cells` columns holds. A terminal draws each mark in one
 * cell; a graphical surface draws them wider (■ measured about 1.4 cells on the desktop app), so
 * there a row holds fewer and its newest marks still show.
 */
export const marksIn = (cells: number, isTerminal: boolean) => (isTerminal ? cells : Math.floor(cells / 1.5))

/** A card's title row: the task in the agent's own words, the type only when there is none. */
export const cardTitle = (c: AgentCard) => c.description || c.type

/**
 * A card's short name among `all`: its title, unless another card starts the same way (parallel agents share a
 * prefix like "Wave 1: ..."). Twins of one type are told apart by their titles past the shared words
 * ("auth token refresh", "payment retries"); twins of mixed types by the type's last segment, numbered if
 * those match too, as are one type's twins whose titles stay alike.
 */
export const cardLabel = (c: AgentCard, all: readonly AgentCard[]) => {
  const head = (x: AgentCard) => cardTitle(x).slice(0, 10)
  const twins = all.filter(o => head(o) === head(c))
  if (twins.length < 2) return cardTitle(c)
  if (twins.every(o => o.type === c.type)) {
    const titles = twins.map(cardTitle)
    let n = 0
    while (titles.every(t => n < t.length && t[n] === titles[0]![n])) n += 1
    const rests = titles.map(t => t.slice(t.lastIndexOf(' ', n) + 1).trim())
    const mine = rests[twins.indexOf(c)] ?? ''
    if (mine && rests.filter(r => r === mine).length === 1) return mine
  }
  const tail = (x: AgentCard) => x.type.split(':').pop() || x.type
  const same = twins.filter(o => tail(o) === tail(c))
  return same.length < 2 ? tail(c) : `${tail(c)} ${same.findIndex(o => o.id === c.id) + 1}`
}

// ---------------------------------------------------------------- comms

/** The main loop's id in a message; every other id is an agent's. */
export const MAIN_ID = 'main'
const MSG_CAP = 80

export const normalizeMsgs = (stored: unknown): Msg[] =>
  listOf<Record<string, unknown>>(stored).map(m => ({
    at: typeof m.at === 'number' ? m.at : 0,
    from: String(m.from ?? MAIN_ID),
    to: String(m.to ?? ''),
    kind: m.kind === 'prompt' ? 'prompt' : 'message',
    text: String(m.text ?? ''),
  }))

export const addMsg = (list: readonly Msg[], m: Msg): Msg[] => [...list, m].slice(-MSG_CAP)

/** A SendMessage recipient (an agent id or the name it was spawned under) as a card id; what matches no card stays as written. */
export const resolveTo = (to: string, cards: readonly AgentCard[]): string => {
  const t = to.trim()
  if (t.toLowerCase() === MAIN_ID) return MAIN_ID
  const byId = cards.find(c => c.id === t)
  if (byId) return byId.id
  const byName = cards.find(c => c.type.toLowerCase() === t.toLowerCase())
  return byName ? byName.id : t
}

/** One edge per sender and recipient, with how many messages it carried and the latest. */
export const edgesOf = (msgs: readonly Msg[]): Edge[] => {
  const by = new Map<string, Edge>()
  for (const m of msgs) {
    const k = `${m.from}\u0000${m.to}`
    by.set(k, { from: m.from, to: m.to, count: (by.get(k)?.count ?? 0) + 1, last: m })
  }
  return [...by.values()]
}

/** The architect's agents as cards, so a message to or from one has a node, a name and a recipient to match. */
export const withArchitect = (cards: readonly AgentCard[], a: Architect, label: string): AgentCard[] => [
  ...cards,
  ...a.ids
    .filter(id => !cards.some(c => c.id === id))
    .map(id => ({
      ...normalizeCard({}),
      id,
      type: label,
      description: label,
      status: a.consults.some(c => c.id === id && c.endAt === null) ? 'running' : 'done',
      spawnedAt: a.consults.find(c => c.id === id)?.at ?? 0,
    })),
]

export type Scene = { msgs: Msg[]; cards: AgentCard[]; isPast: boolean }

/**
 * The comms as they stood after the first `scrub` messages: later messages gone, agents not yet
 * spawned gone, and an agent that had not yet finished running again. `null` is the live view.
 */
export const sceneAt = (msgs: readonly Msg[], cards: readonly AgentCard[], scrub: number | null | undefined): Scene => {
  if (scrub === null || scrub === undefined || scrub >= msgs.length) return { msgs: [...msgs], cards: [...cards], isPast: false }
  const shown = msgs.slice(0, Math.max(0, scrub))
  const at = shown.at(-1)?.at ?? 0
  return {
    msgs: shown,
    isPast: true,
    cards: cards
      .filter(c => c.spawnedAt <= at)
      .map(c => (c.endedAt !== null && c.endedAt <= at ? c : { ...c, status: 'running', endedAt: null })),
  }
}

/** The scrub position one message back or forward from `scrub`; past the newest message it is live (null). */
export const stepScrub = (scrub: number | null | undefined, len: number, dir: -1 | 1): number | null => {
  if (len === 0) return null
  const here = scrub === null || scrub === undefined ? len : Math.min(scrub, len)
  const next = here + dir
  return next >= len ? null : Math.max(0, next)
}

/** What a loop is called in the comms list: `main`, its card's title, or the id as written. */
export const nodeName = (id: string, cards: readonly AgentCard[]) => {
  if (id === MAIN_ID) return MAIN_ID
  const c = cards.find(x => x.id === id)
  return c ? cardTitle(c) : id
}

/** A title split over two rows at a word boundary: `first` cells on row one, `rest` on row two. */
export const titleLines = (title: string, first: number, rest: number): [string, string] => {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= first) return [t, '']
  const cut = t.lastIndexOf(' ', first)
  const at = cut > 0 ? cut : first
  return [t.slice(0, at).trim(), shorten(t.slice(at), rest)]
}

/**
 * `text` broken at word boundaries into rows of at most `width` cells, at most `max` rows; what does not fit
 * ends the last row with an ellipsis. A word longer than a row is split. Never empty, so a row is always drawn.
 */
export const wrapLines = (text: string, width: number, max: number): string[] => {
  const room = Math.max(1, width)
  const rows: string[] = []
  let cur = ''
  for (let word of text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)) {
    while (cellWidth(word) > room) {
      if (cur) rows.push(cur)
      cur = ''
      rows.push(word.slice(0, room))
      word = word.slice(room)
    }
    if (!cur) cur = word
    else if (cellWidth(cur) + 1 + cellWidth(word) <= room) cur += ` ${word}`
    else {
      rows.push(cur)
      cur = word
    }
  }
  if (cur) rows.push(cur)
  if (rows.length === 0) return ['']
  return rows.length <= max ? rows : [...rows.slice(0, max - 1), shorten(rows.slice(max - 1).join(' '), room)]
}

/**
 * What a turn's opening text was, for the log: the person's words, or for a turn the engine
 * opened with a tagged message (a subagent's hand-back, a task notification), that message's kind.
 */
export const promptLine = (text: string): { who: string; text: string } => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(text, 70) }
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  const kind = tag.replace(/[-_]/g, ' ')
  if (from) return { who: 'engine', text: shorten(`${kind} from ${from.slice(0, 8)}`, 70) }
  // 0.8.0: what the message says, not only its kind: its <summary> where it has one, else its text without tags.
  const summary = /<summary>([\s\S]*?)<\/summary>/i.exec(text)?.[1]
  const said = shorten(redact(summary ?? text.replace(/<[^>]*>/g, ' ')), 70)
  return { who: 'engine', text: shorten(said ? `${kind}: ${said}` : kind, 70) }
}

/**
 * `s` in at most `n` cells, cut in the middle so both ends stay: a path keeps its folder and its file,
 * a command its program and its target. The desktop app ignores a Text's `truncate-start`, so this is cut here.
 */
export const midCut = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  const chars = [...one]
  if (n <= 0) return ''
  if (chars.length <= n) return one
  if (n <= 3) return chars.slice(0, n).join('')
  const head = Math.ceil((n - 1) / 2)
  const tail = n - 1 - head
  return `${chars.slice(0, head).join('').trimEnd()}…${chars.slice(chars.length - tail).join('').trimStart()}`
}

/**
 * A subagent's hand-back message: who sent it and the first line of what it said. The report
 * follows a framing header in the message; without one, the first line after the opening tag.
 */
export const handbackOf = (text: string): { from: string; body: string } | null => {
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  const afterHeader = text.split(/The report follows:\s*\n/)[1]
  const rest = afterHeader ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body =
    rest
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('[') && !l.startsWith('<') && !l.startsWith('</')) ?? ''
  return body ? { from, body } : null
}

/** The advice line a pane shows for a report: its first real line, markdown markers stripped, cut to 160. */
export const adviceLine = (report: string) => {
  const first = report.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('[') && !l.startsWith('<')) ?? ''
  return shorten(first.replace(/\*\*|__/g, '').replace(/^[#>*\s-]+/, ''), 160)
}

export const elapsedOf = (c: AgentCard, now: number) => (c.endedAt ?? now) - c.spawnedAt

// ---------------------------------------------------------------- checks and files

/** `just now`, `3m ago`, `2h05m ago`. */
export const fmtAgo = (at: number, now: number) => (now - at < 60_000 ? 'just now' : `${fmtResetIn(now, at)} ago`)

/**
 * The commands a shell line runs, each from its program on: split at `&&`, `||`, `;`, `|` and new lines, `cd` steps
 * dropped, leading `VAR=value` words stripped. `grep "mvn test"` runs grep, not Maven.
 * shortcut: quotes are not parsed, so a separator inside a quoted string splits there; parse quotes if that misfires.
 */
export const commandHeads = (command: string): string[] =>
  command
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim().replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, ''))
    .filter(s => s && !/^cd(\s|$)/.test(s))

// Each matches a command's start (see commandHeads), after an optional `rtk`, `npx` or path.
const MAVEN = /^(?:rtk\s+)?(?:\S*\/)?(?:mvnw?|mvnd)\b.*\b(?:test|verify|install|package|compile|integration-test)\b/
const JS_TESTS = /^(?:rtk\s+)?(?:npx\s+|bunx\s+)?(?:\S*\/)?(?:jest|vitest|bun test|claude plugin test)\b|^(?:rtk\s+)?(?:npm|pnpm|yarn)(?: run)? test\b/
const TSC = /^(?:rtk\s+)?(?:npx\s+)?(?:\S*\/)?tsc\b(?!.*\s(?:--version|-v|--help|-h|--init)\b)/
const count = (text: string, re: RegExp) => Number(re.exec(text)?.[1] ?? 0)

/**
 * What a Bash call's output says about a build or test run, or null when the command is not one.
 * Maven's per-module `Results:` lines (no `Time elapsed`) are summed; rtk keeps them in its compact form.
 * `isError` (a non-zero exit) fails a run whose output names no failure.
 */
export const parseTestRun = (command: string, text: string, isError: boolean): Omit<TestRun, 'at' | 'by' | 'command'> | null => {
  const heads = commandHeads(command)
  const runs = (re: RegExp) => heads.some(h => re.test(h))
  if (runs(MAVEN)) {
    const sums = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)(?!, Time elapsed)\s*$/gm)]
    const n = (i: number) => sums.reduce((s, m) => s + Number(m[i]), 0)
    const failed = n(2) + n(3)
    const isBroken = /BUILD FAILURE|COMPILATION ERROR/.test(text)
    return { kind: 'maven', passed: sums.length > 0 ? n(1) - failed - n(4) : null, failed, skipped: n(4), isOk: !isError && !isBroken && failed === 0 }
  }
  if (runs(JS_TESTS)) {
    // jest `Tests: 1 failed, 40 passed`, vitest `Tests  1 failed | 40 passed`, bun `40 pass` / `1 fail`.
    const line = /^\s*Tests:?\s+.*$/m.exec(text)?.[0] ?? text
    const passed = count(line, /(\d+) passed/) || count(text, /^\s*(\d+) pass$/m)
    const failed = count(line, /(\d+) failed/) || count(text, /^\s*(\d+) fail$/m)
    const skipped = count(line, /(\d+) (?:skipped|todo)/)
    const hasCounts = /\d+ (passed|failed)|^\s*\d+ (pass|fail)$/m.test(text)
    return { kind: 'tests', passed: hasCounts ? passed : null, failed, skipped, isOk: !isError && failed === 0 }
  }
  if (runs(TSC)) {
    const failed = count(text, /Found (\d+) errors?/) || (text.match(/error TS\d+/g) ?? []).length
    return { kind: 'tsc', passed: null, failed, skipped: 0, isOk: !isError && failed === 0 }
  }
  return null
}

const TEST_CAP = 20
export const addRun = (runs: readonly TestRun[], r: TestRun): TestRun[] => [...runs, r].slice(-TEST_CAP)

export const normalizeRuns = (stored: unknown): TestRun[] =>
  listOf<Record<string, unknown>>(stored).map(r => ({
    at: typeof r.at === 'number' ? r.at : 0,
    by: String(r.by ?? MAIN_ID),
    command: String(r.command ?? ''),
    kind: r.kind === 'maven' || r.kind === 'tsc' ? r.kind : 'tests',
    passed: typeof r.passed === 'number' ? r.passed : null,
    failed: typeof r.failed === 'number' ? r.failed : 0,
    skipped: typeof r.skipped === 'number' ? r.skipped : 0,
    isOk: r.isOk === true,
    reason: typeof r.reason === 'string' ? r.reason : '',
  }))

/** What a run proved: `tests` only when it reported test counts, else a `build` or `tsc` that ran none. */
export const runLabel = (r: TestRun) => (r.passed !== null ? 'tests' : r.kind === 'tsc' ? 'tsc' : 'build')

/** The newest run that reported test counts: what edits are untested against. A build or tsc run tests nothing. */
export const lastTested = (runs: readonly TestRun[]) => [...runs].reverse().find(r => r.passed !== null)

/** A run's counts in words: `412 passed · 0 failed · 3 skipped`, or what its kind says without counts. */
export const runCounts = (r: TestRun) =>
  r.passed !== null
    ? `${r.passed} passed · ${r.failed} failed${r.skipped > 0 ? ` · ${r.skipped} skipped` : ''}`
    : r.kind === 'tsc'
      ? r.isOk ? 'no type errors' : plural(r.failed, 'type error')
      : `${r.kind === 'maven' ? 'build' : 'tests'} ${r.isOk ? 'ok' : 'failed'}`

const SPECIFIC = /\.(java|kt|ts|tsx|js|py|go):\[?\d|error TS\d+|Exception\b|AssertionError|cannot find symbol|expected:? </
const GENERIC = /error|fail|cannot|not found|denied|invalid|missing/i
const NOISE = /^(exit code \d+|COMPILATION ERROR\s*:?|BUILD FAILURE|-+|Failures:|Errors:)$/i

/** The line of a failed call's output that says why: a located error first, then any error-ish line; paths cut to their file, masked. */
export const failureLine = (text: string | undefined) => {
  const lines = (text ?? '')
    .split('\n')
    .map(l => l.replace(/^\s*(\[(ERROR|FATAL|INFO)\]\s*)+/i, '').trim())
    .filter(l => l && !NOISE.test(l))
  const hit = lines.find(l => SPECIFIC.test(l)) ?? lines.find(l => GENERIC.test(l)) ?? lines[0] ?? ''
  return shorten(redact(hit.replace(/(?:\/[\w.@-]+)+\/([\w.@-]+)/g, '$1')), 90)
}

const FILE_CAP = 40

/** One more edit of `path` by loop `by` (an agent id or `main`). */
export const noteFile = (files: readonly FileTouch[], edit: { path: string; by: string; at: number }): FileTouch[] => {
  const found = files.find(f => f.path === edit.path)
  const next = found
    ? files.map(f => (f === found ? { ...f, edits: f.edits + 1, lastAt: edit.at, by: f.by.includes(edit.by) ? f.by : [...f.by, edit.by] } : f))
    : [...files, { path: edit.path, edits: 1, by: [edit.by], firstAt: edit.at, lastAt: edit.at }]
  return next.length > FILE_CAP ? [...next].sort((a, b) => b.lastAt - a.lastAt).slice(0, FILE_CAP) : next
}

/** Files edited after `at` (a test run's time): what that run did not see. */
export const editsSince = (files: readonly FileTouch[], at: number) => files.filter(f => f.lastAt > at).length

export const normalizeFiles = (stored: unknown): FileTouch[] =>
  listOf<Record<string, unknown>>(stored).map(f => ({
    path: String(f.path ?? ''),
    edits: typeof f.edits === 'number' ? f.edits : 1,
    by: listOf<string>(f.by),
    firstAt: typeof f.firstAt === 'number' ? f.firstAt : 0,
    lastAt: typeof f.lastAt === 'number' ? f.lastAt : 0,
  }))

/** A path as the panel shows it: its last two segments. */
export const shortPath = (p: string) => p.split(/[\\/]/).slice(-2).join('/')

// ---------------------------------------------------------------- 0.4.0: effort, slow calls, runway, hotspots

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** An effort as 1-5 cells (`xhigh` 4, `max` 5); 0 when unknown. */
export const effortLevel = (effort: string) => EFFORTS.indexOf(effort) + 1

/** Calls shorter than this are never among the slowest: a receipt line is for what cost real time. */
export const SLOW_MS = 3000

/** The `n` slowest calls with `call` added, slowest first; unchanged (same list) when it does not qualify. */
export const slowest = (list: readonly SlowCall[], call: SlowCall, n = 3): readonly SlowCall[] => {
  if (call.ms < SLOW_MS || (list.length >= n && call.ms <= (list[list.length - 1]?.ms ?? 0))) return list
  return [...list, call].sort((a, b) => b.ms - a.ms).slice(0, n)
}

/**
 * Turns left before the context window fills, from how much it grew per turn over the last three turns
 * (`samples`: the context tokens at each main turn's start, oldest first). Null with fewer than two
 * samples or no growth; an estimate, drawn as one.
 */
export const runway = (samples: readonly number[], tokens: number | null, window: number): number | null => {
  if (tokens === null || window <= 0) return null
  const all = [...samples.slice(-3), tokens]
  const steps = all.slice(1).map((t, i) => t - (all[i] ?? t)).filter(d => d > 0)
  if (steps.length === 0) return null
  const avg = steps.reduce((s, d) => s + d, 0) / steps.length
  return Math.max(0, Math.floor((window - tokens) / avg))
}

/**
 * The permission rule a check would need to be allowed without asking, never broader than the call: its first
 * command (commandHeads), from the program (with `rtk` when present) through its flags to its first
 * subcommand-like word, at most five words: `Bash(mvn test:*)`, `Bash(git -C /x status:*)`. The tool's own name
 * for anything else.
 */
export const allowRule = (c: Pick<Check, 'tool' | 'detail'>): string => {
  if (c.tool !== 'Bash') return c.tool
  const cmd = c.detail.split(' → ').slice(1).join(' → ')
  const all = (commandHeads(cmd)[0] ?? '').split(/\s+/).filter(Boolean)
  // A detail cut short ends in `…`: the words from there on are not the command's.
  const cut = all.findIndex(w => w.includes('…'))
  const words = cut < 0 ? all : all.slice(0, cut)
  const from = words[0] === 'rtk' ? 2 : 1
  const sub = words.findIndex((w, i) => i >= from && /^[a-z][\w:-]*$/.test(w))
  const head = words.slice(0, Math.min(5, sub < 0 ? words.length : sub + 1))
  return head.length > 0 ? `Bash(${head.join(' ')}:*)` : 'Bash'
}

// ---------------------------------------------------------------- 0.6.0: git

export const DEFAULT_GIT: GitInfo = { folder: '', path: '', isRepo: false, branch: null, changes: 0, pr: null }

export const normalizeGit = (stored: unknown): GitInfo => {
  const g = normalize(DEFAULT_GIT, stored)
  return {
    folder: String(g.folder ?? ''),
    path: String(g.path ?? ''),
    isRepo: g.isRepo === true,
    branch: typeof g.branch === 'string' && g.branch !== '' ? g.branch : null,
    changes: typeof g.changes === 'number' && g.changes > 0 ? g.changes : 0,
    pr: typeof g.pr === 'number' && Number.isInteger(g.pr) && g.pr > 0 ? g.pr : null,
  }
}

/** A folder's name, its last path segment; the path itself when it has none (`/`). */
export const folderOf = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

/** A path with the home folder written `~`. */
export const tildePath = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path

/** How many files `git status --porcelain` lists. */
export const changeCount = (porcelain: string) => porcelain.split('\n').filter(l => l.trim() !== '').length

/**
 * The PR number `gh pr view --json number -q .number` printed. `gh` exits non-zero both when the branch has no
 * PR and when it could not ask (offline, signed out): either reads as no answer (undefined), which keeps the last
 * one for the same branch.
 */
export const prOf = (out: string | null): number | null | undefined => {
  if (out === null) return undefined
  const n = Number(out.trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

export const sameGit = (a: GitInfo, b: GitInfo) =>
  a.folder === b.folder && a.path === b.path && a.isRepo === b.isRepo && a.branch === b.branch && a.changes === b.changes && a.pr === b.pr

/** The rules the recent checks that were not allowed by a rule (asked, cleared, denied) would need, most frequent first. */
export const hotspots = (recent: readonly Check[], n = 3) => {
  const by = new Map<string, { rule: string; count: number; denied: number }>()
  for (const c of recent) {
    if (c.verdict === 'rule') continue
    const rule = allowRule(c)
    const h = by.get(rule) ?? { rule, count: 0, denied: 0 }
    by.set(rule, { ...h, count: h.count + 1, denied: h.denied + (c.verdict === 'deny' ? 1 : 0) })
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule)).slice(0, n)
}

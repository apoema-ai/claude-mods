import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentCard, Architect, Bucket, Check, FileTouch, Gate, GitInfo, Layout, LogLine, Loop, Main, Msg, Roster, TestRun, Turn, Usage, View } from '../types'
import {
  FIXED,
  MAIN_ID,
  PANELS,
  hiddenPanels,
  addRun,
  editsSince,
  failureLine,
  fmtAgo,
  noteFile,
  normalizeFiles,
  normalizeRuns,
  lastTested,
  parseTestRun,
  runCounts,
  runLabel,
  shortPath,
  chipsOf,
  sceneAt,
  stepScrub,
  withArchitect,
  addMsg,
  edgesOf,
  nodeName,
  normalizeMsgs,
  redact,
  resolveTo,
  DEFAULT_ARCHITECT,
  addCard,
  resumeCard,
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  SCHEMA_VERSION,
  afterCall,
  applyStep,
  bucketOf,
  cellWidth,
  piecesThatFit,
  cardLabel,
  cardTitle,
  afterCompactRead,
  claimCompactRead,
  contextFill,
  faultKey,
  forgetCompactRead,
  titleLines,
  wrapLines,
  consultTimeline,
  describeInput,
  endConsult,
  fmtClock,
  fmtDuration,
  fmtTimer,
  fmtUsd,
  plural,
  gateSummary,
  gauge,
  isAdvising,
  isLoopActive,
  kTokens,
  lanes,
  limitLabel,
  limitOf,
  fmtResetIn,
  fmtSpeed,
  listOf,
  logRows,
  logTally,
  splitFailure,
  slowBar,
  marksIn,
  momentOf,
  normalize,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  noteTool,
  PALETTES,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  settleCheck,
  shorten,
  startConsult,
  stepSpeed,
  stepLoop,
  effortLevel,
  hotspots,
  runway,
  slowest,
  DEFAULT_GIT,
  changeCount,
  folderOf,
  normalizeGit,
  prOf,
  sameGit,
  tildePath,
  midCut,
} from './core'
import type { Config, Panel } from './core'
import { PLAN_FAIL, PLAN_G_DEEP, PLAN_G_LIGHT, PLAN_G_MID, PLAN_H, crabSvg, effortSvg, flowSvg, meterSvg, mixHex, planSvg } from './draw'
import {
  ACT_ARGS,
  DONE_HOLD_MS,
  HOST_PLAN,
  HOST_WRAP,
  MIRRORED,
  NUDGE_AFTER,
  NUDGE_CONT,
  PLAN_TOOL_DEFAULT,
  STALE_AFTER,
  STALE_LOAD_MS,
  STATUSES,
  cut,
  doneCount,
  doneSummary,
  isStatus,
  nudgeNew,
  nudgeStale,
  oneLine,
  planLabel,
  planLine,
  planLineProps,
  planLines,
  planPrompt,
  shift,
  timed,
  took,
  withFrac,
} from './plan'
import type { Plan, PlanStep, Shift, StepIn } from './plan'
import type { Activity, BandPlan, PlanStatus } from '../types'

const PANE = 'chatdeck'
const TITLE = 'Chat Deck'


// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'chat-deck', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'chat-deck', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'chat-deck', key: 'usage' } as const, DEFAULT_USAGE)
const architect = atom({ plugin: 'chat-deck', key: 'architect' } as const, DEFAULT_ARCHITECT)
const gate = atom({ plugin: 'chat-deck', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'chat-deck', key: 'agents' } as const, [])
const loops = atom({ plugin: 'chat-deck', key: 'loops' } as const, [])
const log = atom({ plugin: 'chat-deck', key: 'log' } as const, [])
const comms = atom({ plugin: 'chat-deck', key: 'comms' } as const, [])
const turn = atom({ plugin: 'chat-deck', key: 'turn' } as const, DEFAULT_TURN)
const receipt = atom({ plugin: 'chat-deck', key: 'receipt' } as const, null)
const view = atom({ plugin: 'chat-deck', key: 'view' } as const, DEFAULT_VIEW)
const roster = atom({ plugin: 'chat-deck', key: 'roster' } as const, DEFAULT_ROSTER)
const runs = atom({ plugin: 'chat-deck', key: 'runs' } as const, [])
const files = atom({ plugin: 'chat-deck', key: 'files' } as const, [])
const git = atom({ plugin: 'chat-deck', key: 'git' } as const, DEFAULT_GIT)
/** 0.14.0: the skills the session has invoked, oldest first. */
const skills = atom({ plugin: 'chat-deck', key: 'skills' } as const, [])
const planAtom = atom({ plugin: 'chat-deck', key: 'plan' } as const, null)
const actAtom = atom({ plugin: 'chat-deck', key: 'planAct' } as const, null)

type ServerBlock = { type: string; id?: string; name?: string; tool_use_id?: string }

// Every read goes through these, so a value saved under an older shape still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getUsage($: EngineInterface): Promise<Usage> {
  return normalize(DEFAULT_USAGE, await read($, usage))
}
async function getArchitect($: EngineInterface): Promise<Architect> {
  const a = normalize(DEFAULT_ARCHITECT, await read($, architect))
  return { ...a, consults: listOf(a.consults), ids: listOf(a.ids), seen: listOf(a.seen) }
}
async function getGate($: EngineInterface): Promise<Gate> {
  return normalizeGate(await read($, gate))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getLoops($: EngineInterface): Promise<Loop[]> {
  return listOf<Loop>(await read($, loops))
}
async function getLog($: EngineInterface): Promise<LogLine[]> {
  return normalizeLog(await read($, log))
}
async function getMsgs($: EngineInterface): Promise<Msg[]> {
  return normalizeMsgs(await read($, comms))
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  return normalize(DEFAULT_VIEW, await read($, view))
}
async function getRoster($: EngineInterface): Promise<Roster> {
  const r = normalize(DEFAULT_ROSTER, await read($, roster))
  return { architectTypes: listOf(r.architectTypes) }
}
async function getRuns($: EngineInterface): Promise<TestRun[]> {
  return normalizeRuns(await read($, runs))
}
async function getFiles($: EngineInterface): Promise<FileTouch[]> {
  return normalizeFiles(await read($, files))
}
async function getSkills($: EngineInterface): Promise<string[]> {
  return listOf<unknown>(await read($, skills)).filter((s): s is string => typeof s === 'string')
}
async function getGit($: EngineInterface): Promise<GitInfo> {
  return normalizeGit(await read($, git))
}
/** The plan the panel draws, or null; anything not plan-shaped reads as none. */
async function getPlan($: EngineInterface): Promise<BandPlan | null> {
  const p = (await read($, planAtom)) as BandPlan | null | undefined
  return p && typeof p === 'object' && Array.isArray(p.steps) ? p : null
}
async function getPlanAct($: EngineInterface): Promise<Activity | null> {
  const x = (await read($, actAtom)) as Activity | null | undefined
  return x && typeof x === 'object' && typeof x.text === 'string' ? x : null
}

// ---------------------------------------------------------------- git (0.6.0, from the git-info mod)

// Between turns the panel polls: local git every 15 s, gh (a network call) once a minute or on a branch change.
const GIT_LOCAL_MS = 15_000
const GIT_PR_MS = 60_000

/** A command's trimmed output, or null when it failed or its binary is missing. */
async function runQuiet($: EngineInterface, argv: string[], timeoutMs = 5_000) {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

/** Reads the session folder's git state; `askGh` asks gh for the PR even when the last answer is fresh. */
async function readGit($: EngineInterface, prev: GitInfo, askGh: boolean, prAt: number, now: number): Promise<{ info: GitInfo; askedGh: boolean }> {
  const cwd = await $.session.cwd()
  // No HOME (a host that does not pass it) just leaves the path as it is.
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const base = { ...DEFAULT_GIT, folder: folderOf(cwd), path: tildePath(cwd, home) }
  if ((await runQuiet($, ['git', 'rev-parse', '--is-inside-work-tree'])) !== 'true') return { info: base, askedGh: false }
  const branch = (await runQuiet($, ['git', 'branch', '--show-current'])) || (await runQuiet($, ['git', 'rev-parse', '--short', 'HEAD'])) || null
  const changes = changeCount((await runQuiet($, ['git', 'status', '--porcelain'])) ?? '')
  const isSameBranch = prev.isRepo && prev.branch === branch
  if (!askGh && isSameBranch && now - prAt < GIT_PR_MS) return { info: { ...base, isRepo: true, branch, changes, pr: prev.pr }, askedGh: false }
  // gh asks the network: allow it longer, and keep the last answer for the same branch when it gives none.
  const pr = prOf(await runQuiet($, ['gh', 'pr', 'view', '--json', 'number', '-q', '.number'], 10_000))
  return { info: { ...base, isRepo: true, branch, changes, pr: pr === undefined ? (isSameBranch ? prev.pr : null) : pr }, askedGh: true }
}

// The panel's polling: one read at a time, written only when something changed (a write redraws the pane).
let gitBusy = false
let gitTimer = false
let prAt = 0

// The shared switch: "chat-deck": false in ~/.claude/mods/switches.json turns the mod off in every chat, which
// /chat-deck on|off writes. Off: the pane closes and will not open, the status line clears, the plan tool stands
// down, and no hook records anything. Polled, so a change reaches an open chat.
const SWITCH_MS = 3000
let isOff = false
let switchTimer = false

async function refreshGit($: EngineInterface, askGh = false) {
  if (isOff || gitBusy) return
  gitBusy = true
  try {
    const [prev, now] = await Promise.all([getGit($), $.clock.now()])
    const { info, askedGh } = await readGit($, prev, askGh, prAt, now)
    if (askedGh) prAt = now
    if (!sameGit(prev, info)) await update($, git, () => info)
  } finally {
    gitBusy = false
  }
}

/** A stored shape older than this build's: drop what cannot be read, keep the rest. */
async function migrate($: EngineInterface) {
  const m = await read($, meta)
  if ((m?.schemaVersion ?? 0) >= SCHEMA_VERSION) return
  await update($, log, list => normalizeLog(list))
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard))
  await update($, gate, g => normalizeGate(g))
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

/** One more comms message. When it pushes the oldest off the list, a look back moves one down with it, so it keeps its moment. */
async function pushMsg($: EngineInterface, msg: Msg) {
  let dropped = 0
  await update($, comms, list => {
    const prev = normalizeMsgs(list)
    const next = addMsg(prev, msg)
    dropped = prev.length + 1 - next.length
    return next
  })
  if (dropped > 0) {
    await update($, view, x => {
      const v = normalize(DEFAULT_VIEW, x)
      return typeof v.scrub === 'number' ? { ...v, scrub: Math.max(0, v.scrub - dropped) } : v
    })
  }
}

async function say($: EngineInterface, who: string, text: string, kind: LogLine['kind'] = 'info', agentId: string | null = null) {
  const line: LogLine = { at: await $.clock.now(), who, text, kind, agentId }
  await update($, log, list => [...normalizeLog(list), line].slice(-60))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (isOff) {
    $.ui.status(undefined)
    return
  }
  const [u, a, g, cards, rs, fs, p, vw] = await Promise.all([getUsage($), getArchitect($), getGate($), getCards($), getRuns($), getFiles($), getPlan($), getView($)])
  const running = cards.filter(c => c.status === 'running').length
  const s = gateSummary(g)
  const ctxFill = contextFill(u)
  const last = rs[rs.length - 1]
  const tested = lastTested(rs)
  const untested = tested ? editsSince(fs, tested.at) : 0
  const parts = [
    // The plan's progress is on the status line too, so it shows while the pane is closed.
    !hiddenPanels(vw.hidden).includes('plan') && p && p.shown && p.steps.length > 0 ? `plan ${doneCount(p.steps)}/${p.steps.length}` : null,
    ctxFill.pct !== null ? `ctx ${Math.round(ctxFill.pct)}%` : null,
    cards.length > 0 ? `agents ${running}/${cards.length}` : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${FIXED.architectLabel.toLowerCase()} ${isAdvising(a) ? 'advising' : a.consults.length}` : null,
    s.deny > 0 ? `denied ${s.deny}` : null,
    last ? `${runLabel(last)} ${last.isOk ? '✓' : `✗${last.failed > 0 ? ` ${last.failed}` : ''}`}` : null,
    untested > 0 ? `untested ${untested}` : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  $.ui.status(shown.length > 0 ? shown.join(' · ') : undefined)
}

async function whoIs($: EngineInterface, agentId: string | undefined) {
  if (!agentId) return 'main'
  const cards = await getCards($)
  const card = cards.find(c => c.id === agentId)
  return card ? shorten(cardLabel(card, cards), 14) : 'agent'
}

async function consultStarted($: EngineInterface, cfg: Config, id: string, via: string, startedAt?: number) {
  const t = await getTurn($)
  const moment = momentOf(t)
  const at = startedAt ?? (await $.clock.now())
  await update($, architect, a => startConsult(normalize(DEFAULT_ARCHITECT, a), { id, at, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalize(DEFAULT_TURN, x), isReviewing: true }))
  await say($, FIXED.architectLabel.toLowerCase(), FIXED.moments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
  await refreshStatus($, cfg)
}

async function consultEnded($: EngineInterface, cfg: Config, advice: string | null, id?: string, endedAt?: number) {
  const at = endedAt ?? (await $.clock.now())
  const first = advice?.split('\n').find(l => l.trim()) ?? null
  const text = first ? shorten(first.replace(/^[#>*\s-]+/, ''), 160) : null
  await update($, architect, a => endConsult(normalize(DEFAULT_ARCHITECT, a), at, text, id))
  await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), isReviewing: false }))
  // With no text to quote, the line still says something: how long the consult took.
  const ended = (await getArchitect($)).consults.filter(c => (id ? c.id === id : true) && c.endAt !== null).at(-1)
  const took = ended && ended.endAt !== null && ended.endAt - ended.at >= 1000 ? ` after ${fmtDuration(ended.endAt - ended.at)}` : ''
  await say($, FIXED.architectLabel.toLowerCase(), text ? `advice: ${shorten(text, 60)}` : `advice returned${took}`, 'consult')
  await refreshStatus($, cfg)
}

async function noteAdvice($: EngineInterface, cfg: Config, advice: string) {
  await update($, architect, x => ({ ...normalize(DEFAULT_ARCHITECT, x), lastAdvice: advice }))
  await say($, FIXED.architectLabel.toLowerCase(), `advice: ${shorten(advice, 60)}`, 'consult')
}

async function isArchitectType($: EngineInterface, cfg: Config, type: string) {
  return cfg.architect.test(type) || (await getRoster($)).architectTypes.includes(type)
}

async function openPane($: EngineInterface, cfg: Config) {
  if (isOff) return { isPlaced: false, reason: 'Chat Deck is off. Type /chat-deck on to turn it on.' } as never
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: cfg.paneColumns, rows: 8 })
}

const switchesFile = () => `${home}/.claude/mods/switches.json`

async function readSwitches($: EngineInterface): Promise<Record<string, unknown>> {
  try {
    if (!(await $.fs.exists(switchesFile()))) return {}
    const json = JSON.parse(String(await $.fs.read(switchesFile()))) as unknown
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
  } catch {
    // No file, or not JSON: nothing is switched off.
    return {}
  }
}

// On removes the key. False when the file cannot be written.
async function writeSwitch($: EngineInterface, on: boolean): Promise<boolean> {
  try {
    const json = await readSwitches($)
    if (on) delete json['chat-deck']
    else json['chat-deck'] = false
    await $.process.run(['mkdir', '-p', `${home}/.claude/mods`])
    await $.fs.write(switchesFile(), `${JSON.stringify(json, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

// Reads the shared switch and moves the mod to it: off closes the pane and clears the status line, on brings both back.
async function pollSwitch($: EngineInterface, cfg: Config) {
  const nowOff = (await readSwitches($))['chat-deck'] === false
  if (nowOff === isOff) return
  isOff = nowOff
  if (isOff) {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    $.ui.status(undefined)
  } else {
    await refreshStatus($, cfg)
    if (cfg.openOnStart) void openPane($, cfg).catch(() => undefined)
  }
  $.ui.invalidate('ui.render')
}

async function resetAll($: EngineInterface) {
  await update($, main, m => ({ ...DEFAULT_MAIN, model: normalize(DEFAULT_MAIN, m).model, mode: normalize(DEFAULT_MAIN, m).mode }))
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, gate, () => DEFAULT_GATE)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, log, () => [])
  await update($, comms, () => [])
  await update($, runs, () => [])
  await update($, files, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  // The panels you hid and whether their row is open are your choice, not session history: a reset keeps them.
  await update($, view, x => ({ ...DEFAULT_VIEW, hidden: hiddenPanels(normalize(DEFAULT_VIEW, x).hidden), panelsOpen: normalize(DEFAULT_VIEW, x).panelsOpen === true }))
  // The context gauge waits for the next measurement rather than showing the pre-clear fill.
  await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), pct: null, tokens: null, turnTokens: [] }))
}

/**
 * Stores the compaction window for the model window `window`. A `summary` breakdown estimates locally
 * and sends no request; until the host gives one, the gauge stays on the model's window (afterCompactRead).
 */
async function readCompactWindow($: EngineInterface, window: number) {
  const r = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  await update($, usage, x => afterCompactRead(normalize(DEFAULT_USAGE, x), window, r?.context.breakdown))
}

/** The session's cost read fresh, not from the last measurement: the receipt subtracts two of these. */
async function costNow($: EngineInterface): Promise<number | null> {
  const u = await $.session.usage().catch(() => null)
  return u?.cost?.usd ?? null
}

async function noteMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, main, m => (normalize(DEFAULT_MAIN, m).mode === mode ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), mode }))
}

// ---------------------------------------------------------------- plan (0.7.0, from plan-bar)

// The planner's working state lives here, not in atoms: the atoms hold only what the pane draws. Plain
// functions, not an object's methods: the hooks module hands `$` only to functions of its own.
// The config, set by `register` when `panels` lists `plan`; null leaves the plan off.
let planCfg: Config | null = null
  let home = ''
  let sessionId = ''
  let tool = PLAN_TOOL_DEFAULT
  let plan: Plan | null = null
  // True once the app's own task list has fed the plan: the plan tool then stands down, so no step is ticked twice.
  let hostSeen = false
  let activity: Activity | null = null
  // The tool call the activity line shows; a parallel call finishing first does not end it.
  let activityId = ''
  // The prompt's first line: the title of a plan whose list came without one (the app's list, TodoWrite).
  let promptTitle = ''
  // True once every step is done; a list with work left in it starts the next plan.
  let planDone = false
  let planShown = false
  let holdTimer: { cancel: () => void } | null = null
  // The plan nudge: main-chat tool calls this turn, and whether a plan came in.
  let turnCalls = 0
  let turnPlanned = false
  let nudged = false
  let sincePlan = 0
  let staleNudged = false
  let stateDirMade = false

  const planPath = () => `${home}/.claude/mods-state/plan-${sessionId}.json`

  async function planLog($: EngineInterface, line: string) {
    try {
      const dir = `${home}/.claude/mods-logs`
      const path = `${dir}/chat-deck.log`
      let old = ''
      if (await $.fs.exists(path).catch(() => false)) old = String(await $.fs.read(path))
      else await $.process.run(['mkdir', '-p', dir])
      await $.fs.write(path, `${old}${new Date().toISOString()} ${line}\n`)
    } catch {
      // Logging must never break the session.
    }
  }

  function toast($: EngineInterface, text: string) {
    try {
      $.ui.toast(cut(text, 140))
    } catch {
      // A toast is only a hint.
    }
  }

  function markPlanned() {
    turnPlanned = true
    sincePlan = 0
    staleNudged = false
  }

  async function writePlan($: EngineInterface) {
    if (!plan || !sessionId || !home) return
    try {
      if (!stateDirMade) {
        await $.process.run(['mkdir', '-p', `${home}/.claude/mods-state`])
        stateDirMade = true
      }
      const body = {
        title: plan.title,
        steps: plan.steps.map(st => ({
          text: st.text,
          status: st.status,
          ...(st.startedAt ? { startedAt: st.startedAt } : {}),
          ...(st.doneAt ? { doneAt: st.doneAt } : {}),
          ...(st.added ? { added: true } : {}),
          ...(st.active ? { active: st.active } : {}),
        })),
        startedAt: plan.startedAt,
        updatedAt: plan.updatedAt,
      }
      await $.fs.write(planPath(), `${JSON.stringify(body, null, 2)}\n`)
    } catch (err) {
      await planLog($, `write plan: ${String(err)}`)
    }
  }

  async function drawPlan($: EngineInterface) {
    const value: BandPlan | null = plan
      ? {
          title: plan.title,
          startedAt: Date.parse(plan.startedAt),
          steps: plan.steps.map(st => ({
            text: st.text,
            status: st.status,
            ...(st.added ? { added: true } : {}),
            ...(st.startedAt ? { startedAt: Date.parse(st.startedAt) } : {}),
            ...(st.doneAt ? { doneAt: Date.parse(st.doneAt) } : {}),
            ...(st.active ? { active: st.active } : {}),
          })),
          shown: planShown,
        }
      : null
    // The activity line is the plan's: it is written only while the plan shows, so bring it up to date now.
    if (planShown) await update($, actAtom, () => activity)
    await update($, planAtom, () => value)
    if (planCfg) await refreshStatus($, planCfg)
  }

  /** Takes a whole new list, keeps start and done times, toasts what just finished or failed, and saves. */
  async function applyPlan($: EngineInterface, title: string | undefined, incoming: StepIn[]) {
    const now = new Date(await $.clock.now()).toISOString()
    const allDone = incoming.length > 0 && incoming.every(st => st.status === 'completed')
    // A list with work left in it after a finished plan is a new plan.
    let old: PlanStep[] = plan && !(planDone && !allDone) ? plan.steps : []
    const used = new Set<number>()
    const hit: (PlanStep | undefined)[] = incoming.map(() => undefined)
    incoming.forEach((st, j) => {
      const i = old.findIndex((o, k) => !used.has(k) && (st.id ? o.id === st.id : o.text === st.text))
      if (i >= 0) {
        used.add(i)
        hit[j] = old[i]
      }
    })
    // A list that shares no step with the old plan is a new plan, not an update of it.
    const fresh = !plan || !hit.some(Boolean)
    if (fresh) old = []
    // Same length and some steps kept: a step with no match is the old one at its place, reworded.
    else if (incoming.length === old.length) {
      incoming.forEach((_, j) => {
        if (!hit[j] && !used.has(j)) {
          used.add(j)
          hit[j] = old[j]
        }
      })
    }
    const started = !fresh && old.some(st => st.status !== 'pending')
    const justDone: string[] = []
    const justFailed: string[] = []
    const steps: PlanStep[] = incoming.map((st, j) => {
      const was = hit[j]
      const step: PlanStep = { text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) }
      const active = st.active ?? (was?.text === st.text ? was.active : undefined)
      if (active) step.active = active
      // A retry keeps the step's first start, so its time counts the failed try too.
      if (was?.startedAt) step.startedAt = was.startedAt
      else if (st.status === 'in_progress') step.startedAt = now
      // A step with no match, joining a plan that has begun, was added late.
      if (was ? was.added : started) step.added = true
      if (st.status === 'completed') {
        step.doneAt = was?.status === 'completed' && was.doneAt ? was.doneAt : now
        if (was?.status !== 'completed' && !fresh) justDone.push(`${st.text}${took(timed(step))}`)
      }
      if (st.status === 'failed' && was?.status !== 'failed') justFailed.push(st.text)
      return step
    })
    // A finished step the new list left out stays done, at its old place, so the bar never goes backwards or reorders.
    if (!fresh)
      old.forEach((o, k) => {
        if (!used.has(k) && o.status === 'completed') steps.splice(Math.min(k, steps.length), 0, o)
      })
    const resized = !fresh && steps.length !== old.length
    const wasDone = planDone && !fresh
    const planStart = fresh || !plan ? now : plan.startedAt || now
    plan = { title: title?.trim() || (fresh ? promptTitle || 'Plan' : plan!.title), steps, startedAt: planStart, updatedAt: now }
    planDone = allDone
    if (!steps.length) planShown = false
    else if (allDone && !wasDone) {
      planShown = true
      toast($, `${doneSummary(steps.map(timed), Date.parse(now) - Date.parse(planStart))}.`)
      holdTimer?.cancel()
      holdTimer = $.clock.after(DONE_HOLD_MS, () => {
        holdTimer = null
        planShown = false
        void drawPlan($).catch(err => planLog($, `hide plan: ${String(err)}`))
      })
    } else if (!allDone) {
      planShown = true
      holdTimer?.cancel()
      holdTimer = null
      const notes = [
        ...(justFailed.length ? [`Failed: ${justFailed.join(', ')}`] : []),
        ...(justDone.length ? [`Done: ${justDone.join(', ')}`] : []),
        ...(resized ? [`Plan now has ${steps.length} steps (was ${old.length})`] : []),
      ]
      if (notes.length) toast($, notes.join(' · '))
    }
    await writePlan($)
    await drawPlan($)
  }

  /** `done`, `failed` and `next` change statuses in the open plan without resending it, so no step can be dropped or reworded by accident. */
  function deltaSteps(change: Shift): StepIn[] | string {
    if (!plan || planDone) return 'Plan not saved: there is no open plan to update. Send the whole list of steps first.'
    return shift(plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) })), change)
  }

  /** The plan tool's own call: check the input, save it, answer in one line. */
  async function planFromTool($: EngineInterface, args: Record<string, unknown>) {
    const raw = args.steps
    const delta = !Array.isArray(raw) && (Array.isArray(args.done) || Array.isArray(args.failed) || args.next === true)
    let steps: StepIn[] = []
    if (delta) {
      const r = deltaSteps({ done: args.done, failed: args.failed, next: args.next === true })
      if (typeof r === 'string') return r
      steps = r
    } else {
      if (!Array.isArray(raw)) return 'Plan not saved: send steps as a list of { text, status }, or { done: [step names] } or { next: true } to update the open plan.'
      for (const st of raw as unknown[]) {
        const o = (st && typeof st === 'object' ? st : {}) as Record<string, unknown>
        const text = typeof o.text === 'string' ? oneLine(o.text) : ''
        if (!text) return 'Plan not saved: every step needs its text.'
        if (!isStatus(o.status)) return `Plan not saved: "${cut(text, 40)}" needs a status of pending, in_progress, completed or failed.`
        steps.push({ text, status: o.status })
      }
    }
    if (steps.filter(st => st.status === 'in_progress').length > 1) return 'Plan not saved: only one step can be in_progress at a time.'
    if ((!plan || planDone) && steps.length > 1 && steps.every(st => st.status === 'completed'))
      return 'Plan not saved: a new plan starts with its steps pending and the first one in_progress, not all completed.'
    await applyPlan($, typeof args.title === 'string' ? oneLine(args.title) : undefined, steps)
    const now = delta ? steps.find(st => st.status === 'in_progress') : undefined
    return `Plan saved: ${doneCount(steps)} of ${steps.length} steps done.${now ? ` Now: ${now.text}.` : ''}`
  }

  /** The desktop app's list, TodoWrite, TaskCreate and TaskUpdate on the main chat feed the same plan. */
  async function mirror($: EngineInterface, name: string, args: Record<string, unknown>, r: unknown) {
    const res = (r as { result?: unknown; isError?: boolean; deny?: string } | undefined) ?? {}
    if (res.deny || res.isError) return
    // wrap_up checks the app's list off: every step still open is done (a failed one stays failed).
    if (name === HOST_WRAP) {
      if (!hostSeen || !plan || planDone) return
      await applyPlan($, undefined, plan.steps.map(st => ({ text: st.text, status: st.status === 'failed' ? 'failed' : 'completed', ...(st.id ? { id: st.id } : {}) })))
      return
    }
    // The desktop app's task list: { items } is the whole list; advance, done (numbers from 1) and start change it.
    if (name === HOST_PLAN) {
      hostSeen = true
      if (Array.isArray(args.items)) {
        const steps: StepIn[] = []
        for (const t of args.items as unknown[]) {
          const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
          const text = typeof o.content === 'string' ? oneLine(o.content) : ''
          if (text) steps.push({ text, status: isStatus(o.status) ? o.status : 'pending' })
        }
        await applyPlan($, undefined, steps)
        return
      }
      const steps = deltaSteps({ done: args.done, next: args.advance === true, start: args.start })
      if (typeof steps !== 'string') await applyPlan($, undefined, steps)
      return
    }
    if (name === 'TodoWrite') {
      const todos = Array.isArray(args.todos) ? (args.todos as unknown[]) : []
      const steps: StepIn[] = []
      for (const t of todos) {
        const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
        const text = typeof o.content === 'string' ? oneLine(o.content) : ''
        const active = typeof o.activeForm === 'string' && o.activeForm.trim() ? oneLine(o.activeForm) : undefined
        if (text) steps.push({ text, status: isStatus(o.status) ? o.status : 'pending', ...(active ? { active } : {}) })
      }
      await applyPlan($, undefined, steps)
      return
    }
    const current: StepIn[] = plan && !planDone ? plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) })) : []
    if (name === 'TaskCreate') {
      const text = typeof args.subject === 'string' ? oneLine(args.subject) : ''
      if (!text) return
      const out = (res.result ?? {}) as { task?: { id?: unknown } }
      const id = typeof out.task?.id === 'string' ? out.task.id : undefined
      await applyPlan($, undefined, [...current, { text, status: 'pending', ...(id ? { id } : {}) }])
      return
    }
    // TaskUpdate: find the task by its id; an unknown one with a subject joins the list.
    const id = typeof args.taskId === 'string' ? args.taskId : ''
    const all: StepIn[] = plan ? plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) })) : []
    const i = all.findIndex(st => st.id === id)
    const subject = typeof args.subject === 'string' ? oneLine(args.subject) : ''
    if (args.status === 'deleted') {
      if (i >= 0) await applyPlan($, undefined, all.filter((_, k) => k !== i))
      return
    }
    const status = isStatus(args.status) ? args.status : undefined
    if (i < 0) {
      if (subject) await applyPlan($, undefined, [...current, { text: subject, status: status ?? 'pending', id }])
      return
    }
    all[i] = { ...all[i]!, ...(subject ? { text: subject } : {}), ...(status ? { status } : {}) }
    await applyPlan($, undefined, all)
  }

  /** A reload or resume carries on with the plan this chat already saved. */
  async function loadPlan($: EngineInterface) {
    if (plan || !sessionId || !home) return
    try {
      if (!(await $.fs.exists(planPath()))) return
      const json = JSON.parse(String(await $.fs.read(planPath()))) as { title?: unknown; steps?: unknown; startedAt?: unknown; updatedAt?: unknown }
      const updatedAt = typeof json.updatedAt === 'string' ? json.updatedAt : ''
      // A plan left untouched for half a day belongs to work that was dropped: do not bring it back.
      if (!updatedAt || (await $.clock.now()) - Date.parse(updatedAt) > STALE_LOAD_MS) return
      const steps: PlanStep[] = (Array.isArray(json.steps) ? (json.steps as Record<string, unknown>[]) : [])
        .filter(st => st && typeof st.text === 'string' && isStatus(st.status))
        .map(st => ({
          text: String(st.text),
          status: st.status as PlanStatus,
          ...(typeof st.startedAt === 'string' ? { startedAt: st.startedAt } : {}),
          ...(typeof st.doneAt === 'string' ? { doneAt: st.doneAt } : {}),
          ...(st.added === true ? { added: true } : {}),
          ...(typeof st.active === 'string' && st.active ? { active: st.active } : {}),
        }))
      plan = {
        title: typeof json.title === 'string' && json.title ? json.title : 'Plan',
        steps,
        startedAt: typeof json.startedAt === 'string' ? json.startedAt : updatedAt,
        updatedAt,
      }
      planDone = steps.length > 0 && steps.every(st => st.status === 'completed')
      planShown = steps.length > 0 && !planDone
      await drawPlan($)
    } catch (err) {
      await planLog($, `load plan: ${String(err)}`)
    }
  }

  /** "Bash: mvn test -pl core", "Edit: register.tsx": the main chat's last call, for the line under the bar. */
  async function startActivity($: EngineInterface, id: string, name: string, args: Record<string, unknown>) {
    const shown = name.startsWith('mcp__') ? name.split('__').slice(1).join(': ') : name
    const key = ACT_ARGS.find(k => typeof args[k] === 'string' && args[k])
    const raw = key ? oneLine(String(args[key])) : ''
    const arg = key === 'file_path' || key === 'notebook_path' || key === 'path' ? (raw.split('/').pop() ?? raw) : raw
    activityId = id
    activity = { text: arg ? `${shown}: ${cut(arg, 60)}` : shown, at: await $.clock.now(), running: true, failed: false }
    // Written only while a plan shows: no plan, no line, no redraw.
    if (planShown) await update($, actAtom, () => activity)
  }

  /** The call the line shows has returned: it stops counting, and says so when it failed. */
  async function endActivity($: EngineInterface, id: string, r: unknown) {
    if (!activity || id !== activityId) return
    const res = (r ?? {}) as { isError?: boolean; deny?: string }
    activity = { ...activity, running: false, failed: !!(res.isError || res.deny) }
    if (planShown) await update($, actAtom, () => activity)
  }

  // A short reminder after a tool's result, read by the model only.
  function withNudge<R>(r: R): R {
    turnCalls++
    sincePlan++
    const live = !!plan && !planDone && plan.steps.length > 0
    let note: string | null = null
    if (!turnPlanned && !nudged && turnCalls >= NUDGE_AFTER) {
      nudged = true
      note = live ? NUDGE_CONT : nudgeNew(tool)
    } else if (live && !staleNudged && sincePlan >= STALE_AFTER) {
      staleNudged = true
      note = nudgeStale(tool)
    }
    if (!note || !r || typeof r !== 'object' || 'deny' in (r as object)) return r
    const had = (r as { context?: readonly string[] }).context ?? []
    return { ...r, context: [...had, note] }
  }

/** session.start: where the plan file lives, the tool, and a recent saved plan. */
async function planStart($: EngineInterface) {
      home = (await $.env.get('HOME').catch(() => undefined)) || ($.plugin.root.split('/.claude/')[0] ?? '')
      sessionId = await $.session.id().catch(() => '')
      const reg = await $.tool
        .register({
          name: 'plan',
          // The same rules as the prompt section: another plugin can skip prompt.compose, and the tool description always reaches the model.
          description:
            'Save the plan for the job in front of you: the steps in order, each pending, in_progress, completed or failed. ' +
            `It draws the plan panel in the Chat Deck pane for the user. ${planPrompt(tool)}`,
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'A short name for the job, a few words.' },
              done: {
                type: 'array',
                items: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
                description: 'After the first call: steps that are now finished, by number (from 1) or exact name.',
              },
              failed: {
                type: 'array',
                items: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
                description: 'After the first call: steps whose check failed (a test run, a build), by number (from 1) or exact name.',
              },
              next: { type: 'boolean', description: 'After the first call: true finishes the step in progress and starts the next pending one.' },
              steps: {
                type: 'array',
                description: 'Every step, in order. Send it first, and again only when the plan changes.',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', description: 'The step in a few plain words.' },
                    status: { type: 'string', enum: [...STATUSES] },
                  },
                  required: ['text', 'status'],
                },
              },
            },
          },
          // In front, not behind ToolSearch: a hidden tool never gets called.
          isDeferred: false,
        })
        .catch(err => {
          void planLog($, `register plan tool: ${String(err)}`)
          return null
        })
      if (reg && typeof reg.tool === 'string' && reg.tool) tool = reg.tool
      await loadPlan($)
}

/** The plan tool's own call, answered here (nothing beneath runs it). */
async function planCall($: EngineInterface, args: Record<string, unknown>, agentId: string | undefined): Promise<string> {
      if (agentId) return 'Only the main chat keeps a plan. Carry on with your task.'
      // Both lists ticking one plan would finish a step twice: the app's list wins.
      if (hostSeen) return `Not saved: the plan follows your ${HOST_PLAN} list. Keep that one up to date instead of this tool.`
      // Marked on the way in: a call sent beside this one in the same message may return first, and must not be nudged.
      markPlanned()
      try {
        return await planFromTool($, args)
      } catch (err) {
        await planLog($, `plan: ${String(err)}`)
        return 'Plan not saved: something went wrong. Carry on.'
      }
}

/**
 * Any other main-chat call, around `run` (the rest of the chain): a task list is mirrored, any other call
 * feeds the activity line and may carry a nudge.
 */
async function planAround<R>($: EngineInterface, name: string, args: Record<string, unknown>, useId: string, run: () => Promise<R>): Promise<R> {
      if (MIRRORED.has(name)) {
        markPlanned()
        const r = await run()
        void mirror($, name, args, r).catch(err => planLog($, `mirror ${name}: ${String(err)}`))
        return r
      }
      // Awaited, so a fast call cannot end before its start is recorded.
      await startActivity($, useId, name, args).catch(err => planLog($, `activity: ${String(err)}`))
      const r = await run()
      void endActivity($, useId, r).catch(err => planLog($, `activity: ${String(err)}`))
      return withNudge(r)
}

/** A new prompt is a new task: the nudge counts from zero, and its first line may title the plan. */
function planPromptSubmitted(e: { text: string; command?: unknown; isMeta?: unknown; turnId?: unknown }) {
      // The person's own prompt that opens a turn, not a slash command, a hidden prompt or a note typed into a running turn.
      const first = oneLine(e.text.split('\n').find(l => l.trim()) ?? '')
      if (first && !e.command && !e.isMeta && !e.turnId) promptTitle = cut(first, 40)
      turnCalls = 0
      turnPlanned = false
      nudged = false
      sincePlan = 0
      staleNudged = false
}

/** /clear and /chat-deck reset: the next plan starts from nothing. The saved file stays for chat-inventory. */
async function planReset($: EngineInterface) {
      holdTimer?.cancel()
      holdTimer = null
      plan = null
      planDone = false
      planShown = false
      hostSeen = false
      activity = null
      await update($, planAtom, () => null)
      await update($, actAtom, () => null)
      sessionId = await $.session.id().catch(() => sessionId)
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()
  // Git and the plan always work: switching their panels off hides the drawing, not the tool or the polling.
  const hasGit = true
  planCfg = cfg
  const planner = true

  on('session.start', async ($, e, next) => {
    if (planner) await planStart($).catch(() => undefined)
    await pollSwitch($, cfg).catch(() => undefined)
    if (!switchTimer) {
      switchTimer = true
      $.clock.every(SWITCH_MS, () => void pollSwitch($, cfg).catch(() => undefined))
    }
    await $.command.register({
      name: 'chat-deck',
      description: 'Chat Deck, the live agent dashboard: open, close, reset, set the layout, or turn the mod on or off in every chat',
      argumentHint: '[close|reset|layout auto|compact|wide|mini|on|off|status]',
    })
    await migrate($)
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    // A resumed session has a fill to draw already: its compaction window is read now, not at its first
    // measurement. Any other start forgets the last reading (the setting may have changed) for that one to read.
    const resumedWindow = u && u.context.tokens !== undefined && u.context.window > 0 ? u.context.window : 0
    if (u) {
      await update($, usage, x => ({
        ...normalize(DEFAULT_USAGE, x),
        pct: u.context.percent ?? null,
        tokens: u.context.tokens ?? null,
        window: u.context.window,
        compactFor: resumedWindow,
        compactMisses: 0,
        costUsd: u.cost?.usd ?? null,
        limits: u.rateLimits.map(limitOf),
      }))
    }
    if (cfg.openOnStart) void openPane($, cfg).catch(() => undefined)
    await refreshStatus($, cfg)
    const done = await next(e)
    if (hasGit) {
      if (!gitTimer) {
        gitTimer = true
        $.clock.every(GIT_LOCAL_MS, () => void refreshGit($).catch(() => undefined))
      }
      await refreshGit($, true).catch(() => undefined)
    }
    if (resumedWindow > 0) {
      await readCompactWindow($, resumedWindow)
      await refreshStatus($, cfg)
    }
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAll($)
      if (planner) await planReset($)
      await refreshStatus($, cfg)
    }
    return next(e)
  })

  on('command.run', { command: 'chat-deck' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    // on and off switch the mod in every chat; status says which; the rest work only while it is on. Plain /chat-deck opens the pane.
    if (verb === 'status') return { text: `Chat Deck is ${isOff ? 'off' : 'on'}. Type /chat-deck ${isOff ? 'on' : 'off'} to turn it ${isOff ? 'on' : 'off'}.` }
    if (verb === 'on' || verb === 'off') {
      if (!(await writeSwitch($, verb === 'on'))) return { text: 'Chat Deck: could not write ~/.claude/mods/switches.json, so nothing changed.' }
      await pollSwitch($, cfg)
      return { text: verb === 'on' ? 'Chat Deck is on.' : 'Chat Deck is off in every chat. Type /chat-deck on to turn it on again.' }
    }
    if (isOff) return { text: 'Chat Deck is off. Type /chat-deck on to turn it on.' }
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Chat Deck closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      if (planner) await planReset($)
      await refreshStatus($, cfg)
      return { text: 'Chat Deck reset.' }
    }
    if (verb === 'layout') {
      const layout: Layout | null = arg === 'compact' || arg === 'wide' || arg === 'auto' || arg === 'mini' ? arg : null
      if (!layout) return { text: 'Usage: /chat-deck layout auto|compact|wide|mini' }
      await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
      const opened = await openPane($, cfg)
      return { text: opened.isPlaced ? `Chat Deck layout: ${layout}.` : `Layout set to ${layout}; the pane is not shown yet: ${opened.reason}` }
    }
    if (verb) return { text: 'Usage: /chat-deck [close|reset|layout auto|compact|wide|mini|on|off|status]' }
    const opened = await openPane($, cfg)
    if (!opened.isPlaced) return { text: `Chat Deck is not shown yet: ${opened.reason}` }
    return { text: 'Chat Deck opened. Focus it with ctrl+x tab: number keys expand cards, f/s/o open the gate rows, b/n/l replay the comms message by message.' }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (isOff) return next(e)
    await noteMode($, e.permission_mode)
    return next(e)
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the prompt still goes through

  // A new prompt is a new task for the plan nudge; its first line titles a plan whose list has none.
  on('prompt.submit', async (_, e, next) => {
    if (planner && !isOff) planPromptSubmitted(e)
    return next(e)
  }).catch(async (_, e, next) => next(e)) // only records: if it fails, the message still goes through

  // The plan rules as a short system-prompt section. Another plugin may skip this hook, so the tool's
  // description carries the same rules.
  on('prompt.compose', async (_, e, next) => {
    const r = await next(e)
    if (!planner || isOff || e.traits.includes('teammate') || e.traits.includes('bare')) return r
    return { sections: [...r.sections, { id: 'chat-deck:plan', text: planPrompt(tool), scope: 'session' as const }] }
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (!isOff && cfg.architect.test(e.agent)) {
      await update($, roster, r => {
        const x = normalize(DEFAULT_ROSTER, r)
        return x.architectTypes.includes(e.agent) ? x : { architectTypes: [...listOf<string>(x.architectTypes), e.agent].slice(-20) }
      })
    }
    return offered
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the offer is unchanged

  on('turn.start', async ($, e, next) => {
    // A subagent's turn (its spawn, or a resume by SendMessage) is its card's, not the main turn's.
    if (isOff || e.agentId !== undefined) return next(e)
    const [now, cost] = await Promise.all([$.clock.now(), costNow($)])
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now, costAtStart: cost }))
    // The context at each turn's start feeds the runway estimate.
    await update($, usage, x => {
      const u = normalize(DEFAULT_USAGE, x)
      return u.tokens === null ? u : { ...u, turnTokens: [...listOf<number>(u.turnTokens), u.tokens].slice(-4) }
    })
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    // A background architect's report reaches the main loop as the text opening this turn. The
    // SubagentHandback tool call (in tool.call) normally carries it first; this is the fallback.
    const back = e.text ? handbackOf(e.text) : null
    const a = back ? await getArchitect($) : null
    if (back && a && a.ids.includes(back.from)) {
      const advice = adviceLine(back.body)
      if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
    } else if (e.text) {
      const p = promptLine(e.text)
      await say($, p.who, p.text)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (isOff) return yield* next(e)
    // The main loop's model is known when its request starts; a long first request shouldn't read "—".
    if (!e.agentId) {
      let isNewModel = false
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        isNewModel = x.model !== '' && x.model !== e.model
        return { ...x, model: e.model, effort: String(e.effort ?? x.effort), steps: x.steps + 1 }
      })
      if (isNewModel) await update($, usage, x => forgetCompactRead(normalize(DEFAULT_USAGE, x)))
      // Time the response as it passes: its first piece that is neither the engine's envelope nor the
      // stop. One clock read in the stream and nothing stored until it has ended.
      const sentAt = await $.clock.now()
      let firstAt: number | null = null
      const s = next(e)
      for await (const c of s) {
        if (firstAt === null && c.kind !== 'engine' && c.kind !== 'stop') firstAt = await $.clock.now()
        yield c
      }
      const result = await s.result
      const speed = result.usage ? stepSpeed(sentAt, firstAt) : null
      if (speed) await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), speed }))
      // Server tools (the advisor) the API ran in this request. The session.append path reads them too
      // where it is delivered; `seen` keeps either path from counting one twice.
      for (const use of result.serverToolUses ?? []) {
        if (!cfg.architect.test(use.name) || (await getArchitect($)).seen.includes(use.id)) continue
        await update($, architect, x => {
          const y = normalize(DEFAULT_ARCHITECT, x)
          return { ...y, seen: [...listOf<string>(y.seen), use.id].slice(-60) }
        })
        await consultStarted($, cfg, use.id, `${use.name} tool`, use.startedAt)
        await consultEnded($, cfg, null, use.id, use.endedAt)
      }
      return result
    }
    const id = e.agentId
    // A step from an agent whose card finished means it was resumed (SendMessage): it runs again.
    const before = (await getCards($)).find(c => c.id === id)
    if (before && before.status !== 'running') {
      // Flipped in the write: a resume its agent.spawn already logged is not logged again.
      let isResumed = false
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => {
            if (c.id !== id || c.status === 'running') return c
            isResumed = true
            return resumeCard(c)
          }),
      )
      if (isResumed) {
        await say($, await whoIs($, id), 'resumed', 'info', id)
        await refreshStatus($, cfg)
      }
    }
    const result = yield* next(e)
    const [cards, a] = await Promise.all([getCards($), getArchitect($)])
    if (cards.some(c => c.id === id)) {
      const step = { model: e.model, usage: result.usage, stopReason: result.stopReason }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
      if (result.stopReason === 'max_tokens') await say($, await whoIs($, id), 'hit max_tokens', 'error', id)
    } else if (!a.ids.includes(id)) {
      const now = await $.clock.now()
      await update($, loops, l => stepLoop(listOf<Loop>(l), id, now))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (isOff) return next(e)
    // The compaction window is read once per model window, not on every measurement (a breakdown
    // estimates every category each time): claimed here, in the same write, so no two reads overlap.
    let isStale = false
    await update($, usage, x => {
      const claim = claimCompactRead(normalize(DEFAULT_USAGE, x), e.context.window)
      isStale = claim.isClaimed
      return {
        ...claim.usage,
        pct: e.context.percent ?? null,
        tokens: e.context.tokens ?? null,
        window: e.context.window,
        costUsd: e.cost?.usd ?? null,
        limits: e.rateLimits.map(limitOf),
      }
    })
    if (e.changed.includes('context')) await refreshStatus($, cfg)
    const done = await next(e)
    if (isStale) {
      await readCompactWindow($, e.context.window)
      await refreshStatus($, cfg)
    }
    return done
  })

  on('session.compact', async ($, e, next) => {
    if (isOff) return next(e)
    const done = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') {
      const now = await $.clock.now()
      await update($, usage, x => {
        const u = normalize(DEFAULT_USAGE, x)
        // The growth before a compaction says nothing about the context after it.
        return { ...u, compactions: u.compactions + 1, lastCompactAt: now, turnTokens: [] }
      })
      await say($, 'main', `context compacted (${e.trigger})`)
    }
    return done
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the compaction still goes ahead

  on('tool.check', async ($, e, next) => {
    if (isOff) return next(e)
    const verdict = await next(e)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
      // The status line updates when the call settles; only a refusal ends here.
      if (verdict.decision === 'deny') {
        await say($, 'gate', `denied by rule · ${check.detail}`, 'error')
        await refreshStatus($, cfg)
      }
    }
    return verdict
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the permission verdict is the one beneath

  on('tool.call', async ($, e, next) => {
    // Off: the plan tool, which cannot be unregistered, says so; every other call goes straight through.
    if (isOff) return String(e.tool) === tool ? ({ result: 'Chat Deck is off, so the plan is not kept. Tell the user to type /chat-deck on to turn it on.' } as never) : next(e)
    const name = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    // The plan tool is answered here: nothing beneath runs it.
    if (planner && name === tool) return { result: await planCall($, args, e.agentId) } as never
    // A subagent's calls are its own: no task-list mirror, no activity line, no nudge.
    if (!planner || e.agentId) return record()
    return planAround($, name, args, e.tool_use_id, record)

    // Every call's own record: the gate, the cards, edits, test runs and the log.
    async function record() {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    const calledAt = await $.clock.now()
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
    const didRun = ran.deny === undefined
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const g0 = await getGate($)
    const isSettled = settleCheck(g0, e.tool_use_id, didRun) !== g0
    if (isSettled) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    // A background agent hands its report back through this tool; an architect's report is its advice.
    if (String(e.tool) === 'SubagentHandback') {
      const message = (e as unknown as { message?: unknown }).message
      const a = e.agentId ? await getArchitect($) : null
      if (a && e.agentId && a.ids.includes(e.agentId) && typeof message === 'string') {
        const advice = adviceLine(message)
        if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
      }
      return ran
    }
    // A skill the main chat invoked stays listed in the main card for the session.
    const skillName = String((e as unknown as { skill?: unknown }).skill ?? '').trim()
    if (e.tool === 'Skill' && didRun && !e.agentId && skillName) {
      await update($, skills, s => {
        const l = listOf<string>(s)
        return l.includes(skillName) ? l : [...l, skillName].slice(-20)
      })
    }
    if (e.tool === 'Agent') {
      if (isSettled) await refreshStatus($, cfg)
      return ran
    }
    const hasFailed = didRun && ran.isError === true
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    const t0 = await getTurn($)
    if (isEdit || hasFailed || (!e.agentId && t0.errorStreak > 0)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    const text = shorten(describeInput(e.tool, e), 64)
    const now = await $.clock.now()
    // Among the turn's slowest? Written only when it is, so a quick call costs no redraw.
    const call = { text: shorten(describeInput(e.tool, e), 48), ms: now - calledAt }
    // AskUserQuestion's time is the user's answer, not a slow call.
    if (e.tool !== 'AskUserQuestion' && slowest(t0.slow ?? [], call) !== (t0.slow ?? [])) {
      await update($, turn, t => {
        const x = normalize(DEFAULT_TURN, t)
        return { ...x, slow: slowest(x.slow ?? [], call) }
      })
    }
    const input = e as unknown as { file_path?: unknown; notebook_path?: unknown; command?: unknown; run_in_background?: unknown }
    // A background command's output is not in its result yet: it says nothing about the run.
    const run = e.tool === 'Bash' && didRun && input.run_in_background !== true ? parseTestRun(String(input.command ?? ''), ran.text ?? '', ran.isError === true) : null
    // A run can fail with exit 0 (`mvn test | tail`): its reason is read from the output either way.
    const why = hasFailed || (run && !run.isOk) ? failureLine(ran.text) : ''
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? noteTool(c, { tool: e.tool, text: why ? `${text} · ${why}` : text, isError: hasFailed || ran.deny !== undefined }) : c)),
      )
    }
    const path = String(input.file_path ?? input.notebook_path ?? '')
    if (isEdit && path) await update($, files, list => noteFile(normalizeFiles(list), { path, by: e.agentId ?? MAIN_ID, at: now }))
    if (run) {
      const r: TestRun = { ...run, at: now, by: e.agentId ?? MAIN_ID, command: shorten(redact(String(input.command)), 120), reason: run.isOk ? '' : why }
      await update($, runs, list => addRun(normalizeRuns(list), r))
      await say($, await whoIs($, e.agentId), `${run.isOk ? '✓' : '✗'} ${runCounts(r)}${why ? ` · ${why}` : ''}`, run.isOk ? 'done' : 'error', e.agentId ?? null)
    }
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    if (ran.deny !== undefined) await say($, await whoIs($, e.agentId), `${text}  denied`, 'error', e.agentId ?? null)
    // Always `✗ <reason> · <call>`, so the log draws the reason and the call apart, with one mark (0.8.0).
    else if (hasFailed && !run) await say($, await whoIs($, e.agentId), `✗ ${why || 'failed, no output'} · ${text}`, 'error', e.agentId ?? null)
    else if (isEdit) await say($, await whoIs($, e.agentId), text, 'info', e.agentId ?? null)
    if (isSettled || !didRun || isEdit || run) await refreshStatus($, cfg)
    return ran
    }
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the call goes to the tool beneath

  // A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
  on('session.append', async ($, e, next) => {
    if (!isOff && !e.agentId && e.message.type === 'assistant') {
      const a = await getArchitect($)
      // Consults this row opened: their result may be in the same row, after the stale read above.
      const opened = new Set<string>()
      for (const block of e.message.content as unknown as readonly ServerBlock[]) {
        if (block.type === 'server_tool_use' && block.name && block.id && cfg.architect.test(block.name)) {
          if (a.seen.includes(block.id)) continue
          const id = block.id
          await update($, architect, x => {
            const y = normalize(DEFAULT_ARCHITECT, x)
            return { ...y, seen: [...listOf<string>(y.seen), id].slice(-60) }
          })
          opened.add(id)
          await consultStarted($, cfg, id, `${block.name} tool`)
        } else if (block.type.endsWith('_tool_result') && block.tool_use_id) {
          const id = block.tool_use_id
          const isOpen = opened.has(id) || (await getArchitect($)).consults.some(c => c.id === id && c.endAt === null)
          if (isOpen) await consultEnded($, cfg, null, id)
        }
      }
    }
    return next(e)
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the row is still appended

  on('agent.spawn', async ($, e, next) => {
    if (isOff) return next(e)
    const started = await next(e)
    if (!e.parentAgentId) await noteMode($, e.permissionMode)
    if (started.deny !== undefined || !started.agentId) return started
    const id = started.agentId
    if (await isArchitectType($, cfg, e.subagentType)) {
      await update($, architect, a => {
        const x = normalize(DEFAULT_ARCHITECT, a)
        return { ...x, ids: [...listOf<string>(x.ids), id].slice(-40) }
      })
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
      await consultStarted($, cfg, id, e.subagentType.split(':').pop() ?? 'agent')
      const askedAt = await $.clock.now()
      await pushMsg($, { at: askedAt, from: e.parentAgentId ?? MAIN_ID, to: id, kind: 'prompt', text: shorten(redact(e.prompt), 160) })
      return started
    }
    const card: AgentCard = {
      ...normalizeCard({}),
      id,
      type: e.name ?? e.subagentType,
      model: started.model,
      description: e.description,
      prompt: redact(e.prompt).trim().slice(0, 2000),
      spawnedAt: await $.clock.now(),
    }
    // Decided in the write: a resume whose first step already put its card back to running is not logged again.
    let isNew = true
    let isResumed = false
    await update($, agents, list => {
      const cards = listOf<unknown>(list).map(normalizeCard)
      const known = cards.find(c => c.id === id)
      isNew = known === undefined
      isResumed = known !== undefined && known.status !== 'running'
      return addCard(cards, card)
    })
    await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
    // The prompt is the first thing the parent says to this agent; a resume says one more.
    await pushMsg($, { at: card.spawnedAt, from: e.parentAgentId ?? MAIN_ID, to: id, kind: 'prompt', text: shorten(redact(e.prompt), 160) })
    if (isNew || isResumed) await say($, shorten(cardLabel(card, await getCards($)), 12),isNew ? `spawned · ${card.type}` : 'resumed', 'info', id)
    await refreshStatus($, cfg)
    return started
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the agent still starts

  // A SendMessage between loops: kept once it was delivered, with its credentials masked.
  on('session.send', async ($, e, next) => {
    if (isOff) return next(e)
    const sent = await next(e)
    if (!sent.isDelivered) return sent
    const loopsHere = withArchitect(await getCards($), await getArchitect($), FIXED.architectLabel.toLowerCase())
    const msg: Msg = { at: await $.clock.now(), from: e.agentId ?? MAIN_ID, to: resolveTo(e.to, loopsHere), kind: 'message', text: shorten(redact(e.text), 160) }
    await pushMsg($, msg)
    return sent
  }).catch(async ($, e, next) => next(e)) // only records: if it fails, the message is still sent

  on('turn.complete', async ($, e, next) => {
    if (isOff) return next(e)
    const done = await next(e)
    const id = e.agentId
    const now = await $.clock.now()
    if (!id) {
      const [t, cards, cost] = await Promise.all([getTurn($), getCards($), costNow($)])
      const r = receiptOf(t, {
        durationMs: e.durationMs,
        agentsSince: cards.filter(c => c.spawnedAt >= t.startedAt).length,
        costNow: cost,
        reason: e.reason,
      })
      await update($, receipt, () => r)
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      await refreshStatus($, cfg)
      // A turn may have switched branches, committed or opened a PR.
      if (hasGit) await refreshGit($, true).catch(() => undefined)
      return done
    }
    if ((await getArchitect($)).ids.includes(id)) {
      await consultEnded($, cfg, e.answer, id)
      return done
    }
    const cards = await getCards($)
    if (cards.some(c => c.id === id)) {
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? { ...c, status, endedAt: now, answer: shorten(e.answer, 400) } : c)),
      )
      // This run's own length: a resumed agent's card clock also spans the idle time between runs.
      const took = fmtDuration(e.durationMs)
      await say($, await whoIs($, id), status === 'done' ? `done · ${took}` : status, status === 'done' ? 'done' : 'error', id)
    } else {
      await update($, loops, l => listOf<Loop>(l).map(x => (x.id === id ? { ...x, isDone: true, lastAt: now } : x)))
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- drawing

  // After a surface module faults on a surface, this load draws it there as plain text; the other
  // module, and other surfaces, keep theirs. Keyed by faultKey: `desktop:rail.tsx`.
  const faulted = new Set<string>()
  on('ui.fault', async ($, e, next) => {
    const key = faultKey(e.surface, e.module)
    if (e.requestId === PANE && !faulted.has(key)) {
      faulted.add(key)
      $.ui.log(`chat-deck: ${e.module} faulted on ${e.surface} (${e.phase}: ${e.reason}); drawing it without animation`)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const hasClient = 'Client' in els
    const hasRail = hasClient && !faulted.has(faultKey(e.surface, 'rail.tsx'))
    const hasClock = hasClient && !faulted.has(faultKey(e.surface, 'elapsed.tsx'))
    const [m, u, a, g, cards, lp, lines, msgs, t, r, v, now, rs, fs, gi, storedPlan, planAct, skillNames] = await Promise.all([
      getMain($),
      getUsage($),
      getArchitect($),
      getGate($),
      getCards($),
      getLoops($),
      getLog($),
      getMsgs($),
      getTurn($),
      read($, receipt),
      getView($),
      $.clock.now(),
      getRuns($),
      getFiles($),
      getGit($),
      getPlan($),
      getPlanAct($),
      getSkills($),
    ])
    // The step in progress fills by its time against the finished steps', measured now.
    const pl = storedPlan && storedPlan.shown && storedPlan.steps.length > 0 ? withFrac(storedPlan, now) : null
    // The body's own width, down to the narrowest dock Claude Code seats (24): a wider drawing is cut off at the frame.
    const W = Math.max(24, e.props.bodyColumns)
    const layout = v.layout ?? cfg.layout
    const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const modelName = prettyModel(m.model)
    const viewed = e.props.view?.agentId ?? null
    const advising = isAdvising(a)
    const running = cards.filter(c => c.status === 'running')
    const showArchitect = a.consults.length > 0 || a.ids.length > 0
    const motion = FIXED.motion && hasRail
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const isEmpty: Record<Panel, boolean> = {
      main: false,
      plan: pl === null,
      git: gi.folder === '',
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      // While a turn runs its clock and counts are on the main card; this one shows only where its time went.
      receipt: m.isRunning ? !(((t.slow ?? []).length > 0) || t.isReviewing) : !r,
      checks: rs.length === 0,
      files: fs.length === 0,
      comms: msgs.length === 0,
      log: false,
    }
    const hidden = hiddenPanels(v.hidden)
    const panels = PANELS.filter(p => !hidden.includes(p) && !isEmpty[p])
    // Who cleared an ask: unknown when the prompt event that carries the mode is not delivered.
    const decider = m.mode === 'auto' ? 'classifier' : m.mode ? 'you' : 'cleared'
    const lastRun = rs[rs.length - 1]
    const tested = lastTested(rs)
    const untested = tested ? editsSince(fs, tested.at) : 0

    // A connector between panels: animated while its flow is live, a dim line otherwise.
    const rail = (key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false) =>
      motion ? (
        <els.Client
          key={key}
          module="./rail.tsx"
          width={width}
          height={1}
          props={{ active, width, color, dim: C.faint, marks, isMerge }}
        />
      ) : (
        <Text color={C.faint} mono>
          {'─'.repeat(Math.max(1, width))}
        </Text>
      )

    // A start time of 0 is unknown (state saved before it was recorded): no clock, not decades.
    const clock = (key: string, since: number, endAt: number | null, color: string) =>
      since <= 0 ? (
        <Text color={color}>—</Text>
      ) : hasClock ? (
        <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
      )

    const isTerminal = e.surface === 'terminal'
    // Svg draws on desktop, the editor and mobile; the terminal keeps its glyphs.
    const Svg = !isTerminal && 'Svg' in els ? els.Svg : null
    // A row of marks (gate checks, loop dots), sized by `marksIn`. Should a surface draw them wider
    // still, the row is cut at its box rather than running past it.
    const markRow = (marks: RenderChildren, lead = 0) => (
      <Box overflow="hidden" {...(lead ? { marginLeft: lead } : {})}>
        <Text wrap="truncate-start">{marks}</Text>
      </Box>
    )
    // A terminal's border row stands apart from the text above it; a graphical surface draws the
    // border flush against it, so the header keeps one row of air there.
    const legendGap = isTerminal ? 0 : 1

    // Long text wraps to a few rows instead of ending in an ellipsis; the row budget counts the rows it takes.
    const WRAP_COMMS = 2
    const WRAP_LOG = 2
    const WRAP_FAIL = 2
    const commsTextW = (w: number) => Math.max(1, w - 4 - (w < 40 ? 16 : 24))
    // Under 12 cells a row holds too little to wrap into: it keeps one row and an ellipsis.
    const rowsFor = (room: number, max: number) => (room < 12 ? 1 : max)
    // The turn's slowest calls, slowest first: one row each in the receipt.
    const slowCalls = (m.isRunning ? t.slow : r?.slow) ?? []

    // A line of coloured pieces, drawn as a row of boxes the way the log draws its lines. A Text nesting
    // coloured Texts truncates as one line in a terminal, but the desktop app wraps each nested piece on its
    // own, lays truncating ones out as blocks of their own, and collapses runs of spaces. So pieces sit `gap`
    // cells apart (a piece's `lead` adds more), each keeps its width, and pieces that don't fit in `room` are
    // left out from the end; or a piece marked `fill` (one span) truncates to what the others leave.
    type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }
    type Piece = { spans: Span[]; lead?: number; fill?: boolean }
    const styleOf = (s: Span) => ({ ...(s.color ? { color: s.color } : {}), ...(s.dim ? { dimColor: true } : {}), ...(s.bold ? { bold: true } : {}) })
    const widthOf = (p: Piece) => p.spans.reduce((n, s) => n + cellWidth(s.text), 0)
    const line = (pieces: (Piece | null)[], room: number, gap = 1, justify?: 'center' | 'flex-end') => {
      const all = pieces.filter((p): p is Piece => p !== null)
      const shown = all.some(p => p.fill) ? all : all.slice(0, piecesThatFit(all.map(p => ({ width: widthOf(p), lead: p.lead })), room, gap))
      return (
        <Box width={room} columnGap={gap} overflow="hidden" {...(justify ? { justifyContent: justify } : {})}>
          {shown.map(p => {
            const lead = p.lead ? { marginLeft: p.lead } : {}
            if (p.fill && p.spans[0]) {
              return (
                <Text {...styleOf(p.spans[0])} wrap="truncate">
                  {p.spans[0].text}
                </Text>
              )
            }
            return (
              <Box flexShrink={0} {...lead}>
                {p.spans.length === 1 && p.spans[0] ? <Text {...styleOf(p.spans[0])}>{p.spans[0].text}</Text> : <Text>{p.spans.map(s => <Text {...styleOf(s)}>{s.text}</Text>)}</Text>}
              </Box>
            )
          })}
        </Box>
      )
    }

    // ---- card chrome (0.8.0): every panel shares one header, and its border says the worst status inside.
    // Colour is for status alone: titles are plain bold text, a quiet border means all is well, amber asks
    // for a look, the warning colour says something failed, the accent marks work in flight.
    type Tone = 'bad' | 'attn' | 'live' | null
    const toneColor = (tone: Tone) => (tone === 'bad' ? C.warn : tone === 'attn' ? C.amber : tone === 'live' ? C.main : C.faint)
    const folded = new Set(listOf<string>(v.collapsed))
    const isFolded = (p: Panel) => folded.has(p)
    const setView = (fn: (x: View) => View) => update($, view, x => fn(normalize(DEFAULT_VIEW, x)))
    const toggleFold = (p: Panel) => () =>
      setView(x => {
        const c = listOf<string>(x.collapsed)
        return { ...x, collapsed: c.includes(p) ? c.filter(k => k !== p) : [...c, p] }
      })
    const piecesW = (ps: readonly Piece[], gap = 2) => (ps.length ? ps.reduce((n, x) => n + widthOf(x) + (x.lead ?? 0), 0) + gap * (ps.length - 1) : 0)
    // What a header holds on its right: pieces of text, or a node of a known width (a clock, a button).
    type Right = { node: RenderChildren; width: number } | null
    const rightOf = (ps: (Piece | null)[]): Right => {
      const all = ps.filter((x): x is Piece => x !== null)
      const width = piecesW(all)
      return all.length ? { node: line(all, width, 2), width } : null
    }
    /**
     * A card's header row: the fold chevron, the name in bold and its detail dim (`checks · tests & builds`, one
     * Text, so it reads as one), then the status on the right. Short of room, the detail goes first, then the right.
     */
    const head = (p: Panel, w: number, name: string, detail: string | null, right: Right = null, glyph: Span | null = null) => {
      const inner = Math.max(1, w - 4)
      const isRight = right !== null && right.width + 1 <= inner - 2 - Math.min(12, cellWidth(name) + (glyph ? 2 : 0))
      const room = Math.max(1, inner - 2 - (isRight && right ? right.width + 1 : 0))
      const lead: Span[] = glyph ? [glyph, { text: ' ' }] : []
      const full: Piece = { spans: [...lead, { text: name, bold: true, color: C.text }, ...(detail ? [{ text: ` · ${detail}`, dim: true }] : [])] }
      // Short of room, one Text that truncates (a graphical surface cannot truncate nested Texts): it loses the
      // detail's colour, not its words.
      const plainText = `${glyph ? `${glyph.text} ` : ''}${name}${detail ? ` · ${detail}` : ''}`
      const title: Piece = widthOf(full) <= room ? full : { spans: [{ text: plainText, bold: true }], fill: true }
      return (
        <Box width={inner} columnGap={1} overflow="hidden">
          <Box flexShrink={0}>
            <Button key={`fold-${p}`} plain label={isFolded(p) ? '▸' : '▾'} dimColor onPress={toggleFold(p)} />
          </Box>
          {line([title], room, 1)}
          {isRight && right ? (
            <Box flexShrink={0} width={right.width} justifyContent="flex-end">
              {right.node}
            </Box>
          ) : null}
        </Box>
      )
    }
    /** A bordered card: its header, then its body unless folded. Keyed, so the header's chips can scroll to it. */
    const card = (p: Panel, w: number, tone: Tone, header: RenderChildren, body: () => RenderChildren) => (
      <Box key={`panel-${p}`} flexDirection="column" borderStyle="round" borderColor={toneColor(tone)} paddingX={1} width={w}>
        {header}
        {isFolded(p) ? null : body()}
      </Box>
    )
    /**
     * Text cut to `room` in the middle, pressed to copy it whole: a path, a command. On a graphical surface the
     * whole text also shows while the pointer rests on it.
     */
    const copyable = (key: string, full: string, room: number, dim = true, display = full) => {
      const w = Math.max(1, room)
      const whole = display.replace(/\s+/g, ' ').trim()
      const shown = midCut(whole, w)
      // The tip is cut into rows of its own width, a path having no spaces to wrap at.
      const tip = full.replace(/\s+/g, ' ').trim()
      const tipRows = Array.from({ length: Math.min(4, Math.ceil(cellWidth(tip) / w)) }, (_, i) => [...tip].slice(i * w, (i + 1) * w).join('').trim())
      return (
        <Box key={`tip-${key}`} flexDirection="column" width={w}>
          <Button
            key={`copy-${key}`}
            plain
            label={shown}
            dimColor={dim}
            onPress={press => {
              void $.ui.copy({ text: full, surface: press.surface }).catch(() => undefined)
              try {
                $.ui.toast(`copied ${shorten(full, 60)}`)
              } catch {
                // A toast is only a hint.
              }
            }}
          />
          {!isTerminal && (shown !== whole || display !== full) ? (
            <Box position="absolute" top={1} left={0} width={w} flexDirection="column" display="none" hover={{ display: 'flex' }} backgroundColor={C.faint}>
              {tipRows.map(r => (
                <Text color={C.text} wrap="truncate">
                  {r}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      )
    }

    // ---- main
    const effortN = effortLevel(m.effort)
    const ctxFill = contextFill(u)
    const ctxGauge = ctxFill.pct !== null ? gauge(ctxFill.pct, 10) : null
    // Drawn only once it is near enough to plan for; amber when a compaction is a few turns away.
    const turnsLeft = runway(listOf<number>(u.turnTokens), u.tokens, ctxFill.window)
    const runwayText = turnsLeft !== null && turnsLeft <= 20 ? `~${turnsLeft} turn${turnsLeft === 1 ? '' : 's'} left` : null
    // The status on the main card's right: working with the turn's clock (the turn has no card of its own while
    // it runs), or idle.
    const mainStatus: Right = m.isRunning
      ? {
          width: 15,
          node: (
            <Box columnGap={1}>
              <Text color={C.main}>● working</Text>
              <Box width={5} flexShrink={0}>
                {clock('turn-clock', t.startedAt, null, C.main)}
              </Box>
            </Box>
          ),
        }
      : rightOf([{ spans: [{ text: '○ idle', color: C.dim }] }])
    const mainPanel = (w: number) =>
      card('main', w, m.isRunning ? 'live' : (ctxFill.pct ?? 0) >= 80 ? 'attn' : null, head('main', w, modelName, 'main', mainStatus), () => (
        <Box flexDirection="column">
        {(() => {
          // 0.8.0: the mode is shown once it is known; an unknown one is a missing event, and says nothing.
          const rest: (Piece | null)[] = [
            m.mode ? { spans: [{ text: `mode ${m.mode}`, dim: true }] } : null,
            { spans: [{ text: plural(m.steps, 'request'), dim: true }] },
          ]
          if (Svg) {
            // The gauge is a gradient bar about five cells wide; the mode and request count take what is left.
            const used = 6 + 1 + 5 + 1 + cellWidth(m.effort || '—') + 3
            return (
              <Box width={w - 4} columnGap={1} overflow="hidden">
                <Text dimColor>effort</Text>
                <Box flexShrink={0}>
                  <Svg key="effort-gauge" source={effortSvg(effortN, 40)} alt={`effort ${m.effort || 'unknown'}`} />
                </Box>
                <Text color={C.text} bold>
                  {m.effort || '—'}
                </Text>
                {line(rest, Math.max(0, w - 4 - used), 3)}
              </Box>
            )
          }
          return line(
            [
              {
                spans: [
                  { text: 'effort ', dim: true },
                  { text: `${'▮'.repeat(effortN) + '▯'.repeat(5 - effortN)} `, color: C.main },
                  { text: m.effort || '—', color: C.text, bold: true },
                ],
              },
              ...rest,
            ],
            w - 4,
            3,
          )
        })()}
        {ctxGauge && Svg && ctxFill.pct !== null ? (
          <Box width={w - 4} columnGap={1} overflow="hidden">
            <Text dimColor>ctx</Text>
            <Box flexShrink={0}>
              <Svg key="ctx-meter" source={meterSvg(ctxFill.pct, 84)} alt={`context ${Math.round(ctxFill.pct)}% used`} />
            </Box>
            <Text bold>{`${Math.round(ctxFill.pct)}%`}</Text>
            {u.tokens !== null ? <Text dimColor wrap="truncate">{`${kTokens(u.tokens)}/${kTokens(ctxFill.window)}`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{`⟲${u.compactions}`}</Text> : null}
            {runwayText ? (
              <Text color={(turnsLeft ?? 99) <= 3 ? C.amber : C.dim} wrap="truncate">
                {runwayText}
              </Text>
            ) : null}
          </Box>
        ) : ctxGauge
          ? line(
              [
                {
                  spans: [
                    { text: 'ctx ', dim: true },
                    { text: ctxGauge.on, color: ctxFill.pct !== null && ctxFill.pct >= 80 ? C.warn : C.main },
                    { text: ctxGauge.off, color: C.faint },
                    { text: ` ${Math.round(ctxFill.pct ?? 0)}%`, bold: true },
                  ],
                },
                u.tokens !== null ? { spans: [{ text: `${kTokens(u.tokens)}/${kTokens(ctxFill.window)}`, dim: true }] } : null,
                u.compactions > 0 ? { spans: [{ text: `⟲${u.compactions}`, color: C.amber }], lead: 1 } : null,
                runwayText ? { spans: [{ text: runwayText, color: (turnsLeft ?? 99) <= 3 ? C.amber : C.dim }] } : null,
              ],
              w - 4,
            )
          : null}
        {u.costUsd !== null || u.limits.length > 0
          ? line(
              [
                u.costUsd !== null ? { spans: [{ text: fmtUsd(u.costUsd), color: C.text }] } : null,
                // 0.13.0: the last request's speed shares the cost line, one row fewer.
                m.speed && w >= 40 ? { spans: [{ text: fmtSpeed(m.speed), dim: true }], lead: 2 } : null,
                ...u.limits.slice(0, 2).map((l, i): Piece => {
                  const lg = gauge(l.pct, 5)
                  // The time to each reset where the line has room for it: both windows fit from 56 columns,
                  // so a wide pane's half column (59 at 120) has them; a window that doesn't fit is left out.
                  const resetIn = w >= 56 ? fmtResetIn(l.resetsAt, now) : ''
                  return {
                    lead: i > 0 ? 1 : u.costUsd !== null ? 2 : 0,
                    spans: [
                      { text: `${limitLabel(l.kind)} `, dim: true },
                      { text: lg.on, color: l.pct >= 80 ? C.warn : C.main },
                      { text: lg.off, color: C.faint },
                      { text: ` ${Math.round(l.pct)}%${resetIn ? ` ↻${resetIn}` : ''}`, dim: true },
                    ],
                  }
                }),
              ],
              w - 4,
            )
          : null}
        {/* 0.14.0: when each rate-limit window refills, as a clock time and the time left. */}
        {u.limits.slice(0, 2).map(l => {
          const left = fmtResetIn(l.resetsAt, now)
          if (!left || !l.resetsAt) return null
          const at = new Date(l.resetsAt)
          const when = at.getTime() - now > 20 * 3_600_000 ? `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${at.toTimeString().slice(0, 5)}` : at.toTimeString().slice(0, 5)
          return line([{ spans: [{ text: `${limitLabel(l.kind)} resets`, dim: true }] }, { spans: [{ text: `in ${left}`, color: C.text }] }, { spans: [{ text: `· ${when}`, dim: true }] }], w - 4)
        })}
        {skillNames.length > 0
          ? line([{ spans: [{ text: 'skills', dim: true }] }, { spans: [{ text: skillNames.slice(-4).join(' · ') + (skillNames.length > 4 ? ` +${skillNames.length - 4}` : ''), color: C.text }], fill: true }], w - 4)
          : null}
        {m.speed && u.costUsd === null && u.limits.length === 0 ? line([{ spans: [{ text: 'last req', dim: true }] }, { spans: [{ text: fmtSpeed(m.speed), dim: true }] }], w - 4) : null}
        {/* The turn in flight, named as such: its edits count every loop's, its errors the main loop's. */}
        {m.isRunning
          ? line(
              [
                { spans: [{ text: 'this turn', dim: true }] },
                { spans: [{ text: plural(t.edits, 'edit'), color: C.text }] },
                { spans: [{ text: plural(t.errors, 'error'), ...(t.errors > 0 ? { color: C.warn } : { dim: true }) }] },
              ],
              w - 4,
              2,
            )
          : null}
        </Box>
      ))

    // ---- architect
    const lastConsult = a.consults[a.consults.length - 1]
    // 0.8.0: one line says when it was last asked, for how long and at which moment; the timeline shows only
    // once there is a history to see (two consults or more).
    const hasTimeline = a.consults.length >= 2
    const architectPanel = (w: number) => {
      const consultCount = rightOf([{ spans: [{ text: 'consults ', dim: true }, { text: String(a.consults.length), bold: true }] }])
      return card(
        'architect',
        w,
        advising ? 'live' : null,
        head('architect', w, FIXED.architectLabel, advising ? 'advising' : 'on call', consultCount, { text: '◆', color: C.arch }),
        () => (
          <Box flexDirection="column">
            {lastConsult
              ? line(
                  [
                    {
                      spans: [
                        {
                          text: advising
                            ? `consulting since ${fmtClock(lastConsult.at)}`
                            : `last ${fmtDuration(now - (lastConsult.endAt ?? lastConsult.at))} ago · took ${fmtDuration((lastConsult.endAt ?? now) - lastConsult.at)}`,
                          dim: true,
                        },
                      ],
                      fill: true,
                    },
                    // The moment where it fits beside the times; "(inferred)" only where there is room to spare.
                    FIXED.moments && w - 4 >= 44 ? { spans: [{ text: `◆ ${lastConsult.moment}`, color: C.arch }] } : null,
                    FIXED.moments && w - 4 >= 58 ? { spans: [{ text: '(inferred)', dim: true }] } : null,
                  ],
                  w - 4,
                  2,
                )
              : <Text dimColor>not consulted yet</Text>}
            {FIXED.moments && lastConsult && w - 4 < 44 ? <Text color={C.arch} wrap="truncate">{`◆ ${lastConsult.moment}`}</Text> : null}
            {hasTimeline ? (
              // Both ends are anchors (the first consult, now): should it run past its box, it asks to lose the middle.
              <Text color={C.arch} dimColor wrap="truncate-middle">
                {consultTimeline(a, now, Math.max(8, w - 4))}
              </Text>
            ) : null}
            {a.lastAdvice ? (
              <Text color={C.text} wrap="truncate">
                » {a.lastAdvice}
              </Text>
            ) : null}
          </Box>
        ),
      )
    }

    // ---- gate
    const s = gateSummary(g)
    const verdictColor = (c: Check) =>
      c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    const checkMark = (c: Check) => (
      <Text color={verdictColor(c)} dimColor={c.inSubagent}>
        {c.verdict === 'deny' ? '✗' : '■'}
      </Text>
    )
    const gatePanel = (w: number) => {
      // The strip holds the checks that were not allowed by a rule: a wall of allowed marks said nothing.
      const strip = g.recent.filter(c => c.verdict !== 'rule').slice(-Math.max(8, marksIn(w - 4, isTerminal)))
      const hot = hotspots(g.recent)
      const open = v.gateOpen
      // The totals in words where they all fit, in numbers alone where they don't: the colours say which is which.
      const totalsOf = (isShort: boolean): Piece[] => [
        { spans: [{ text: '■', color: C.gate }, { text: isShort ? ` ${s.rule}` : ` ${s.rule} allowed`, dim: true }] },
        { spans: [{ text: '■', color: C.cleared }, { text: isShort ? ` ${s.cleared}` : ` ${s.cleared} ${decider}`, dim: true }] },
        ...(s.ask > 0 ? [{ spans: [{ text: isShort ? `■ ${s.ask}` : `■ ${s.ask} pending`, color: C.amber }] }] : []),
        { spans: [{ text: isShort ? `✗ ${s.deny}` : `✗ ${s.deny} denied`, color: s.deny > 0 ? C.warn : C.dim }] },
      ]
      const words = totalsOf(false)
      const isShort = piecesThatFit(words.map(p => ({ width: widthOf(p) })), w - 4, 2) < words.length
      const totals = isShort ? totalsOf(true) : words
      // 0.8.0: while every check was allowed by a rule there is nothing to read but the count; the strip, the
      // hotspots and the totals come back with the first check that asked or was denied.
      const isQuiet = strip.length === 0 && hot.length === 0 && s.ask === 0 && s.deny === 0
      const tone: Tone = s.deny > 0 ? 'bad' : s.ask > 0 ? 'attn' : null
      return card('gate', w, tone, head('gate', w, FIXED.gateLabel, 'permissions'), () => (
        <Box flexDirection="column">
          {isQuiet ? (
            line([{ spans: [{ text: '✓', color: C.gate }] }, { spans: [{ text: s.total > 0 ? `${s.rule} allowed by rule` : 'no checks yet', dim: true }], fill: true }], w - 4)
          ) : strip.length > 0 ? (
            markRow(strip.map(checkMark))
          ) : null}
          {/* What asked most, with the rule that would let it run; adding the rule is yours to do. */}
          {hot.length > 0 && w >= 32
            ? hot.map(spot => (
                <Box width={w - 4} columnGap={1} overflow="hidden">
                  <Box flexShrink={0}>
                    <Text color={spot.denied > 0 ? C.warn : C.amber}>{`×${spot.count}`}</Text>
                  </Box>
                  <Text color={C.text} wrap="truncate">
                    {spot.rule}
                  </Text>
                  {spot.denied > 0 ? (
                    <Box flexShrink={0}>
                      <Text color={C.warn}>{`${spot.denied} denied`}</Text>
                    </Box>
                  ) : null}
                </Box>
              ))
            : null}
          {isQuiet ? null : line([...totals, !isShort && w >= 80 && g.recent.some(c => c.inSubagent) ? { spans: [{ text: 'dim: in subagents', dim: true }] } : null], w - 4, 2)}
          {/* Below about 44 columns the four buttons take two lines rather than run past the box. */}
          <Box columnGap={2} flexWrap="wrap">
            {(['all', 'file', 'shell', 'other'] as const).map(b => {
              const tl = b === 'all' ? null : g.totals[b]
              const n = tl ? tl.rule + tl.ask + tl.cleared + tl.deny : s.total
              return (
                <Button
                  key={`gate-${b}`}
                  plain
                  hotkey={b[0]}
                  label={`${b} ${n}${open === b ? ' ▾' : ''}`}
                  dimColor={n === 0}
                  onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))}
                />
              )
            })}
          </Box>
          {open
            ? g.recent
                .filter(c => open === 'all' || c.bucket === open)
                .slice(-5)
                .map(c => (
                  // The verdict sits in a box of its own width, not padded with spaces, which a graphical surface collapses.
                  <Box width={w - 4} columnGap={1} overflow="hidden">
                    <Box width={12} flexShrink={0}>
                      <Text>
                        <Text color={verdictColor(c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text>
                        <Text color={C.dim}>{c.verdict === 'rule' ? 'allowed' : c.verdict === 'cleared' ? decider : c.verdict === 'ask' ? 'pending' : 'denied'}</Text>
                      </Text>
                    </Box>
                    <Text dimColor={c.inSubagent} wrap="truncate">
                      {shorten(c.detail, Math.max(10, w - 18))}
                    </Text>
                  </Box>
                ))
            : null}
        </Box>
      ))
    }

    // ---- agents: cards up to the limit, swimlanes beyond it
    const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.gate : C.agent)
    const glyph = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')
    const expandOnPress = (id: string) => () =>
      update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))

    const agentsPanel = (w: number) => {
      // Cards need 20 columns each; when the pane can't hold the limit, lanes take over.
      const fit = Math.max(1, Math.min(FIXED.maxCards, Math.floor((w + 1) / 21)))
      const useLanes = cards.length > fit
      const isNarrow = w < 40
      const header = (
        <Box justifyContent="space-between" width={w}>
          <Text bold wrap="truncate">
            {isNarrow ? `agents · ${running.length}/${cards.length}` : `agents · ${running.length} running · ${cards.length} total`}
          </Text>
          {cards.length > 0 ? (
            <Box flexShrink={0}>
              <Text color={C.dim}>{`1-${Math.min(cards.length, useLanes ? 6 : fit)}${isNarrow ? '' : ' expand'}`}</Text>
            </Box>
          ) : null}
        </Box>
      )
      if (cards.length === 0) {
        return (
          <Box flexDirection="column" width={w}>
            {header}
            <Text color={C.dim}>no subagents yet</Text>
          </Box>
        )
      }
      if (useLanes) {
        const shown = cards.slice(-6)
        // A lane is its glyph, a label, the bar and a clock: below 34 columns the label narrows, below
        // 36 the bar, so a 24-column pane still holds it. From 40 they are as they always were.
        const labelW = Math.min(30, Math.max(7, w - 17, Math.floor((w - 11) / 2)))
        const barW = Math.max(4, w - 11 - labelW)
        const geo = lanes(shown, now, barW)
        return (
          <Box flexDirection="column" width={w}>
            {header}
            {cards.length > shown.length ? <Text color={C.dim}>{`+${cards.length - shown.length} earlier`}</Text> : null}
            {shown.map((c, i) => {
              const gm = geo[i]
              const isViewed = viewed === c.id
              return (
                <Box columnGap={1}>
                  <Text color={statusColor(c)} bold={isViewed}>
                    {isViewed ? '▶' : glyph(c)}
                  </Text>
                  <Box width={labelW} flexShrink={0}>
                    <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardLabel(c, cards), labelW - 3)} onPress={expandOnPress(c.id)} />
                  </Box>
                  <Box flexShrink={0}>
                    <Text>
                      <Text color={C.faint}>{'·'.repeat(gm?.before ?? 0)}</Text>
                      <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                      <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0)}</Text>
                    </Text>
                  </Box>
                  {clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
                </Box>
              )
            })}
          </Box>
        )
      }
      const shown = cards.slice(-fit)
      const cardW = Math.max(20, Math.floor((w - (shown.length - 1)) / shown.length))
      const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
      return (
        <Box flexDirection="column" width={w}>
          {header}
          {rail('fan-out', running.length > 0, C.agent, w, centers)}
          <Box columnGap={1}>
            {shown.map((c, i) => {
              const isViewed = viewed === c.id
              const sameModel = !c.model || prettyModel(c.model) === modelName
              return (
                <Box
                  flexDirection="column"
                  borderStyle={isViewed ? 'double' : 'round'}
                  borderColor={c.lastStop === 'max_tokens' ? C.warn : C.agent}
                  borderDimColor={c.status !== 'running' && !isViewed}
                  width={cardW}
                  paddingX={1}
                >
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={titleLines(cardTitle(c), cardW - 7, cardW - 4)[0]} onPress={expandOnPress(c.id)} />
                  <Text bold wrap="truncate">
                    {titleLines(cardTitle(c), cardW - 7, cardW - 4)[1]}
                  </Text>
                  <Text color={C.dim} wrap="truncate">
                    {sameModel ? c.type : `${c.type} · ${prettyModel(c.model)}`}
                  </Text>
                  <Text dimColor wrap="truncate">
                    {c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${plural(c.steps, 'step')}` : 'starting…'}
                  </Text>
                  {/* What it is doing now, without expanding it: its latest call while it runs. */}
                  <Text color={c.tools.length === 0 ? C.dim : c.tools.at(-1)?.isError ? C.warn : C.text} dimColor={c.status !== 'running'} wrap="truncate">
                    {c.tools.length > 0 ? `→ ${c.tools.at(-1)?.text ?? ''}` : 'no calls yet'}
                  </Text>
                  <Box columnGap={1}>
                    {Svg && cardW >= 26 ? (
                      <Box flexShrink={0}>
                        <Svg key={`crab-${c.id}`} source={crabSvg(cards.indexOf(c), c.status === 'running' && FIXED.motion)} alt={`agent ${i + 1}, ${c.status}`} />
                      </Box>
                    ) : null}
                    <Text color={c.lastStop === 'max_tokens' ? C.warn : statusColor(c)}>
                      {cardW >= 26 ? `${glyph(c)} ${c.lastStop === 'max_tokens' ? 'max_tokens' : c.status}` : glyph(c)}
                    </Text>
                    <Box flexShrink={0}>{clock(`card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
          {rail('merge', running.length > 0, C.agent, w, centers, true)}
        </Box>
      )
    }

    const expandedCard = cards.find(c => c.id === v.expanded)
    const expandedPanel = (w: number) =>
      expandedCard ? (
        <Box flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={w}>
          <Text bold wrap="wrap">
            {expandedCard.description || expandedCard.type}
          </Text>
          <Text dimColor wrap="truncate">{`${expandedCard.type} · ${prettyModel(expandedCard.model)} · ${expandedCard.status} · ${expandedCard.steps} steps`}</Text>
          {chipsOf(expandedCard.toolTally, 5) ? <Text color={C.agent} wrap="truncate">{`⚒ ${chipsOf(expandedCard.toolTally, 5)}`}</Text> : null}
          {expandedCard.prompt ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={C.dim}>prompt</Text>
              <Markdown key={`prompt-${expandedCard.id}`} text={expandedCard.prompt} dimColor />
            </Box>
          ) : null}
          <Box flexDirection="column" marginTop={1}>
            {expandedCard.tools.length === 0 ? <Text color={C.dim}>no tool calls yet</Text> : null}
            {expandedCard.tools.map(n => (
              <Text color={n.isError ? C.warn : C.text} wrap={n.isError ? 'wrap' : 'truncate'}>
                {`${n.isError ? '✗' : '·'} ${n.text}`}
              </Text>
            ))}
          </Box>
          {expandedCard.answer ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={C.dim}>answer</Text>
              <Markdown key={`answer-${expandedCard.id}`} text={expandedCard.answer} />
            </Box>
          ) : null}
        </Box>
      ) : null

    // ---- other loops (workflow agents, forks): ids that match no card
    const loopsPanel = (w: number) => {
      if (lp.length === 0) return null
      const active = lp.filter(l => isLoopActive(l, now)).length
      const dots = lp.slice(-Math.max(4, marksIn(w - 38, isTerminal)))
      const isNarrow = w < 40
      return (
        <Box width={w} columnGap={1}>
          <Text bold>{isNarrow ? 'loops' : 'other loops'}</Text>
          <Text dimColor>{isNarrow ? `${lp.length} · ${active} active` : `${lp.length} seen · ${active} active`}</Text>
          {markRow(
            dots.map(l => (
              <Text color={isLoopActive(l, now) ? C.agent : l.isDone ? C.dim : C.faint}>{isLoopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>
            )),
            1,
          )}
        </Box>
      )
    }

    // ---- receipt: the turn now, or the last one
    const receiptPanel = (w: number) => {
      const isReview = t.isReviewing
      // A bar's full width is the turn, or the slowest call while the turn is still running.
      const slowTotal = Math.max(1, ...slowCalls.map(x => x.ms), m.isRunning ? 0 : (r?.durationMs ?? 0))
      // A labelled count; the hot one (errors) takes the warning colour.
      const stat = (label: string, n: number, isHot = false): Piece => ({
        spans: [
          { text: `${label} `, ...(isHot ? { color: C.warn } : { dim: true }) },
          { text: String(n), bold: true, ...(isHot ? { color: C.warn } : {}) },
        ],
      })
      // 0.8.0: the turn in flight keeps its clock and counts on the main card; this card shows, while it runs,
      // only where its time went (the slowest calls) and a review, and after it the turn's receipt.
      const isDone = !m.isRunning && r !== null && r !== undefined
      const header = isDone && r
        ? head(
            'receipt',
            w,
            'last turn',
            `${fmtDuration(r.durationMs)} · agents ${r.agents} · edits ${r.edits}`,
            r.costDelta !== null ? rightOf([{ spans: [{ text: `+${fmtUsd(r.costDelta)}`, color: C.text }] }]) : null,
            { text: r.reason === 'answer' ? '✓' : '✗', color: r.reason === 'answer' ? C.gate : C.warn },
          )
        : head('receipt', w, 'this turn', isReview ? 'in review' : null, null, { text: '◐', color: C.main })
      const tone: Tone = isDone && r ? (r.reason === 'answer' ? (r.errors > 0 ? 'attn' : null) : 'bad') : 'live'
      return card('receipt', w, tone, header, () => (
        <Box flexDirection="column">
          {isDone && r && r.errors > 0 ? line([stat('errors', r.errors, true)], w - 4, 3) : null}
          {/* Where the turn's time went: its slowest calls (3 s or longer), each with its time and a bar against the turn. */}
          {slowCalls.length > 0 ? (
            <Box flexDirection="column">
              <Text dimColor wrap="truncate">{'slowest calls'}</Text>
              {slowCalls.map(x => (
                <Box width={w - 4} overflow="hidden" columnGap={1}>
                  <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text color={C.text} wrap="truncate">{midCut(x.text, Math.max(4, w - 4 - (w >= 40 ? 7 : 0) - 6))}</Text>
                  </Box>
                  {w >= 40 ? (
                    <Box flexShrink={0}>
                      <Text color={C.main}>{slowBar(x.ms, slowTotal, 6)}</Text>
                    </Box>
                  ) : null}
                  <Box flexShrink={0} width={5} justifyContent="flex-end">
                    <Text dimColor>{fmtDuration(x.ms)}</Text>
                  </Box>
                </Box>
              ))}
            </Box>
          ) : null}
          {isReview ? (
            <Text color={C.arch} wrap="wrap">
              {`${FIXED.architectLabel.toLowerCase()} reviewing before done (inferred)`}
            </Text>
          ) : null}
        </Box>
      ))
    }

    // ---- checks: the last build and test runs read from Bash output, and what was edited since
    // ---- plan (0.7.0, from plan-bar): one segment per step, the count, and what is happening now
    const hasPlanLine = hasClient && !faulted.has(faultKey(e.surface, 'plan-line.tsx'))
    // The terminal's bar: one run of blocks per step, in a gradient from light emerald to deep teal.
    const planBlocks = (p: BandPlan, barW: number) => {
      const n = p.steps.length
      // A blank between runs when each can keep 3 cells.
      const gapC = barW >= n * 3 ? 1 : 0
      const room = Math.max(n, barW - gapC * (n - 1))
      const segs = p.steps.map((st, i) => {
        const len = Math.round((room * (i + 1)) / n) - Math.round((room * i) / n)
        const f = st.status === 'completed' ? len : st.status === 'in_progress' ? Math.round(len * (st.frac ?? 0)) : 0
        return { f, x: st.status === 'failed' ? len : 0, l: st.status === 'in_progress' ? len - f : 0, r: st.status === 'pending' ? len : 0 }
      })
      const fillC = segs.reduce((sum, x) => sum + x.f, 0)
      let at = 0
      return (
        <Text key="plan-blocks">
          {segs.map((x, i) => (
            <Text key={`seg-${i}`}>
              {gapC && i ? ' ' : ''}
              {Array.from({ length: x.f }, (_, k) => (
                <Text key={`f-${i}-${k}`} color={mixHex(PLAN_G_LIGHT, PLAN_G_DEEP, fillC > 1 ? at++ / (fillC - 1) : 1)}>
                  █
                </Text>
              ))}
              {x.x ? <Text color={PLAN_FAIL}>{'▒'.repeat(x.x)}</Text> : null}
              {x.l ? <Text color={PLAN_G_MID}>{'▓'.repeat(x.l)}</Text> : null}
              {x.r ? <Text dimColor>{'░'.repeat(x.r)}</Text> : null}
            </Text>
          ))}
        </Text>
      )
    }
    // The line under the bar: its own clock where the surface runs client modules, the same text drawn now otherwise.
    const planLineEl = (p: BandPlan, w: number) => {
      const lp2 = planLineProps(p, planAct, running.map(c => c.type))
      if (hasPlanLine) return <els.Client key="plan-now" module="./plan-line.tsx" width={w} height={1} props={{ ...lp2, now, width: w }} />
      const rows = planLines(lp2, now)
      if (!rows.length) return null
      return (
        <Box key="plan-now" flexDirection="column" width={w}>
          {rows.map(r => (
            <Text dimColor wrap="truncate-end">
              {shorten(r, w)}
            </Text>
          ))}
        </Box>
      )
    }
    // 0.8.0: the line under the bar is one row; kept as a function for the row budget.
    const planLineRows = (_p: BandPlan, _w: number) => 1
    // A step's mark in the list: done, in progress, failed, or still to come.
    const stepMark = (st: BandPlan['steps'][number]): Span =>
      st.status === 'completed'
        ? { text: '✓', color: C.gate }
        : st.status === 'in_progress'
          ? { text: '▸', color: C.main }
          : st.status === 'failed'
            ? { text: '✗', color: C.warn }
            : { text: '○', dim: true }
    const stepTook = (st: BandPlan['steps'][number]) =>
      st.startedAt && st.doneAt && st.doneAt - st.startedAt >= 1000
        ? fmtDuration(st.doneAt - st.startedAt)
        : st.status === 'in_progress' && st.startedAt
          ? fmtDuration(now - st.startedAt)
          : ''
    const planPanel = (w: number) => {
      if (!pl) return null
      const label = planLabel(pl.steps)
      const failed = pl.steps.some(st => st.status === 'failed')
      const inner = w - 4
      const isOpen = v.planOpen === true
      // The header is the step in progress with all the row's room (the plan's title when none is); on a
      // graphical surface the count sits at its right, the bar keeping its segments clear of any label.
      const curStep = pl.steps.find(st => st.status === 'in_progress')
      const count: Piece = { spans: [{ text: label, bold: true, color: failed ? C.warn : PLAN_G_MID }] }
      const isCountInHead = Svg !== null && widthOf(count) + 1 <= inner - 14
      const headRoom = Math.max(1, inner - 2 - (isCountInHead ? widthOf(count) + 1 : 0))
      // With the steps open the list marks the step in progress, so the header names the plan instead.
      // A title cut from a short prompt ("Yes") says nothing, so the step in progress keeps the header then.
      const stepText = curStep && (!isOpen || pl.title.length < 12) ? `▸ ${curStep.active ?? curStep.text}` : pl.title
      const header = (
        <Box width={inner} columnGap={1} overflow="hidden">
          <Box flexShrink={0}>
            <Button key="fold-plan" plain label={isFolded('plan') ? '▸' : '▾'} dimColor onPress={toggleFold('plan')} />
          </Box>
          {line([headRoom >= 30 ? { spans: [{ text: 'plan', bold: true }] } : null, { spans: [{ text: stepText, bold: true, color: C.text }], fill: true }], headRoom, 2)}
          {isCountInHead ? (
            <Box flexShrink={0} width={widthOf(count)}>
              {line([count], widthOf(count))}
            </Box>
          ) : null}
        </Box>
      )
      // The list's toggle sits at the end of the line under the bar, where it takes no row of its own.
      const toggleW = 7
      const hasToggle = inner >= 28
      const lineW = hasToggle ? inner - toggleW - 1 : inner
      return (
        <Box key="plan-band" flexDirection="column" borderStyle="round" borderColor={toneColor(failed ? 'bad' : null)} paddingX={1} width={w}>
          {header}
          {isFolded('plan') ? null : (
            <Box flexDirection="column">
              {Svg ? (
                <Svg key="plan-svg" source={planSvg(pl.steps, label, Math.max(60, inner * 7), !isCountInHead)} alt={`${pl.title}: ${label}`} height={PLAN_H} />
              ) : (
                <Box key="plan-row" width={inner} columnGap={1} overflow="hidden">
                  {planBlocks(pl, Math.max(6, inner - label.length - 1))}
                  <Box flexShrink={0}>
                    <Text bold color={PLAN_G_MID}>
                      {label}
                    </Text>
                  </Box>
                </Box>
              )}
              <Box width={inner} columnGap={1} overflow="hidden">
                <Box width={lineW} flexShrink={0} overflow="hidden">
                  {planLineEl(pl, lineW)}
                </Box>
                {hasToggle ? (
                  <Box flexShrink={0} width={toggleW} justifyContent="flex-end">
                    <Button key="plan-steps" plain label={isOpen ? 'steps ▾' : 'steps ▸'} dimColor onPress={() => setView(x => ({ ...x, planOpen: x.planOpen !== true }))} />
                  </Box>
                ) : null}
              </Box>
              {isOpen
                ? pl.steps.slice(0, 12).map((st, i) => {
                    const took = stepTook(st)
                    return (
                      <Box key={`plan-step-${i}`} width={inner} columnGap={1} overflow="hidden">
                        <Box flexShrink={0}>
                          <Text {...styleOf(stepMark(st))}>{stepMark(st).text}</Text>
                        </Box>
                        <Text color={st.status === 'pending' ? C.dim : C.text} bold={st.status === 'in_progress'} wrap="truncate">
                          {st.text}
                        </Text>
                        {took ? (
                          <Box flexShrink={0}>
                            <Text dimColor>{took}</Text>
                          </Box>
                        ) : null}
                      </Box>
                    )
                  })
                : null}
              {isOpen && pl.steps.length > 12 ? <Text dimColor>{`+${pl.steps.length - 12} more`}</Text> : null}
            </Box>
          )}
        </Box>
      )
    }

    // ---- git: the session folder's branch, its PR and what is uncommitted
    const gitPanel = (w: number) => {
      const isDirty = gi.isRepo && gi.changes > 0
      const inner = w - 4
      // The branch is who this folder is, not a status: plain text, the ⎇ dim beside it.
      const pr: Piece | null = gi.isRepo ? (gi.pr !== null ? { spans: [{ text: `PR #${gi.pr}`, color: C.text, bold: true }] } : { spans: [{ text: 'no PR', dim: true }] }) : null
      const state: Piece | null = gi.isRepo
        ? isDirty
          ? { spans: [{ text: `± ${gi.changes} uncommitted`, color: C.amber }] }
          : { spans: [{ text: '✓ clean', color: C.gate }] }
        : null
      const stateW = state ? widthOf(state) : 0
      return card(
        'git',
        w,
        isDirty ? 'attn' : null,
        <Box width={inner} columnGap={1} overflow="hidden">
          <Box flexShrink={0}>
            <Button key="fold-git" plain label={isFolded('git') ? '▸' : '▾'} dimColor onPress={toggleFold('git')} />
          </Box>
          {line(
            [
              { spans: [{ text: 'git', bold: true }] },
              gi.isRepo ? { spans: [{ text: `⎇ ${gi.branch ?? 'detached'}`, color: C.text }], fill: true } : { spans: [{ text: 'not a repository', dim: true }], fill: true },
              pr,
            ],
            inner - 2,
            2,
          )}
        </Box>,
        () => (
          // The path is cut in the middle (its folder and its own name stay) and copies whole when pressed.
          <Box width={inner} columnGap={2} overflow="hidden">
            {copyable('git-path', gi.path || gi.folder, Math.max(4, inner - (stateW ? stateW + 2 : 0)))}
            {state ? (
              <Box flexShrink={0} width={stateW}>
                {line([state], stateW)}
              </Box>
            ) : null}
          </Box>
        ),
      )
    }

    // ---- checks: the last build and test runs read from Bash output, and what was edited since
    const checksPanel = (w: number) => {
      const tone: Tone = lastRun && !lastRun.isOk ? 'bad' : untested > 0 ? 'attn' : null
      return card('checks', w, tone, head('checks', w, 'checks', 'tests & builds', rightOf([{ spans: [{ text: plural(rs.length, 'run'), dim: true }] }])), () => (
        <Box flexDirection="column">
          {/* Newest first; the counts give way at narrow widths, the newest run names its command below. */}
          {rs
            .slice(-3)
            .reverse()
            .map((x, i) => (
              <Box flexDirection="column">
                {line(
                  [
                    { spans: [{ text: x.isOk ? '✓' : '✗', color: x.isOk ? C.gate : C.warn, bold: true }] },
                    { spans: [{ text: runCounts(x), color: x.isOk ? C.text : C.warn }], fill: true },
                    { spans: [{ text: fmtAgo(x.at, now), dim: true }] },
                  ],
                  w - 4,
                )}
                {i === 0 ? (
                  <Box marginLeft={2} width={w - 6} overflow="hidden">
                    {copyable(`run-${i}`, x.command, w - 6)}
                  </Box>
                ) : null}
              </Box>
            ))}
          {lastRun && !lastRun.isOk && lastRun.reason ? <Text color={C.warn} wrap="wrap">{`↳ ${lastRun.reason}`}</Text> : null}
          {untested > 0 ? (
            <Box width={w - 4} columnGap={1} overflow="hidden">
              <Box flexShrink={0}>
                <Text color={C.amber}>△</Text>
              </Box>
              <Text color={C.amber} wrap="truncate">{`${plural(untested, 'file')} edited since the last test run`}</Text>
            </Box>
          ) : null}
        </Box>
      ))
    }

    // ---- files: what this session edited, newest first; ● marks this turn's
    const filesPanel = (w: number) => {
      const shown = [...fs].sort((x, y) => y.lastAt - x.lastAt).slice(0, 6)
      const edits = fs.reduce((n, f) => n + f.edits, 0)
      const byName = (id: string) => (id === MAIN_ID ? 'main' : shorten(nodeName(id, cards), 10))
      return card('files', w, null, head('files', w, 'files', `${fs.length} edited this session`, edits > fs.length ? rightOf([{ spans: [{ text: plural(edits, 'edit'), dim: true }] }]) : null), () => (
        <Box flexDirection="column">
          {shown.map(f => {
            const isThisTurn = t.startedAt > 0 && f.lastAt >= t.startedAt
            const who = f.by.some(b => b !== MAIN_ID) ? f.by.map(byName).join(', ') : ''
            const tail = `×${f.edits}${who && w >= 40 ? ` · ${shorten(who, 16)}` : ''}`
            return (
              <Box width={w - 4} columnGap={1} overflow="hidden">
                <Box flexShrink={0}>
                  <Text color={isThisTurn ? C.main : C.dim}>{isThisTurn ? '●' : '·'}</Text>
                </Box>
                {/* The path's last two segments, cut in the middle where long; pressed, the whole path is copied. */}
                {copyable(`file-${f.path}`, f.path, Math.max(4, w - 4 - 3 - cellWidth(tail)), false, shortPath(f.path))}
                <Box flexShrink={0}>
                  <Text dimColor wrap="truncate">
                    {tail}
                  </Text>
                </Box>
              </Box>
            )
          })}
          {fs.length > shown.length ? <Text color={C.dim}>{`+${fs.length - shown.length} more`}</Text> : null}
        </Box>
      ))
    }

    // ---- comms: who said what to whom, a graph where the surface draws one and a list everywhere
    const commsPanel = (w: number) => {
      const loopsAll = withArchitect(cards, a, FIXED.architectLabel.toLowerCase())
      const scene = sceneAt(msgs, loopsAll, v.scrub)
      const es = edgesOf(scene.msgs)
      const shown = (viewed ? scene.msgs.filter(x => x.from === viewed || x.to === viewed) : scene.msgs).slice(-4)
      const isRunningAt = (id: string) => scene.cards.find(c => c.id === id)?.status === 'running'
      const flowEdges = es.map(x => ({ from: x.from, to: x.to, count: x.count, isLive: isRunningAt(x.from) || isRunningAt(x.to) }))
      const flowNodes = [
        { id: MAIN_ID, label: 'main', hue: 0, isLive: scene.isPast || m.isRunning },
        // A tool tally is the agent's now; it cannot be known for an earlier moment.
        ...scene.cards.slice(-6).map(c => ({
          id: c.id,
          label: shorten(cardLabel(c, scene.cards), 11),
          hue: loopsAll.indexOf(c),
          isLive: c.status === 'running',
          chips: scene.isPast ? '' : chipsOf(c.toolTally),
        })),
      ]
      const scrubBy = (dir: -1 | 1) => async () => {
        const n = (await getMsgs($)).length
        await update($, view, x => {
          const y = normalize(DEFAULT_VIEW, x)
          return { ...y, scrub: stepScrub(y.scrub, n, dir) }
        })
      }
      // Live: how many messages and which sender-to-recipient routes they used. Replaying: where the replay stands.
      const detail = scene.isPast
        ? `replay · ${scene.msgs.length} of ${plural(msgs.length, 'message')}`
        : `${plural(scene.msgs.length, 'message')} · ${plural(es.length, 'route')}`
      return card('comms', w, scene.isPast ? 'attn' : null, head('comms', w, 'comms', detail), () => (
        <Box flexDirection="column">
          {Svg && w >= 40 ? (
            <Svg
              key="comms-svg"
              source={flowSvg(flowNodes, flowEdges, 520, FIXED.motion && !scene.isPast)}
              alt={`${plural(es.length, 'link')} between ${flowNodes.length} loops`}
            />
          ) : null}
          {shown.map(x => (
            <Box alignItems="flex-start">
              <Box width={w < 40 ? 16 : 24} flexShrink={0}>
                <Text color={C.dim} wrap="truncate">{`${shorten(nodeName(x.from, loopsAll), 8)} → ${shorten(nodeName(x.to, loopsAll), 10)}`}</Text>
              </Box>
              <Box flexDirection="column" width={commsTextW(w)} overflow="hidden">
                {wrapLines(x.text, commsTextW(w), rowsFor(commsTextW(w), WRAP_COMMS)).map(t => (
                  <Text color={C.text} wrap="truncate">
                    {t}
                  </Text>
                ))}
              </Box>
            </Box>
          ))}
          {msgs.length > 1 ? (
            <Box columnGap={2} flexWrap="wrap">
              <Button key="comms-back" plain hotkey="b" label="◀ older" dimColor={scene.msgs.length === 0} onPress={scrubBy(-1)} />
              <Button key="comms-next" plain hotkey="n" label="newer ▶" dimColor={!scene.isPast} onPress={scrubBy(1)} />
              <Button
                key="comms-live"
                plain
                hotkey="l"
                label={scene.isPast ? 'live' : 'live ●'}
                dimColor={!scene.isPast}
                onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), scrub: null }))}
              />
            </Box>
          ) : null}
        </Box>
      ))
    }

    // ---- footer: the keys that work while the pane has the focus
    const keys = ([
      cards.length > 0 ? { spans: [{ text: `1-${Math.min(cards.length, cards.length > FIXED.maxCards ? 6 : FIXED.maxCards)}`, bold: true }, { text: ' cards', dim: true }] } : null,
      panels.includes('gate') ? { spans: [{ text: 'a f s o', bold: true }, { text: ' gate', dim: true }] } : null,
      panels.includes('comms') && msgs.length > 1 ? { spans: [{ text: 'b n l', bold: true }, { text: ' replay', dim: true }] } : null,
      { spans: [{ text: 'p', bold: true }, { text: ' panels', dim: true }] },
    ] as (Piece | null)[]).filter((p): p is Piece => p !== null)
    const hasFooter = e.props.isFocused === true && keys.length > 0

    // ---- layout: the rows each panel takes, how the two columns share them, and what is left for the log
    const expandedRows = expandedCard ? 10 + Math.ceil(((expandedCard.prompt?.length ?? 0) + expandedCard.answer.length) / Math.max(10, W - 6)) : 0
    const hot0 = hotspots(g.recent)
    const isGateQuiet = g.recent.every(c => c.verdict === 'rule') && hot0.length === 0 && s.ask === 0 && s.deny === 0
    const planOpenRows = pl && v.planOpen === true ? Math.min(12, pl.steps.length) + (pl.steps.length > 12 ? 1 : 0) : 0
    // Each panel's rows (its border, header and body), plus the one row of air above it. A folded card is its header.
    const rowsOf: Record<Panel, number> = {
      main: 5 + (ctxGauge ? 1 : 0) + (u.costUsd !== null || u.limits.length > 0 ? 1 : 0) + (m.speed && (colW < 40 || (u.costUsd === null && u.limits.length === 0)) ? 1 : 0) + (m.isRunning ? 1 : 0),
      plan: 6 + (pl ? planLineRows(pl, colW - 4) - 1 : 0) + planOpenRows,
      git: 5,
      architect: 5 + (FIXED.moments && colW - 4 < 44 ? 1 : 0) + (hasTimeline ? 1 : 0) + (a.lastAdvice ? 1 : 0),
      gate: (isGateQuiet ? 6 : 7 + hot0.length) + (colW < 44 ? 1 : 0) + (v.gateOpen ? 5 : 0),
      checks: 5 + Math.min(3, rs.length) + (untested > 0 ? 1 : 0) + (lastRun && !lastRun.isOk && lastRun.reason ? 2 : 0),
      agents: (cards.length > FIXED.maxCards ? 3 + Math.min(6, cards.length) : 12) + expandedRows,
      loops: 1,
      receipt: (m.isRunning || !(r?.errors) ? 4 : 5) + (t.isReviewing ? 1 : 0) + (slowCalls.length > 0 ? 1 + slowCalls.length : 0),
      files: 4 + Math.min(6, fs.length) + (fs.length > 6 ? 1 : 0),
      comms: 6 + Math.min(4, msgs.length) + (Svg && W >= 40 ? 6 : 0) + msgs.slice(-4).reduce((n, x) => n + wrapLines(x.text, commsTextW(colW), rowsFor(commsTextW(colW), WRAP_COMMS)).length - 1, 0),
      log: 0,
    }
    for (const p of panels) if (isFolded(p) && p !== 'agents' && p !== 'loops' && p !== 'log') rowsOf[p] = 4
    const colRows = (ps: Panel[]) => ps.reduce((n, p) => n + rowsOf[p], 0)
    // 0.8.0: the left column is what is happening now and what needs a look, the right the work under way;
    // the gate and the architect take whichever is shorter, so neither column runs on alone.
    const inOrder = (ps: Panel[]) => panels.filter(p => ps.includes(p))
    const left: Panel[] = panels.filter(p => p === 'main' || p === 'plan' || p === 'checks' || p === 'git')
    const right: Panel[] = panels.filter(p => p === 'agents' || p === 'loops' || p === 'comms')
    // 0.13.0: the last turn and the files float too, so the two columns end close together.
    for (const p of panels.filter(x => x === 'gate' || x === 'architect' || x === 'receipt' || x === 'files')) (colRows(left) <= colRows(right) ? left : right).push(p)
    const leftCol = inOrder(left)
    const rightCol = inOrder(right)
    // Where the right column ends well short of the left, the log fills it, rather than run under both.
    const spare = colRows(leftCol) - colRows(rightCol)
    const isLogRight = isWide && panels.includes('log') && spare >= 10
    const used = 1 + legendGap + (isWide ? Math.max(colRows(leftCol), colRows(rightCol)) : colRows(panels)) + 4 + (v.panelsOpen === true ? (W >= 100 ? 1 : W >= 50 ? 2 : 4) : 0) + (hasFooter ? 1 : 0)
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const nLog = isLogRight ? Math.min(20, spare - 4) : logRows(bodyRows, used)
    const logScope = viewed ? lines.filter(l => l.agentId === viewed) : lines
    // The header's failed-call count filters the log to its failures, and back.
    const isErrorsOnly = v.logErrors === true && logScope.some(l => l.kind === 'error')
    const logSource = isErrorsOnly ? logScope.filter(l => l.kind === 'error') : logScope
    const colorOf = (l: LogLine) =>
      l.kind === 'error' ? C.warn : l.kind === 'consult' ? C.arch : l.who === 'main' ? C.main : l.who === 'gate' ? C.gate : l.who === 'you' ? C.text : C.agent
    // Below 40 columns a line keeps its minute, not its second, and a shorter name.
    const logPanel = (w: number) => {
      // The newest lines whose wrapped rows fit the log's `nLog` rows; a failure keeps up to three rows of its reason.
      const timeW = w < 40 ? 6 : 9
      const whoW = w < 40 ? 9 : 13
      const textW = Math.max(1, w - 4 - timeW - whoW)
      type RowTone = 'text' | 'dim' | 'warn'
      type LogRow = { text: string; tone: RowTone }
      // A failure draws its reason in the warning colour and its command dim beneath; routine work by main is dim.
      const rowsOfLine = (l: LogLine): LogRow[] => {
        if (l.kind === 'error') {
          const f = splitFailure(l.text)
          if (f) {
            return [
              // 0.13.1: only the reason's first row is red; the rest reads dim, so a long failure is no wall of red.
              ...wrapLines(f.reason, textW, rowsFor(textW, 2)).map((text, i) => ({ text, tone: i === 0 ? ('warn' as const) : ('dim' as const) })),
              { text: shorten(f.call, textW), tone: 'dim' as const },
            ]
          }
          return wrapLines(l.text, textW, rowsFor(textW, WRAP_FAIL)).map((text, i) => ({ text, tone: i === 0 ? ('warn' as const) : ('dim' as const) }))
        }
        const tone: RowTone = l.who === 'main' && l.kind === 'info' ? 'dim' : 'text'
        return wrapLines(l.text, textW, rowsFor(textW, WRAP_LOG)).map(text => ({ text, tone }))
      }
      const markOf = (l: LogLine) => (l.kind === 'error' ? '✗' : l.kind === 'consult' ? '◆' : l.kind === 'done' ? '✓' : '●')
      // The newest lines whose rows fit the log's `nLog` rows.
      const picked: { l: LogLine; rows: LogRow[] }[] = []
      let used = 0
      for (let i = logSource.length - 1; i >= 0; i -= 1) {
        const l = logSource[i]!
        const rows = rowsOfLine(l)
        if (picked.length > 0 && used + rows.length > nLog) break
        picked.unshift({ l, rows })
        used += rows.length
        if (used >= nLog) break
      }
      // 0.8.0: every row names its sender, so the column reads straight down; the sender is bold where it changes.
      const shownLines = picked.map((x, i) => ({ ...x, isNamed: i === 0 || picked[i - 1]!.l.who !== x.l.who }))
      const tally = logTally(logScope)
      const eventsPiece: Piece = { spans: [{ text: plural(tally.events, 'event'), dim: true }] }
      const failLabel = isErrorsOnly ? `✗ ${plural(tally.errors, 'failed call')} ▾` : `✗ ${plural(tally.errors, 'failed call')}`
      const failW = cellWidth(failLabel)
      const right: Right =
        tally.errors > 0
          ? {
              width: widthOf(eventsPiece) + 2 + failW,
              node: (
                <Box columnGap={2}>
                  <Text dimColor>{plural(tally.events, 'event')}</Text>
                  <Button key="log-errors" plain label={failLabel} onPress={() => setView(x => ({ ...x, logErrors: x.logErrors !== true }))}>
                    <Text color={C.warn}>{failLabel}</Text>
                  </Button>
                </Box>
              ),
            }
          : rightOf([eventsPiece])
      return card('log', w, null, head('log', w, 'session log', viewed ? 'this agent' : isErrorsOnly ? 'failed calls' : null, right), () => (
        <Box flexDirection="column">
          {shownLines.length === 0 ? <Text color={C.dim}>nothing yet</Text> : null}
          {shownLines.map(({ l, rows, isNamed }) => (
            <Box>
              <Box width={timeW} flexShrink={0}>
                <Text color={C.dim}>{w < 40 ? fmtClock(l.at).slice(0, 5) : fmtClock(l.at)}</Text>
              </Box>
              <Box width={whoW} flexShrink={0}>
                <Text color={colorOf(l)} bold={isNamed} dimColor={!isNamed} wrap="truncate">
                  {`${markOf(l)} ${l.who}`}
                </Text>
              </Box>
              <Box flexDirection="column" width={textW} overflow="hidden">
                {rows.map(row =>
                  row.tone === 'dim' ? (
                    <Text dimColor wrap="truncate">
                      {row.text}
                    </Text>
                  ) : (
                    <Text color={row.tone === 'warn' ? C.warn : C.text} wrap="truncate">
                      {row.text}
                    </Text>
                  ),
                )}
              </Box>
            </Box>
          ))}
        </Box>
      ))
    }

    const drawers: Record<Panel, (w: number) => ReturnType<typeof logPanel> | null> = {
      main: mainPanel,
      plan: planPanel,
      git: gitPanel,
      architect: architectPanel,
      gate: gatePanel,
      checks: checksPanel,
      agents: agentsPanel,
      loops: loopsPanel,
      receipt: receiptPanel,
      files: filesPanel,
      comms: commsPanel,
      log: logPanel,
    }
    const draw = (p: Panel, w: number) => drawers[p](w)

    // 0.8.0: every panel sits one row below the one before, the same air throughout; the agents panel ends on
    // its own merge rail, which is its air.
    const column = (ps: Panel[], w: number) => (
      <Box flexDirection="column" width={w}>
        {ps.map((p, i) => {
          const prev = ps[i - 1]
          const hasGap = i > 0 && prev !== 'agents'
          return (
            <Box flexDirection="column" marginTop={hasGap ? 1 : 0}>
              {draw(p, w)}
              {p === 'agents' ? expandedPanel(w) : null}
            </Box>
          )
        })}
      </Box>
    )

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    // The panels control: a button in the header row, so it is on every layout and never scrolls past the log, and
    // a list of one button per panel under it while open. It is not a panel, so it has no button of its own. A
    // hidden panel is only not drawn: its data and its header chip's target stay.
    const flip = (p: Panel) => () =>
      setView(x => {
        const h = hiddenPanels(x.hidden)
        return { ...x, hidden: h.includes(p) ? h.filter(q => q !== p) : [...h, p] }
      })
    const isPanelsOpen = v.panelsOpen === true
    const panelsLabel = `${isPanelsOpen ? '▾' : '▸'} panels${hidden.length > 0 ? (W >= 40 ? ` · ${hidden.length} hidden` : ` ${hidden.length}`) : ''}`
    const panelsButton = (
      <Button key="panels-toggle" plain hotkey="p" label={panelsLabel} dimColor onPress={() => setView(x => ({ ...x, panelsOpen: x.panelsOpen !== true }))} />
    )
    const panelsList = isPanelsOpen ? (
      <Box columnGap={2} flexWrap="wrap" width={W}>
        {PANELS.map(p => (
          <Button key={`panel-${p}`} plain label={`${hidden.includes(p) ? '○' : '●'} ${p}`} dimColor={hidden.includes(p)} onPress={flip(p)} />
        ))}
      </Box>
    ) : null

    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    if (isMini) {
      // A plan takes one row here, and one agent row gives way to it, so the summary stays at 8 rows.
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, pl ? 2 : 3)
      const planNow = pl ? (pl.steps.find(st => st.status === 'in_progress') ?? null) : null
      const counts = `${s.rule} allowed · ${s.cleared} ${decider}${s.ask > 0 ? ` · ${s.ask} pending` : ''} · ${s.deny} denied`
      const strip = g.recent.slice(-Math.max(4, marksIn(W - FIXED.gateLabel.length - 2 - counts.length, isTerminal)))
      const mg = ctxFill.pct !== null ? gauge(ctxFill.pct, 6) : null
      return (
        <Box flexDirection="column" width={W}>
          {line(
            [
              {
                spans: [
                  { text: modelName, color: C.text, bold: true },
                  { text: m.isRunning ? ' ● working' : ' ○ idle', color: m.isRunning ? C.main : C.dim },
                ],
              },
              mg
                ? {
                    spans: [
                      { text: '· ctx ', dim: true },
                      { text: mg.on, color: (ctxFill.pct ?? 0) >= 80 ? C.warn : C.main },
                      { text: mg.off, color: C.faint },
                      { text: ` ${Math.round(ctxFill.pct ?? 0)}%` },
                      ...(u.compactions > 0 ? [{ text: ` ⟲${u.compactions}`, color: C.amber }] : []),
                    ],
                  }
                : u.compactions > 0
                  ? { spans: [{ text: `⟲${u.compactions}`, color: C.amber }] }
                  : null,
              u.costUsd !== null ? { spans: [{ text: `· ${fmtUsd(u.costUsd)}`, dim: true }] } : null,
              showArchitect ? { spans: [{ text: `· ${FIXED.architectLabel.toLowerCase()} ${advising ? 'advising' : a.consults.length}`, color: C.arch }] } : null,
              // Last, so it is the first piece left out when the row is short.
              hasGit && gi.isRepo
                ? {
                    spans: [
                      { text: `· ⎇ ${shorten(gi.branch ?? 'detached', 24)}`, color: C.agent },
                      ...(gi.changes > 0 ? [{ text: ` ±${gi.changes}`, color: C.amber }] : []),
                      ...(gi.pr !== null ? [{ text: ` #${gi.pr}`, color: C.gate }] : []),
                    ],
                  }
                : null,
            ],
            W,
          )}
          {pl
            ? line(
                [
                  { spans: [{ text: '●', color: PLAN_G_DEEP }] },
                  { spans: [{ text: shorten(pl.title, 24), bold: true }] },
                  { spans: [{ text: '▮'.repeat(doneCount(pl.steps)), color: PLAN_G_MID }, { text: '▯'.repeat(Math.max(0, pl.steps.length - doneCount(pl.steps))), color: C.faint }] },
                  { spans: [{ text: planLabel(pl.steps), color: PLAN_G_MID, bold: true }] },
                  planNow ? { spans: [{ text: `· ${planNow.active ?? planNow.text}`, dim: true }], fill: true } : null,
                ],
                W,
              )
            : null}
          {strip.length > 0 ? (
            <Box columnGap={1}>
              <Text dimColor>{FIXED.gateLabel.toLowerCase()}</Text>
              {markRow(strip.map(checkMark))}
              <Text color={s.deny > 0 ? C.warn : s.ask > 0 ? C.amber : C.dim} wrap="truncate">
                {counts}
              </Text>
            </Box>
          ) : null}
          {live.map(c => (
            <Box columnGap={1}>
              <Text color={statusColor(c)}>{glyph(c)}</Text>
              <Box width={Math.max(6, W - 30)} flexShrink={0}>
                <Text wrap="truncate">{cardTitle(c)}</Text>
              </Box>
              {c.steps > 0 ? <Text dimColor>{`ctx ${kTokens(c.ctx)}`}</Text> : null}
              {clock(`mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
            </Box>
          ))}
          {cards.length > live.length ? (
            <Text color={C.dim} wrap="truncate">{`+${cards.length - live.length} more agents · /chat-deck layout compact for all`}</Text>
          ) : null}
          {lp.length > 0 ? <Text dimColor wrap="truncate">{`other loops ${lp.length} · ${lp.filter(l => isLoopActive(l, now)).length} active`}</Text> : null}
          {!m.isRunning && r ? (
            <Text dimColor wrap="truncate">
              {`last turn ${fmtDuration(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}${r.costDelta !== null ? ` · +${fmtUsd(r.costDelta)}` : ''}`}
            </Text>
          ) : null}
          <Box columnGap={2}>{panelsButton}</Box>
          {panelsList}
        </Box>
      )
    }

    const body = isWide ? (
      <Box flexDirection="column">
        <Box columnGap={2}>
          {column(leftCol, colW)}
          {isLogRight ? column([...rightCol, 'log'], colW) : column(rightCol, colW)}
        </Box>
        {panels.includes('log') && !isLogRight ? <Box marginTop={1}>{logPanel(W)}</Box> : null}
      </Box>
    ) : (
      column(panels, W)
    )

    // One header row: the name (on the terminal; a graphical frame names the pane already), then only what asks
    // for attention. Each chip is pressable: it unfolds its panel and scrolls the pane to it.
    type Chip = { key: string; text: string; color: string; to: Panel; then?: () => Promise<unknown> }
    const chips: Chip[] = ([
      running.length > 0 ? { key: 'agents', text: `◐ ${running.length} running`, color: C.agent, to: 'agents' } : null,
      s.ask > 0 ? { key: 'pending', text: `■ ${s.ask} pending`, color: C.amber, to: 'gate' } : null,
      s.deny > 0 ? { key: 'denied', text: `✗ ${s.deny} denied`, color: C.warn, to: 'gate' } : null,
      lastRun ? { key: 'run', text: `${lastRun.isOk ? '✓' : '✗'} ${runLabel(lastRun)}`, color: lastRun.isOk ? C.gate : C.warn, to: 'checks' } : null,
      untested > 0 ? { key: 'untested', text: `${untested} untested`, color: C.amber, to: 'checks' } : null,
      hasGit && gi.isRepo && gi.changes > 0 ? { key: 'uncommitted', text: `± ${gi.changes} uncommitted`, color: C.amber, to: 'git' } : null,
      t.errors > 0 && m.isRunning
        ? { key: 'errors', text: `✗ ${plural(t.errors, 'error')}`, color: C.warn, to: 'log', then: () => setView(x => ({ ...x, logErrors: true })) }
        : null,
    ] as (Chip | null)[]).filter((x): x is Chip => x !== null && panels.includes(x.to))
    const goTo = (x: Chip) => async () => {
      await setView(y => ({ ...y, collapsed: listOf<string>(y.collapsed).filter(k => k !== x.to) }))
      if (x.then) await x.then()
      await $.ui.scroll({ to: { key: `panel-${x.to}` }, in: PANE }).catch(() => undefined)
    }
    const title = isTerminal && W >= 40 ? 'CHAT DECK' : ''
    const chipRoom = Math.max(0, W - (title ? title.length + 2 : 0) - cellWidth(panelsLabel) - 5)  // the label, its hotkey mark (3) and the gap
    // The chips that fit, in order; each keeps its width (a Button's label is its width).
    const shownChips = chips.slice(0, piecesThatFit(chips.map(x => ({ width: cellWidth(x.text) })), chipRoom, 2))

    return (
      <Box flexDirection="column" width={W}>
        <Box key="header" width={W} columnGap={2} marginBottom={legendGap} overflow="hidden">
          {title ? (
            <Box flexShrink={0}>
              <Text color={C.dim} bold>
                {title}
              </Text>
            </Box>
          ) : null}
          <Box width={chipRoom} columnGap={2} overflow="hidden" justifyContent="flex-end">
            {shownChips.map(x => (
              <Box flexShrink={0}>
                <Button key={`attn-${x.key}`} plain label={x.text} onPress={goTo(x)}>
                  <Text color={x.color}>{x.text}</Text>
                </Button>
              </Box>
            ))}
          </Box>
          <Box flexShrink={0}>{panelsButton}</Box>
        </Box>
        {panelsList}
        {body}
        {hasFooter ? line(keys, W, 2) : null}
      </Box>
    )
  }).catch(($, e, next) => {
    // Without this a failed draw leaves the engine's empty pane.
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" width={Math.max(20, e.props.bodyColumns)}>
        <Text bold>CHAT DECK</Text>
        <Text color={C.warn} wrap="wrap">{`draw failed (${next.error.kind}): ${next.error.message ?? 'no message'}`}</Text>
      </Box>
    )
  })
}

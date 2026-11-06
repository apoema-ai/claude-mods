// The plan panel's state (0.7.0, absorbed from the plan-bar mod): one list per chat, fed by the app's own
// task list, TodoWrite / TaskCreate / TaskUpdate, or this plugin's plan tool, and saved to a file
// chat-inventory reads. Nothing here ticks: the pane computes the step fill from the time it draws at,
// and the line under the bar keeps its own clock (plan-line.tsx).
// The stateful planner and its atoms live in register.tsx: the hooks module hands `$` only to its own
// functions, and reads only atoms it declares itself. This file is the pure part.
import type { Activity, BandPlan, PlanStatus } from '../types'

/** The tool's name until the engine says what it registered it as. */
export const PLAN_TOOL_DEFAULT = 'mcp__chat-deck__plan'
// The Claude desktop app's own task list: when it is in use, it feeds the plan and the plan tool stands down.
export const HOST_PLAN = 'mcp__ccd_turn__update_plan'
export const MIRRORED = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', HOST_PLAN])

export const planPrompt = (tool: string) =>
  `Your to-do list is the ${tool} tool; the user watches it as the plan panel in the Chat Deck pane. ` +
  `If the app gives you its own task-list tool (${HOST_PLAN}, TodoWrite or TaskCreate), keep that one and do not call this tool: Chat Deck draws the plan from it. ` +
  'For any task that needs 3 or more tool calls, call it first, before other tools, with every step in order and the first one in_progress. ' +
  'After that, send { next: true } when the step in progress is finished (it starts the next one), or { done: [2] } for particular steps (numbers from 1, or the exact step names); send the full list again only when the plan changes. ' +
  "When a step's check fails (a test run, a build), send { failed: [n] }; send it as in_progress again when you retry it. Mark the last step completed before your final answer. " +
  'When you write a plan for the user to approve, save its steps with the tool too, all pending, so the plan shows in the pane and the Chat Inventory to-do list. ' +
  'Write the whole plan up front, ending with a step that checks the result. Keep finished steps in the list when you update it, and do not reword, split or drop steps unless the plan really changed. Only one step is in_progress at a time. ' +
  'A step that launches subagents is one step. Skip it for a quick answer of one or two tool calls.'
// Main-chat tool calls in a turn before the nudge to make a plan: a quick look or two is not a task.
export const NUDGE_AFTER = 3
// Tool calls since the last plan update before the nudge to tick it.
export const STALE_AFTER = 8
export const nudgeNew = (tool: string) =>
  `Chat Deck: you have no plan for this task yet. Call your task-list tool now (${HOST_PLAN} when the app has it, otherwise ${tool}), before more tool calls, with every step in order ` +
  '(the first in_progress, the last one a check of the result), so the user sees its progress. Update it each time a step finishes.'
export const NUDGE_CONT =
  'Chat Deck: the plan has not changed this turn. If this is a new task, send its steps to your task-list tool. If it carries on the last one, mark the step that finished.'
export const nudgeStale = (tool: string) =>
  `Chat Deck: the plan has not changed in a while. If a step finished, mark it in your task-list tool now (${tool} takes { next: true } or { done: [n] }).`
export const STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed', 'failed']
// A saved plan older than this is from an abandoned session: a resume starts without it.
export const STALE_LOAD_MS = 12 * 60 * 60 * 1000
// How long a finished plan stays at 100% before the panel goes away.
export const DONE_HOLD_MS = 20_000
// A step that has run as long as the finished ones took on average is nearly there, never quite.
const FRAC_CAP = 0.9
// The argument that says what a call is doing, in the order tools tend to carry it.
export const ACT_ARGS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'description', 'query', 'url', 'skill']

export const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)
export const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim()
export const isStatus = (v: unknown): v is PlanStatus => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

// ---------------------------------------------------------------- pure helpers (the pane draws with these)

export const doneCount = (steps: readonly { status: PlanStatus }[]) => steps.filter(st => st.status === 'completed').length

/** Finished steps plus how far the one in progress is, so the bar moves while a long step runs. */
export function progress(steps: readonly { status: PlanStatus; frac?: number }[]) {
  const n = steps.length
  if (!n) return 0
  return Math.min(1, (doneCount(steps) + (steps.find(st => st.status === 'in_progress')?.frac ?? 0)) / n)
}

/** How far a step in progress is: its running time against the mean time of the finished steps. 0 until one has finished. */
export function activeFrac(steps: BandPlan['steps'], st: BandPlan['steps'][number], nowMs: number) {
  const times = steps.filter(s => s.status === 'completed' && s.startedAt && s.doneAt).map(s => s.doneAt! - s.startedAt!)
  const avg = times.reduce((sum, ms) => sum + ms, 0) / (times.length || 1)
  if (!times.length || avg <= 0 || !st.startedAt) return 0
  return Math.min(FRAC_CAP, Math.max(0, nowMs - st.startedAt) / avg)
}

/** The plan as drawn at `nowMs`: the step in progress gets its fill. */
export const withFrac = (p: BandPlan, nowMs: number): BandPlan => ({
  ...p,
  steps: p.steps.map(st => (st.status === 'in_progress' ? { ...st, frac: activeFrac(p.steps, st, nowMs) } : st)),
})

/** 45s, 2m05s, 1h03m. */
export function dur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const pad = (x: number) => String(x).padStart(2, '0')
  return m < 60 ? `${m}m${pad(s % 60)}s` : `${Math.floor(m / 60)}h${pad(m % 60)}m`
}

export type Timed = { text: string; startedAt?: number; doneAt?: number }
/** " (2m14s)": a finished step's time, once there is a whole second to show. */
export const took = (st: Timed) => (st.startedAt && st.doneAt && st.doneAt - st.startedAt >= 1000 ? ` (${dur(st.doneAt - st.startedAt)})` : '')

/** "All 4 steps done in 6m12s · longest: Run tests 3m01s": the end toast, and the panel while it holds at 100%. */
export function doneSummary(steps: readonly Timed[], totalMs: number) {
  const head = steps.length === 1 ? 'All steps done' : `All ${steps.length} steps done`
  const times = steps
    .filter(st => st.startedAt && st.doneAt)
    .map(st => ({ text: st.text, ms: st.doneAt! - st.startedAt! }))
    .sort((a, b) => b.ms - a.ms)
  const longest = steps.length > 1 && times[0] && times[0].ms >= 1000 ? ` · longest: ${times[0].text} ${dur(times[0].ms)}` : ''
  return `${head}${totalMs >= 1000 ? ` in ${dur(totalMs)}` : ''}${longest}`
}

/** "Tasks 2/5 +1 · 1 failed": done of all, late steps, failed ones. */
export function planLabel(steps: BandPlan['steps']) {
  const addedN = steps.filter(st => st.added).length
  const failedN = steps.filter(st => st.status === 'failed').length
  return `Tasks ${doneCount(steps)}/${steps.length}${addedN ? ` +${addedN}` : ''}${failedN ? ` · ${failedN} failed` : ''}`
}

/** "2 subagents running: Explore, Plan". */
export function agentsText(types: readonly string[]) {
  if (!types.length) return ''
  return `${types.length} subagent${types.length === 1 ? '' : 's'} running: ${[...new Set(types)].join(', ')}`
}

/**
 * What the line under the bar needs, so the client clock can redraw it on its own. Times are epoch ms.
 * 0.8.0: one timing only, the step in progress's; the steps finished before it and their times are in the
 * panel's step list.
 */
export type PlanLineProps = {
  /** The step in progress (its name is the panel's header, so only its start is here); null when none is. */
  cur: { startedAt: number | null } | null
  /** The line when no step is in progress: "Failed: …", "Next: …", or the done summary. */
  head: string
  act: Activity | null
  agents: string
}

export function planLineProps(p: BandPlan, act: Activity | null, agentTypes: readonly string[]): PlanLineProps {
  const cur = p.steps.find(st => st.status === 'in_progress')
  const failed = p.steps.find(st => st.status === 'failed')
  const nextUp = p.steps.find(st => st.status === 'pending')
  const done = doneCount(p.steps)
  const isDone = done === p.steps.length
  let head = ''
  if (isDone) {
    const end = Math.max(p.startedAt, ...p.steps.map(st => st.doneAt ?? 0))
    head = doneSummary(p.steps, end - p.startedAt)
  } else if (!cur) head = failed ? `Failed: ${failed.text}` : nextUp ? `Next: ${nextUp.text}` : ''
  const live = !!cur && !isDone
  return {
    cur: live ? { startedAt: cur.startedAt ?? null } : null,
    head,
    act: live ? act : null,
    agents: isDone ? '' : agentsText(agentTypes),
  }
}

/** "Bash: mvn verify · running 3m10s", "Bash: mvn verify · failed", or just what it was once it returned fine. */
function activityText(act: Activity, nowMs: number) {
  if (act.running) return nowMs - act.at >= 1000 ? `${act.text} · running ${dur(nowMs - act.at)}` : act.text
  return act.failed ? `${act.text} · failed` : act.text
}

/**
 * Under the bar (the step in progress is the header above it): how long this step has run, the last tool
 * call, the subagents running. A finished plan reads the same summary as its toast. plan-line.tsx draws the
 * same text on its own clock; keep the two in step.
 */
export function planLine(x: PlanLineProps, nowMs: number) {
  return planLines(x, nowMs).join(' · ')
}

/** The same text as rows: one row since 0.8.0, empty when there is nothing to say. */
export function planLines(x: PlanLineProps, nowMs: number): string[] {
  if (!x.cur) return [[x.head, x.agents].filter(Boolean).join(' · ')].filter(Boolean)
  const ran = x.cur.startedAt ? nowMs - x.cur.startedAt : 0
  const row = [ran >= 1000 ? `this step ${dur(ran)}` : '', x.act ? activityText(x.act, nowMs) : '', x.agents].filter(Boolean).join(' · ')
  return [row].filter(Boolean)
}

// ---------------------------------------------------------------- the planner

// added: the step joined after work began; active: TodoWrite's present-tense label.
export type PlanStep = { text: string; status: PlanStatus; startedAt?: string; doneAt?: string; id?: string; added?: boolean; active?: string }
export type Plan = { title: string; steps: PlanStep[]; startedAt: string; updatedAt: string }
export type StepIn = { text: string; status: PlanStatus; id?: string; active?: string }
export type Shift = { done?: unknown; failed?: unknown; next?: boolean; start?: unknown }

export const ms = (iso?: string) => (iso ? Date.parse(iso) : undefined)
export const timed = (st: PlanStep): Timed => ({ text: st.text, startedAt: ms(st.startedAt), doneAt: ms(st.doneAt) })

/** Applies a status change to `steps` in place: steps named by number (from 1) or by text, case aside. */
export function shift(steps: StepIn[], change: Shift): StepIn[] | string {
  const list = steps.map(x => x.text).join(' | ')
  const pick = (ref: unknown): StepIn | string => {
    if (typeof ref === 'number') return steps[ref - 1] ?? `Plan not saved: no step ${ref}; the plan has ${steps.length}. Steps: ${list}`
    const name = typeof ref === 'string' ? oneLine(ref) : ''
    return steps.find(x => x.text.toLowerCase() === name.toLowerCase()) ?? `Plan not saved: no step called "${cut(name, 40)}". Steps: ${list}`
  }
  const mark = (refs: unknown, status: PlanStatus): string | null => {
    for (const ref of Array.isArray(refs) ? refs : []) {
      const st = pick(ref)
      if (typeof st === 'string') return st
      st.status = status
    }
    return null
  }
  const bad = mark(change.done, 'completed') ?? mark(change.failed, 'failed')
  if (bad) return bad
  // next: finish the step in progress, start the first one still pending.
  if (change.next) {
    const cur = steps.find(st => st.status === 'in_progress')
    if (cur) cur.status = 'completed'
    const nxt = steps.find(st => st.status === 'pending')
    if (nxt) nxt.status = 'in_progress'
  }
  // start: that step is the one in progress now; one already in progress goes back to pending.
  if (change.start !== undefined) {
    const st = pick(change.start)
    if (typeof st === 'string') return st
    for (const x of steps) if (x.status === 'in_progress' && x !== st) x.status = 'pending'
    st.status = 'in_progress'
  }
  return steps
}


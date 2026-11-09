export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = {
  model: string
  effort: string
  mode: string
  steps: number
  isRunning: boolean
  /** The main loop's last answered request: time to its first piece of response. Null until one is
   *  measured, absent in older state; a `tokPerS` kept by 0.5.0 and earlier is ignored. */
  speed?: { ttftMs: number } | null
}

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  /** The compaction window (`autoCompactWindow`, or the host's own) the host measures context against, when auto-compaction
   *  is on and the window is smaller than the model's; null when none is set or none could be read. */
  compactWindow: number | null
  /** The model window `compactWindow` was read for, so a model switch reads it again; 0 = not read yet. */
  compactFor: number
  /** Reads for this model window that came back with no breakdown or failed; it stops asking at 3. */
  compactMisses: number
  costUsd: number | null
  /** `resetsAt`: when the window resets, in ms since the epoch; null when the API gave no time,
   *  absent in state saved before it was kept. */
  limits: { kind: string; pct: number; resetsAt?: number | null }[]
  compactions: number
  lastCompactAt: number | null
  /** Context tokens at each of the last main turns' starts, oldest first, for the runway estimate; reset by a compaction. Absent before 0.4.0. */
  turnTokens?: number[]
}

/** One tool call and how long it took, among a turn's slowest. */
export type SlowCall = { text: string; ms: number }

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  /** How many calls of each tool the agent made, for the chips under its node. Absent in state saved before 0.2.0. */
  toolTally?: Record<string, number>
  answer: string
  /** The prompt it was spawned with (masked, at most 2000 characters). Absent in state saved before 0.2.0. */
  prompt?: string
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type LogLine = {
  at: number
  who: string
  text: string
  agentId: string | null
  kind: 'info' | 'error' | 'consult' | 'done'
}

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  costAtStart: number | null
  /** The turn's slowest tool calls so far, slowest first. Absent before 0.4.0. */
  slow?: readonly SlowCall[]
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
  /** The turn's slowest tool calls. Absent before 0.4.0. */
  slow?: readonly SlowCall[]
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

/**
 * `scrub`: how many comms messages the pane shows, to look back at an earlier moment; null follows the session live.
 * `collapsed` (0.8.0): the panels folded to their header row. `logErrors`: the log shows its failed calls alone.
 * `planOpen`: the plan panel lists every step. `hidden` (0.9.0): the panels switched off in the panels row, and
 * `panelsOpen`: whether that row is open. All five optional, so a view saved by an older build still reads.
 */
export type View = {
  expanded: string | null
  gateOpen: Bucket | 'all' | null
  layout: Layout | null
  scrub?: number | null
  collapsed?: string[]
  logErrors?: boolean
  planOpen?: boolean
  hidden?: string[]
  panelsOpen?: boolean
}

export type Roster = { architectTypes: string[] }

/** One thing said between two loops: the prompt a subagent was spawned with, or a SendMessage. `from` and `to` are agent ids, or `main`. */
export type MsgKind = 'prompt' | 'message'
export type Msg = { at: number; from: string; to: string; kind: MsgKind; text: string }

/** All the messages from one loop to another. */
export type Edge = { from: string; to: string; count: number; last: Msg }

/** A build or test run read from a Bash call's output. `passed` is null when the output gave no counts; `failed` includes errors. */
export type TestRun = {
  at: number
  /** The loop that ran it: an agent id, or `main`. */
  by: string
  command: string
  kind: 'maven' | 'tests' | 'tsc'
  passed: number | null
  failed: number
  skipped: number
  isOk: boolean
  /** Why a failed run failed: the line `failureLine` picks from its output; empty when it passed. Absent before 0.3.0's fix. */
  reason?: string
}

/** A file edited in this session, by which loops, and when last. */
export type FileTouch = { path: string; edits: number; by: string[]; firstAt: number; lastAt: number }

/**
 * The session folder's git state (0.6.0, absorbed from the git-info mod). `folder` is the folder's name,
 * `path` the whole path with the home folder as `~`; outside a work tree `isRepo` is false and the rest is empty.
 */
export type GitInfo = { folder: string; path: string; isRepo: boolean; branch: string | null; changes: number; pr: number | null }

/** A plan step's status (0.7.0, absorbed from the plan-bar mod). */
export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** The main chat's last tool call: what ("Bash: mvn test"), since when (epoch ms), still running, and whether it failed. */
export type Activity = { text: string; at: number; running: boolean; failed: boolean }

/** What the plan panel draws: the chat's plan, and whether the panel shows it now. */
export type BandPlan = {
  title: string
  /** When the plan began, epoch ms: the total under the bar and in the summary. */
  startedAt: number
  /**
   * `frac` is how far through its segment the step in progress is (0 to 0.9), computed when the pane draws, never stored;
   * `added` marks a step added after work began. `startedAt` and `doneAt` are epoch ms; `active` is TodoWrite's present-tense label.
   */
  steps: { text: string; status: PlanStatus; frac?: number; added?: boolean; startedAt?: number; doneAt?: number; active?: string }[]
  /** False once a finished plan has held at 100% for 20 s, or for an empty list. */
  shown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'chat-deck': {
      /** The plan the panel draws; null before the first plan. Absent before 0.7.0. */
      plan: BandPlan | null
      /** The main chat's last tool call while a plan shows. */
      planAct: Activity | null
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      log: LogLine[]
      comms: Msg[]
      turn: Turn
      receipt: Receipt | null
      view: View
      roster: Roster
      runs: TestRun[]
      files: FileTouch[]
      git: GitInfo
      /** Skills the session invoked, oldest first. Absent before 0.14.0. */
      skills: string[]
    }
  }
}

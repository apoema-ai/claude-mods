import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  COMPACT_TRIES,
  addCard,
  addMsg,
  cardLabel,
  chipsOf,
  edgesOf,
  noteTool,
  normalizeMsgs,
  resolveTo,
  sceneAt,
  stepScrub,
  withArchitect,
  cellWidth,
  piecesThatFit,
  afterCompactRead,
  claimCompactRead,
  faultKey,
  forgetCompactRead,
  resumeCard,
  afterCall,
  applyStep,
  compactWindowOf,
  consultTimeline,
  contextFill,
  describeInput,
  endConsult,
  addRun,
  allowRule,
  effortLevel,
  hotspots,
  runway,
  slowest,
  slowBar,
  splitFailure,
  logTally,
  wrapLines,
  editsSince,
  failureLine,
  noteFile,
  parseTestRun,
  runCounts,
  fmtResetIn,
  fmtSpeed,
  gateSummary,
  lanes,
  limitLabel,
  limitOf,
  logRows,
  marksIn,
  momentOf,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  titleLines,
  hiddenPanels,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  redact,
  settleCheck,
  trimRecent,
  startConsult,
  stepSpeed,
  DEFAULT_GIT,
  changeCount,
  folderOf,
  normalizeGit,
  prOf,
  sameGit,
  tildePath,
  midCut,
} from '../hooks/core'
import { crabSvg, effortSvg, flowSvg, meterSvg } from '../hooks/draw'
import type { Check, Msg } from '../types'

// ---------------------------------------------------------------- pure behaviour

test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
})

const check = (id: string, verdict: Check['verdict'], bucket: Check['bucket'] = 'shell'): Check => ({
  id,
  tool: 'Bash',
  bucket,
  verdict,
  inSubagent: false,
  detail: 'Bash → ls',
  at: 1,
})

test('an ask is settled by the call that follows: cleared if it ran, deny if refused', () => {
  let g = recordCheck(DEFAULT_GATE, check('a', 'ask'))
  g = recordCheck(g, check('b', 'ask'))
  g = recordCheck(g, check('c', 'rule', 'file'))
  g = settleCheck(g, 'a', true)
  g = settleCheck(g, 'b', false)
  g = settleCheck(g, 'zzz', true) // not an ask: unchanged
  const s = gateSummary(g)
  expect([s.rule, s.ask, s.cleared, s.deny, s.total]).toEqual([1, 0, 1, 1, 3])
  expect(g.recent.map(c => c.verdict)).toEqual(['cleared', 'deny', 'rule'])
})

test('the gate tallies a mixed run of verdicts per family', () => {
  let g = DEFAULT_GATE
  g = recordCheck(g, check('r1', 'rule', 'file'))
  g = recordCheck(g, check('a1', 'ask', 'shell'))
  g = recordCheck(g, check('a2', 'ask', 'shell'))
  g = recordCheck(g, check('d1', 'deny', 'other'))
  g = settleCheck(g, 'a1', true)
  g = settleCheck(g, 'a2', false)
  expect(g.totals.file).toEqual({ rule: 1, ask: 0, cleared: 0, deny: 0 })
  expect(g.totals.shell).toEqual({ rule: 0, ask: 0, cleared: 1, deny: 1 })
  expect(g.totals.other.deny).toBe(1)
  expect(gateSummary(g)).toEqual({ rule: 1, ask: 0, cleared: 1, deny: 2, total: 4 })
  expect(gateSummary(DEFAULT_GATE).total).toBe(0)
})

test('a v1-shaped gate reads as empty, then records normally', () => {
  const g = normalizeGate({ file: { allow: 3, ask: 1, deny: 0, cleared: 2 }, shell: null })
  expect(gateSummary(g).total).toBe(0)
  const next = recordCheck(g, check('n1', 'rule', 'file'))
  expect(next.totals.file.rule).toBe(1)
  expect(next.recent.length).toBe(1)
})

test('a pending ask is never trimmed out before it settles', () => {
  let g = recordCheck(DEFAULT_GATE, check('old-ask', 'ask'))
  for (let i = 0; i < 120; i += 1) g = recordCheck(g, check(`r${i}`, 'rule', 'file'))
  expect(g.recent.length).toBe(80)
  expect(g.recent.some(c => c.id === 'old-ask')).toBe(true)
  g = settleCheck(g, 'old-ask', true)
  expect(gateSummary(g).ask).toBe(0)
  expect(trimRecent([check('a', 'rule'), check('b', 'rule')], 5).length).toBe(2)
})

test('edits count from every loop; errors only from the main loop', () => {
  const t = { ...DEFAULT_TURN, errorStreak: 1 }
  expect(afterCall(t, { inSubagent: true, hasFailed: false, isEdit: true }).edits).toBe(1)
  expect(afterCall(t, { inSubagent: true, hasFailed: true, isEdit: false }).errorStreak).toBe(1)
  expect(afterCall(t, { inSubagent: false, hasFailed: true, isEdit: false })).toEqual({ ...t, errorStreak: 2, errors: 1 })
  expect(momentOf(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: false, isEdit: true }))).toBe('before done')
  expect(momentOf({ edits: 0, errorStreak: 2 })).toBe('error repeats')
})

test("a card's context is its latest step's whole input; output adds up", () => {
  let c = normalizeCard({ id: 'x' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, output_tokens: 500 }, stopReason: 'tool_use' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 40_000, output_tokens: 700 }, stopReason: 'max_tokens' })
  expect([c.ctx, c.out, c.steps, c.lastStop, c.model]).toEqual([40_005, 1200, 2, 'max_tokens', 'claude-sonnet-5-5'])
})

test('a resumed agent runs again on its own card instead of adding a second', () => {
  const a = { ...normalizeCard({ id: 'a', description: 'first', spawnedAt: 5, model: 'claude-sonnet-5-5' }), status: 'done' as const, endedAt: 100, steps: 4, out: 900 }
  const b = normalizeCard({ id: 'b' })
  const cards = addCard(addCard(addCard([], a), b), { ...normalizeCard({ id: 'a', description: 'again', spawnedAt: 200 }) })
  expect(cards.map(c => `${c.id}:${c.description}`)).toEqual(['a:again', 'b:'])
  expect(cards[0] && [cards[0].status, cards[0].endedAt, cards[0].steps, cards[0].out, cards[0].spawnedAt]).toEqual(['running', null, 4, 900, 5])
  expect([resumeCard(a).status, resumeCard(a).endedAt]).toEqual(['running', null])
  // Spawned again on another model, the card names it; a spawn that names none keeps the card's.
  expect(addCard([a], normalizeCard({ id: 'a', model: 'claude-opus-5-5' }))[0]?.model).toBe('claude-opus-5-5')
  expect(addCard([a], normalizeCard({ id: 'a' }))[0]?.model).toBe('claude-sonnet-5-5')
})

test('consults open, close by id, and draw on a shared timeline', () => {
  let a = startConsult(DEFAULT_ARCHITECT, { id: 's1', at: 0, moment: 'before a plan', via: 'advisor tool' })
  a = startConsult(a, { id: 's1', at: 5, moment: 'before a plan', via: 'again' }) // same id: ignored
  a = endConsult(a, 10, null, 's1')
  a = startConsult(a, { id: 's2', at: 90, moment: 'before done', via: 'advisor tool' })
  expect(a.consults.length).toBe(2)
  expect(a.consults[0]?.endAt).toBe(10)
  const tl = consultTimeline(a, 100, 11)
  expect(tl.length).toBe(11)
  expect(tl.startsWith('◆━')).toBe(true)
  expect(tl.split('◆').length - 1).toBe(2)
})

test('config is read leniently: bad values fall back to defaults', () => {
  const d = parseConfig({})
  expect([d.paneColumns, d.layout, d.palette, d.openOnStart]).toEqual([66, 'auto', 'theme', true])
  expect(d.architect.test('fable-advisor:fable-advisor')).toBe(true)
  const c = parseConfig({ architectPattern: '([', layout: 'diagonal', palette: 'neon', openOnStart: 'yes' })
  expect(c.architect.test('advisor')).toBe(true) // invalid regex → default
  expect([c.layout, c.palette, c.openOnStart]).toEqual(['auto', 'theme', true])
  expect([46.4, 12, Number.NaN, '90'].map(n => parseConfig({ paneColumns: n }).paneColumns)).toEqual([46, 40, 66, 66])
})

test('hidden panels read from stored state: unknown names and repeats are dropped', () => {
  expect(hiddenPanels(['log', 'gate', 'nope', 'gate', 7])).toEqual(['log', 'gate'])
  expect(hiddenPanels('log')).toEqual([])
  expect(hiddenPanels(undefined)).toEqual([])
})

test('state saved under an older shape still reads', () => {
  expect(normalizeLog([{ at: '08:00:00', who: 'jev', text: 'x' }])[0]).toEqual({ at: 0, who: 'jev', text: 'x', agentId: null, kind: 'info' })
  const g = normalizeGate({ file: { allow: 1 } }) // v1 gate shape
  expect(g.recent).toEqual([])
  expect(g.totals.shell.rule).toBe(0)
  expect(normalizeCard({ id: 'a', status: 'done' }).tools).toEqual([])
})

test('layout math: lanes share one axis, the log gets 4-8 rows', () => {
  const cards = [
    { ...normalizeCard({}), id: 'a', spawnedAt: 1000, endedAt: 1050 },
    { ...normalizeCard({}), id: 'b', spawnedAt: 1050, endedAt: null },
  ]
  const [a, b] = lanes(cards, 1100, 20)
  expect(a).toEqual({ id: 'a', before: 0, bar: 10, after: 10 })
  expect(b?.before).toBe(10)
  expect((b?.before ?? 0) + (b?.bar ?? 0) + (b?.after ?? 0)).toBe(20)
  expect([logRows(10, 40), logRows(50, 40), logRows(200, 40)]).toEqual([4, 7, 8])
  expect([marksIn(64, true), marksIn(64, false), marksIn(6, false)]).toEqual([64, 42, 4])
  expect(limitLabel('five_hour')).toBe('5h')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(prettyModel('claude-3-opus-20240229')).toBe('Opus 3')
  expect(prettyModel('z-ai/glm-5.3-flash-with-a-long-name')).toBe('z-ai/glm-5.3-flash-wi…')
  expect(prettyModel('')).toBe('—')
  expect(promptLine('fix the parser')).toEqual({ who: 'you', text: 'fix the parser' })
  const hb = '<agent-message from="a1940a83d593229d5">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Add gate tests: redaction edge cases.\n  - more\n</agent-message>'
  expect(handbackOf(hb)).toEqual({ from: 'a1940a83d593229d5', body: 'Add gate tests: redaction edge cases.' })
  expect(handbackOf('<agent-message from="x">\nPlain report line\n</agent-message>')).toEqual({ from: 'x', body: 'Plain report line' })
  expect(handbackOf('fix the parser')).toBe(null)
  expect(adviceLine('## Ship it after one more gate test.\n- details')).toBe('Ship it after one more gate test.')
  expect(adviceLine('[Subagent hand-back] header\n\n**Fix card overflow first**')).toBe('Fix card overflow first')
  expect(adviceLine('')).toBe('')
  expect(promptLine('<agent-message from="a1492260715f3be7b"> [Subagent hand-back]')).toEqual({ who: 'engine', text: 'agent message from a1492260' })
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 5 }, { durationMs: 1, agentsSince: 0, costNow: 5, reason: 'answer' }).costDelta).toBe(null)
  expect(titleLines('Write tinyqueue test suite', 13, 16)).toEqual(['Write', 'tinyqueue test…'])
  expect(titleLines('Short', 13, 16)).toEqual(['Short', ''])
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 1, edits: 2 }, { durationMs: 1000, agentsSince: 3, costNow: 1.5, reason: 'answer' }).costDelta).toBe(0.5)
})

test('a request\'s speed is its time to the first piece of response, and no output rate', () => {
  expect(stepSpeed(1000, 1800)).toEqual({ ttftMs: 800 })
  expect(stepSpeed(1000, null)).toBe(null) // no response arrived
  expect(fmtSpeed({ ttftMs: 1250 })).toBe('ttft 1.3s')
  // State saved by 0.5.0 still carries a rate: it is not drawn.
  expect(fmtSpeed({ ttftMs: 800, tokPerS: 9844 } as { ttftMs: number })).toBe('ttft 0.8s')
})

test('a window keeps its reset time, drawn as the time left', () => {
  expect(limitOf({ kind: 'five_hour', percentUsed: 19, resetsAt: '1970-01-01T03:10:00.000Z' })).toEqual({ kind: 'five_hour', pct: 19, resetsAt: 11_400_000 })
  expect(limitOf({ kind: 'seven_day', percentUsed: 3 }).resetsAt).toBe(null)
  expect(limitOf({ kind: 'spend_limit', percentUsed: 1, resetsAt: 'soon' }).resetsAt).toBe(null)
  expect([fmtResetIn(11_400_000, 0), fmtResetIn(25 * 60_000 + 5_000, 0), fmtResetIn(4 * 86_400_000 + 2 * 3_600_000, 0)]).toEqual(['3h10m', '25m', '4d2h'])
  expect([fmtResetIn(null, 0), fmtResetIn(undefined, 0), fmtResetIn(5, 10)]).toEqual(['', '', ''])
})

// ---------------------------------------------------------------- drawing

const engine = (on: On) => {
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const pane = (bodyColumns: number) => ({
  plugin: 'chat-deck',
  component: 'Pane' as const,
  requestId: 'chatdeck',
  props: {
    title: 'Chat Deck',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawnN = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

test('a fresh session draws on every surface and width, empty panels hidden', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 60, 86, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /· main$/ })).toBeDefined()
      expect(await ui.find({ text: /session log/ })).toBeDefined()
      expect(await ui.find({ text: /agents ·/ })).toBeUndefined() // no subagents: no agents panel
      expect(await ui.find({ text: /permissions/ })).toBeUndefined() // no checks yet: no gate panel
      await ui.unmount()
    }
  }
})

test('inline above the prompt, the pane is a summary of at most 8 rows', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (const d of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'm-k1' })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    const root = (await ui.drawn()) as { children?: unknown[] }
    expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
    expect(await ui.find({ text: /\+2 more agents/ })).toBeDefined()
    // The panels control is on the summary too, not only in the full layouts.
    expect(await ui.find({ key: 'panels-toggle' })).toBeDefined()
    expect(await ui.find({ text: /1 allowed/ })).toBeDefined()
    expect(await ui.find({ text: /session log/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('/clear starts the pane fresh', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  await $.turn.start({ text: 'go', turnId: 'C1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /look around/ })).toBeUndefined()
  await ui.unmount()
})

// 0.8.0: titles are plain text, so the theme is read off a status colour: the main card's idle mark.
test('colours come from the theme by default, raw hex only when asked', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^○ idle$/ }))?.props.color).toBe('inactive')
  await ui.unmount()
})

test('pastel keeps the fixed dark-terminal colours', { options: { palette: 'pastel' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^○ idle$/ }))?.props.color).toBe('#6b7280')
  await ui.unmount()
})

test('subagents become cards, then swimlanes past the card limit; a card expands on its hotkey', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Write the parser/ })).toBeDefined()
  expect(await ui.find({ text: /Sonnet 5\.5/ })).toBeDefined() // differs from main: shown
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const lanesUi = await $.ui.mount({ ...pane(64), surface })
    expect(await lanesUi.find({ text: /4 total/ })).toBeDefined()
    expect(await lanesUi.find({ text: /━/ })).toBeDefined()
    await lanesUi.unmount()
  }
})

test('the server-side advisor is read from assistant rows: consulting, then on call', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'plan it', turnId: 'T2' })
  const row = (content: unknown[]) =>
    $.session
      .append({
        message: { type: 'assistant', role: 'assistant', content: content as never },
        door: 'response',
        origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
        uuid: `u${++spawnN}`,
      })
      .catch(() => undefined) // the test has no transcript to store rows in
  await row([{ type: 'server_tool_use', id: 'srv1', name: 'advisor', input: {} }])
  const mid = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await mid.find({ text: /ARCHITECT · advising/ })).toBeDefined()
  expect(await mid.find({ text: /◆ before a plan/ })).toBeDefined()
  await mid.unmount()

  await row([{ type: 'advisor_tool_result', tool_use_id: 'srv1', content: { type: 'advisor_redacted_result' } }])
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await after.find({ text: /^1$/ })).toBeDefined()
  await after.unmount()
})

test('the gate strip fills from checks and a row opens its redacted drill-down', async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefgh12345" api' }, tool_use_id: 'k2' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 checks/ })).toBeDefined()
  expect(await ui.find({ text: /1 pending/ })).toBeDefined()
  await ui.press({ key: 'gate-shell' })
  expect(await ui.find({ text: /Authorization: Bearer •••/ })).toBeDefined()
  expect(await ui.find({ text: /abcdefgh12345/ })).toBeUndefined()
  expect(await ui.find({ text: /Read → a\/b\.ts/ })).toBeUndefined() // the file check is not a shell one
  // "all" lists every kind together, and a second press closes it.
  await ui.press({ key: 'gate-all' })
  expect(await ui.find({ text: /all 2 ▾/ })).toBeDefined()
  expect(await ui.find({ text: /Read → a\/b\.ts/ })).toBeDefined()
  expect(await ui.find({ text: /Authorization: Bearer •••/ })).toBeDefined()
  await ui.press({ key: 'gate-all' })
  expect(await ui.find({ text: /Read → a\/b\.ts/ })).toBeUndefined()
  await ui.unmount()
})

test('the panels row hides and shows panels, and a reset keeps the choice', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: `r${++n}` }))
  await $.turn.start({ text: 'review it', turnId: 'T3' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT · advising/ })).toBeDefined()
  // Closed, the row is one line: no panel buttons yet.
  expect(await ui.find({ text: /▸ panels/ })).toBeDefined()
  expect(await ui.find({ key: 'panels-toggle' })).toBeDefined()
  expect(await ui.find({ text: /● architect/ })).toBeUndefined()
  await ui.press({ key: 'panels-toggle' })
  expect(await ui.find({ text: /▾ panels/ })).toBeDefined()
  // Every panel has a button; the row itself has none.
  expect(await ui.find({ text: /● main/ })).toBeDefined()
  expect(await ui.find({ text: /● log/ })).toBeDefined()
  expect(await ui.find({ text: /● panels/ })).toBeUndefined()
  await ui.press({ key: 'panel-architect' })
  expect(await ui.find({ text: /○ architect/ })).toBeDefined()
  expect(await ui.find({ text: /ARCHITECT · advising/ })).toBeUndefined()
  await ui.press({ key: 'panels-toggle' })
  expect(await ui.find({ text: /▸ panels · 1 hidden/ })).toBeDefined()
  await ui.unmount()
  // A reset clears the session, not the choice of panels.
  await $.command.run({ command: 'chatdeck', args: 'reset' } as never)
  const again = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await again.find({ text: /▸ panels · 1 hidden/ })).toBeDefined()
  await again.press({ key: 'panels-toggle' })
  expect(await again.find({ text: /○ architect/ })).toBeDefined()
  await again.press({ key: 'panel-architect' })
  expect(await again.find({ text: /● architect/ })).toBeDefined()
  await again.unmount()
})

test('a consult whose start and result share one row closes, and its review flag with it', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'go', turnId: 'T4' })
  // An edit first, so the consult is inferred as "before done" and sets the review flag.
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.session
    .append({
      message: {
        type: 'assistant',
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'srv9', name: 'advisor', input: {} },
          { type: 'advisor_tool_result', tool_use_id: 'srv9', content: { type: 'advisor_redacted_result' } },
        ] as never,
      },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'one-row',
    })
    .catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await ui.find({ text: /◆ before done/ })).toBeDefined()
  expect(await ui.find({ text: /reviewing before done/ })).toBeUndefined()
  await ui.unmount()
})

test('with no architect anywhere, the panel, legend entry and status field stay hidden', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT/ })).toBeUndefined()
  expect(await ui.find({ text: /^ architect$/ })).toBeUndefined()
  await ui.unmount()
})

test('cards that cannot fit the pane fall back to lanes', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta', 'gamma']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ text: /━/ })).toBeDefined() // lanes
  await narrow.unmount()
  const wide = await $.ui.mount({ ...pane(70), surface: 'terminal' })
  expect(await wide.find({ text: /━/ })).toBeUndefined() // three cards fit in 70
  expect(await wide.find({ text: /task gamma/ })).toBeDefined()
  await wide.unmount()
})

test("a background architect's advice is read from its hand-back", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'fab1' }))
  await $.turn.start({ text: 'review it', turnId: 'H1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'H1', agentId: 'fab1', reason: 'answer' })
  await $.turn.start({
    text: '<agent-message from="fab1">\n[Subagent hand-back] The report follows:\n  Ship it after one more gate test.\n</agent-message>',
    turnId: 'H2',
  })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /» Ship it after one more gate test\./ })).toBeDefined()
  await ui.unmount()
})

test('each rate-limit window shows the time to its reset where the main panel has room', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const at = (ms: number) => new Date(ms).toISOString()
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 19, resetsAt: at(3 * 3_600_000 + 10 * 60_000) },
      { kind: 'seven_day', percentUsed: 3, resetsAt: at(4 * 86_400_000 + 2 * 3_600_000) },
    ],
    changed: ['rateLimits'],
  })
  for (const cols of [64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /19% ↻3h10m/ })).toBeDefined()
    expect(await ui.find({ text: /3% ↻4d2h/ })).toBeDefined()
    await ui.unmount()
  }
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ text: /19%/ })).toBeDefined()
  expect(await narrow.find({ text: /↻/ })).toBeUndefined() // no room: the gauges stay whole
  await narrow.unmount()
})

test("the main box shows the last request's time to first token, and no tokens per second", async ($, on) => {
  const clock = engine(on)
  // The model beneath: 800 ms to its first words, then 2 s more to stop after 120 tokens.
  on('turn.step', async function* () {
    await clock.sleep(800)
    yield { kind: 'text' as const, index: 0, text: 'hello' }
    await clock.sleep(2000)
    const usage = { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'S1', index: 0, answer: 'hello', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const before = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await before.find({ text: /ttft/ })).toBeUndefined() // nothing measured yet: no line
  await before.unmount()
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const first = s.next()
  await clock.advance(800)
  expect((await first).value).toEqual({ kind: 'text', index: 0, text: 'hello' })
  const stop = s.next()
  await clock.advance(2000)
  await stop
  for await (const _ of s) void _
  await s.result
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /ttft 0\.8s$/ })).toBeDefined()
    expect(await ui.find({ text: /tok\/s/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('on a graphical surface, rows of marks hold fewer marks, keep the newest and clip at their box', async ($, on) => {
  engine(on)
  // The newest check is the one refused: its ✗ must stay in sight. The others ask (the strip leaves out what a rule allowed).
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'g29' ? 'deny' : 'ask' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'G1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  for (let i = 0; i < 30; i += 1) await $.tool.check({ tool: 'Read', input: { file_path: `/f${i}.ts` }, tool_use_id: `g${i}` })
  // A loop that is no card and no architect: a dot on the "other loops" row.
  const s = $.turn.step({ turnId: 'G1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'wf1' })
  for await (const _ of s) void _
  await s.result
  await $.session
    .append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'server_tool_use', id: 'srvG', name: 'advisor', input: {} }] as never },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'marks-row',
    })
    .catch(() => undefined)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      // A terminal draws all 30 marks; a graphical surface draws fewer where 30 would not fit
      // (24 in the 36 cells of a 40-column pane), always ending on the newest.
      const strip = await ui.find({ type: 'Text', text: /^[■✗]{2,}$/ })
      expect(strip?.props.wrap).toBe('truncate-start')
      expect(strip?.text.length).toBe(surface !== 'terminal' && cols === 40 ? 24 : 30)
      expect(strip?.text.endsWith('✗')).toBe(true)
      expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.wrap).toBe('truncate-start')
      // 0.8.0: one consult has no history to draw; the timeline shows from the second.
      expect(await ui.find({ type: 'Text', text: /^[─━◆]*[─━][─━◆]*$/ })).toBeUndefined()
      expect((await ui.find({ key: 'header' }))?.props.marginBottom).toBe(surface === 'terminal' ? 0 : 1)
      await ui.unmount()
    }
  }
})

test("the inline summary's strip holds fewer marks on a graphical surface and keeps the newest", async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'n59' ? 'deny' : 'allow' }))
  for (let i = 0; i < 60; i += 1) await $.tool.check({ tool: 'Bash', input: { command: `ls ${i}` }, tool_use_id: `n${i}` })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    // 80 columns less "gate " and " 59 allowed · 0 cleared · 1 denied" (no mode known) leave 41: 41 marks in a terminal, 27 elsewhere.
    const strip = await ui.find({ type: 'Text', text: /^[■✗]{2,}$/ })
    expect(strip?.props.wrap).toBe('truncate-start')
    expect(strip?.text.length).toBe(surface === 'terminal' ? 41 : 27)
    expect(strip?.text.endsWith('✗')).toBe(true)
    expect(await ui.find({ text: /59 allowed/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a draw that fails says why instead of leaving the pane empty', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => {
    throw new Error('boom')
  })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /^draw failed \(throw\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a finished agent that takes another step (resumed by SendMessage) runs again, in the pane and the status line', async ($, on) => {
  // engine(on), with a status line that keeps what it was told
  mock.clock(on)
  const status: (string | undefined)[] = []
  on('ui.status', (_$, e) => (status.push(e.text), { value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'r1' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'R1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async () => {
    const s = $.turn.step({ turnId: 'R1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'r1' })
    for await (const _ of s) void _
    await s.result
  }
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'R1', agentId: 'r1', reason: 'answer' })
  expect(status[status.length - 1]).toMatch(/agents 0\/1/)
  await step()
  expect(status[status.length - 1]).toMatch(/agents 1\/1/)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /◐ running/ })).toBeDefined()
  expect(await ui.find({ text: /✓ done/ })).toBeUndefined()
  expect(await ui.find({ text: /^resumed$/ })).toBeDefined()
  expect(await ui.find({ text: /ctx 10 · out 10 · 2 steps/ })).toBeDefined()
  await ui.unmount()
})

test('the docked pane asks for the width set in paneColumns', { options: { paneColumns: 46 } }, async ($, on) => {
  engine(on)
  const asked: (number | undefined)[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => (asked.push(e.columns), { value: { isPlaced: true as const } }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(asked).toEqual([46])
})

test('git state: folder, porcelain count, PR answers and older state', () => {
  expect([folderOf('/Users/x/workspace/repo'), folderOf('/'), folderOf('C:\\w\\repo')]).toEqual(['repo', '/', 'repo'])
  expect([tildePath('/Users/x/w', '/Users/x'), tildePath('/Users/xy/w', '/Users/x'), tildePath('/Users/x', '/Users/x'), tildePath('/a', '')]).toEqual(['~/w', '/Users/xy/w', '~', '/a'])
  expect([changeCount(''), changeCount(' M a.ts\n?? b.ts\n'), changeCount('\n\n')]).toEqual([0, 2, 0])
  // gh failed or the branch has no PR: no answer (undefined); a number is the PR.
  expect([prOf(null), prOf('42\n'), prOf(''), prOf('abc'), prOf('0')]).toEqual([undefined, 42, null, null, null])
  expect(normalizeGit({ folder: 'r', branch: '', pr: 1.5, changes: -1 })).toEqual({ ...DEFAULT_GIT, folder: 'r' })
  expect(normalizeGit(null)).toEqual(DEFAULT_GIT)
  expect(sameGit(DEFAULT_GIT, { ...DEFAULT_GIT })).toBe(true)
  expect(sameGit(DEFAULT_GIT, { ...DEFAULT_GIT, changes: 1 })).toBe(false)
})

// A fake git and gh: each argv answered by the first key it contains, exit 1 for the rest.
const fakeGit = (on: On, out: Record<string, string>) =>
  on('process.run', (_$, e) => {
    const argv = e.argv.join(' ')
    const k = Object.keys(out).find(x => argv.includes(x))
    return { value: k !== undefined ? { exitCode: 0, stdout: out[k], stderr: '' } : { exitCode: 1, stdout: '', stderr: '' } } as never
  })

const startSession = async ($: Parameters<TestBody>[0], on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: '/home/me/workspace/deck-repo' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
}

test('the git panel shows the branch, its PR and the uncommitted files', async ($, on) => {
  engine(on)
  fakeGit(on, { 'is-inside-work-tree': 'true', 'show-current': 'INV-1-git-panel', '--porcelain': ' M a.ts\n?? b.ts', 'pr view': '42' })
  await startSession($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const cols of [40, 86, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /⎇ INV-1-git/ })).toBeDefined()
      expect(await ui.find({ text: 'PR #42' })).toBeDefined()
      expect(await ui.find({ text: '± 2 uncommitted' })).toBeDefined()
      await ui.unmount()
    }
  }
  // Inline, the summary row carries the branch with its count and PR.
  const mini = await $.ui.mount({ ...pane(120), props: { ...pane(120).props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await mini.find({ text: /⎇ INV-1-git-panel/ })).toBeDefined()
  await mini.unmount()
})

test('outside a repository the git panel names the folder alone; a clean tree with no PR says so', async ($, on) => {
  engine(on)
  fakeGit(on, {})
  await startSession($, on)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: 'not a repository' })).toBeDefined()
  expect(await ui.find({ text: '~/workspace/deck-repo' })).toBeDefined()
  expect(await ui.find({ text: /PR/ })).toBeUndefined()
  await ui.unmount()
})

test('a clean branch with no PR draws clean and no PR', async ($, on) => {
  engine(on)
  fakeGit(on, { 'is-inside-work-tree': 'true', 'show-current': 'main' })
  await startSession($, on)
  const ui = await $.ui.mount({ ...pane(86), surface: 'terminal' })
  expect(await ui.find({ text: '✓ clean' })).toBeDefined()
  expect(await ui.find({ text: 'no PR' })).toBeDefined()
  await ui.unmount()
})

test('the context gauge measures against a compaction window set below the model window', () => {
  const u = { ...DEFAULT_USAGE, tokens: 200_000, window: 1_000_000, compactWindow: 400_000 }
  // From the real reading, not the model's percentage: 200k of 400k.
  expect(contextFill(u)).toEqual({ pct: 50, window: 400_000 })
  expect(contextFill({ ...u, tokens: 100_000 })).toEqual({ pct: 25, window: 400_000 })
  // None set, or not below the model's window: the model's window.
  expect(contextFill({ ...u, compactWindow: null })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 1_000_000 })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 1_500_000 })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 0 })).toEqual({ pct: 20, window: 1_000_000 })
  // No reading yet, no gauge; and none from a window not yet known.
  expect(contextFill({ ...u, tokens: null })).toEqual({ pct: null, window: 400_000 })
  expect(contextFill(DEFAULT_USAGE)).toEqual({ pct: null, window: 0 })
  expect(contextFill({ ...DEFAULT_USAGE, tokens: 5 }).pct).toBeNull()
})

test('a breakdown names a compaction window only when auto-compaction is on and it is below the model window', () => {
  const on = { rawMaxTokens: 400_000, isAutoCompactEnabled: true }
  expect(compactWindowOf(on, 1_000_000)).toBe(400_000)
  expect(compactWindowOf({ ...on, isAutoCompactEnabled: false }, 1_000_000)).toBeNull()
  expect(compactWindowOf({ ...on, rawMaxTokens: 1_000_000 }, 1_000_000)).toBeNull() // the model's own limit
  expect(compactWindowOf(on, 200_000)).toBeNull() // a model switch to a smaller window
  expect(compactWindowOf({ ...on, rawMaxTokens: 0 }, 1_000_000)).toBeNull()
  expect(compactWindowOf(undefined, 1_000_000)).toBeNull() // no breakdown: unknown
  expect(compactWindowOf(null, 1_000_000)).toBeNull()
})

/** A session whose `session.usage` answers as a host does: the breakdown only to a call that asks for one. */
const compactHost = (on: On, o: { window: () => number; compact: number | null; isEnabled?: boolean; tokens?: number }) => {
  const asked: (string | undefined)[] = []
  on('session.usage', (_$, e) => {
    asked.push(e.breakdown)
    const window = o.window()
    const breakdown =
      e.breakdown && o.compact !== null
        ? { rawMaxTokens: o.compact, isAutoCompactEnabled: o.isEnabled ?? true, totalTokens: 123, percentage: 99 }
        : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window, ...(o.tokens !== undefined ? { tokens: o.tokens } : {}), ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  return asked
}

test('the gauge, status and inline summary measure against the compaction window, read once per model window', async ($, on) => {
  mock.clock(on)
  let status: string | undefined
  on('ui.status', (_$, e) => {
    status = e.text
    return { value: undefined }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let window = 1_000_000
  const asked = compactHost(on, { window: () => window, compact: 400_000 })
  const measure = (tokens: number) =>
    $.session.measure({ context: { window, tokens, percent: tokens / (window / 100) }, rateLimits: [], changed: ['context'] })
  await measure(100_000)
  await measure(150_000)
  await measure(200_000)
  // Three measurements, one summary breakdown: never `full`, which would send token-count requests.
  expect(asked.filter(Boolean)).toEqual(['summary'])
  expect(status).toBe('ctx 50%') // not the host's 20% of a million
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /200k\/400k/ })).toBeDefined()
    expect(await ui.find({ text: / 50%/ })).toBeDefined()
    expect(await ui.find({ text: /1\.0M/ })).toBeUndefined()
    await ui.unmount()
    const mini = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement: 'inline' as const }, surface: 'terminal' })
    expect(await mini.find({ text: / 50%/ })).toBeDefined()
    await mini.unmount()
  }
  // Past 80% of the compaction window the gauge warns, though the model's window has room.
  await measure(340_000)
  const warn = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await warn.find({ type: 'Text', text: /^▰+$/ }))?.props.color).toBe('error')
  expect(await warn.find({ text: / 85%/ })).toBeDefined()
  await warn.unmount()
  // A model with a smaller window: read again, and a compaction window above it no longer counts.
  window = 200_000
  await measure(100_000)
  expect(asked.filter(Boolean)).toEqual(['summary', 'summary'])
  const small = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await small.find({ text: /100k\/200k/ })).toBeDefined()
  await small.unmount()
})

const keepsModelWindow = (name: string, host: { compact: number | null; isEnabled?: boolean }, asks: number) =>
  test(name, async ($, on) => {
    mock.clock(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    const asked = compactHost(on, { window: () => 1_000_000, ...host })
    for (const tokens of [50_000, 100_000, 200_000, 250_000, 300_000]) {
      await $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
    }
    // An answer is asked for once; no breakdown (no session bound yet) is asked again, COMPACT_TRIES in all.
    expect(asked.filter(Boolean).length).toBe(asks)
    for (const cols of [40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
      expect(await ui.find({ text: /300k\/1\.0M/ })).toBeDefined()
      expect(await ui.find({ text: / 30%/ })).toBeDefined()
      await ui.unmount()
    }
  })

keepsModelWindow('a host that gives no breakdown keeps the model window and stops asking after 3 tries', { compact: null }, 3)
keepsModelWindow('with auto-compaction off the gauge keeps the model window and is asked once', { compact: 400_000, isEnabled: false }, 1)

test('a resumed session reads its compaction window at start, and /clear leaves the reading alone', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'chatdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  // Resumed with 200k already in context.
  const asked = compactHost(on, { window: () => 1_000_000, compact: 400_000, tokens: 200_000 })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(asked).toEqual([undefined, 'summary'])
  const resumed = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await resumed.find({ text: /200k\/400k/ })).toBeDefined()
  expect(await resumed.find({ text: / 50%/ })).toBeDefined()
  await resumed.unmount()
  // The gauge waits for the next measurement after a /clear; the compaction window is not asked again.
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], changed: ['context'] })
  expect(asked).toEqual([undefined, 'summary'])
  const cleared = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await cleared.find({ text: /100k\/400k/ })).toBeDefined()
  expect(await cleared.find({ text: / 25%/ })).toBeDefined()
  await cleared.unmount()
})

test('a compaction-window read that fails is asked again at the next measurement', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let reads = 0
  on('session.usage', (_$, e) => {
    if (e.breakdown && ++reads === 1) return { deny: 'not bound yet' }
    const breakdown = e.breakdown ? { rawMaxTokens: 400_000, isAutoCompactEnabled: true } : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  const measure = (tokens: number) =>
    $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
  await measure(100_000)
  const failed = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await failed.find({ text: /100k\/1\.0M/ })).toBeDefined()
  await failed.unmount()
  await measure(200_000)
  await measure(300_000)
  expect(reads).toBe(2) // the failed read once more, then not again
  const read = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await read.find({ text: /300k\/400k/ })).toBeDefined()
  expect(await read.find({ text: / 75%/ })).toBeDefined()
  await read.unmount()
})

test('a compaction-window read is claimed once per model window, missed reads retried up to a cap, stale ones dropped', () => {
  const b = { rawMaxTokens: 400_000, isAutoCompactEnabled: true }
  const fresh = { ...DEFAULT_USAGE, window: 1_000_000 }
  const first = claimCompactRead(fresh, 1_000_000)
  expect([first.isClaimed, first.usage.compactFor]).toEqual([true, 1_000_000])
  expect(claimCompactRead(first.usage, 1_000_000).isClaimed).toBe(false) // already claimed
  expect(afterCompactRead(first.usage, 1_000_000, b).compactWindow).toBe(400_000)
  // A read for a window no longer claimed (the model switched while it ran) changes nothing.
  const switched = claimCompactRead({ ...first.usage, window: 1_000_000 }, 200_000).usage
  expect(afterCompactRead(switched, 1_000_000, b)).toBe(switched)
  // A miss (no breakdown, or a failed call) gives the claim back and counts; COMPACT_TRIES misses stop asking.
  let u = first.usage
  for (let i = 0; i < COMPACT_TRIES; i += 1) {
    const c = claimCompactRead(u, 1_000_000)
    expect(c.isClaimed || i === 0).toBe(true)
    u = afterCompactRead(c.isClaimed ? c.usage : u, 1_000_000, i % 2 ? null : undefined)
  }
  expect([u.compactFor, u.compactMisses, u.compactWindow]).toEqual([0, COMPACT_TRIES, null])
  expect(claimCompactRead(u, 1_000_000).isClaimed).toBe(false)
  // Another model window, or another model, starts afresh.
  expect(claimCompactRead(u, 200_000).isClaimed).toBe(true)
  expect(claimCompactRead(forgetCompactRead({ ...u, compactWindow: 400_000 }), 1_000_000).isClaimed).toBe(true)
  expect(forgetCompactRead({ ...u, compactWindow: 400_000 }).compactWindow).toBe(null)
})

test("a surface module's fault key is the same for the hook's path, either separator, and the drawing's name", () => {
  expect(faultKey('desktop', 'hooks/rail.tsx')).toBe('desktop:rail.tsx')
  expect(faultKey('desktop', 'hooks\\rail.tsx')).toBe(faultKey('desktop', 'rail.tsx'))
  expect(faultKey('terminal', 'hooks/elapsed.tsx')).not.toBe(faultKey('desktop', 'hooks/elapsed.tsx'))
})

test('switching to another model with the same window reads its compaction window afresh', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let compact = 400_000
  let reads = 0
  on('session.usage', (_$, e) => {
    if (e.breakdown) reads += 1
    const breakdown = e.breakdown ? { rawMaxTokens: compact, isAutoCompactEnabled: true } : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'x' }
  on('turn.step', async function* () {
    return { turnId: 'M1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (model: string) => {
    const s = $.turn.step({ turnId: 'M1', index: 0, model, messageCount: 1 })
    for await (const _ of s) void _
    await s.result
  }
  const measure = (tokens: number) =>
    $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
  await step('claude-opus-5-5[1m]')
  await measure(300_000)
  await step('claude-opus-5-5[1m]')
  await measure(360_000)
  expect(reads).toBe(1) // the same model: not asked again
  // Another 1M model whose own autoCompactWindow (modelSettings) is 700k.
  compact = 700_000
  await step('claude-sonnet-5-5[1m]')
  await measure(360_000)
  expect(reads).toBe(2)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /360k\/700k/ })).toBeDefined()
  expect(await ui.find({ text: / 51%/ })).toBeDefined()
  await ui.unmount()
})

// Without the comms panel, which would list each prompt this test sends and so repeat a card's old title.
test('a resume through agent.spawn logs once, whether its spawn or its first step lands first; "done" times the run', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'R1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async () => {
    const s = $.turn.step({ turnId: 'R1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'r1' })
    for await (const _ of s) void _
    await s.result
  }
  // A resumed agent may take its first step before its spawn's own hooks have finished.
  let isStepFirst = false
  on('agent.spawn', async (_$, e) => {
    if (e.resume && isStepFirst) await step()
    return { model: 'claude-sonnet-5-5', agentId: e.resume?.agentId ?? 'r1' }
  })
  const complete = (durationMs: number) =>
    $.turn.complete({ answer: 'ok', durationMs, isAborted: false, turnId: 'R1', agentId: 'r1', reason: 'answer' })
  let isHidden = false
  const lines = async (re: RegExp) => {
    const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
    if (!isHidden) {
      // The comms panel would list each prompt this test sends and so repeat a card's old title.
      await ui.press({ key: 'panels-toggle' })
      await ui.press({ key: 'panel-comms' })
      isHidden = true
    }
    // Texts only: a wrapped line's Box holds the same text as its one row.
    const n = (await ui.findAll({ type: 'Text', text: re })).length
    await ui.unmount()
    return n
  }
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await clock.advance(60_000)
  await complete(60_000)
  // Idle half an hour, then resumed: the spawn first, then its step.
  await clock.advance(30 * 60_000)
  await $.agent.spawn({ ...spawn('general-purpose', 'Audit it again'), resume: { agentId: 'r1' } })
  await step()
  expect(await lines(/^resumed$/)).toBe(1)
  await clock.advance(90_000)
  await complete(90_000)
  // Resumed again, its first step landing inside the spawn.
  isStepFirst = true
  await $.agent.spawn({ ...spawn('general-purpose', 'And once more'), resume: { agentId: 'r1' } })
  expect(await lines(/^resumed$/)).toBe(2)
  expect(await lines(/^Audit the parser$/)).toBe(0) // one card, the latest task
  // Each run timed on its own, not from the first spawn.
  expect(await lines(/^done · 1m00s$/)).toBe(1)
  expect(await lines(/^done · 1m30s$/)).toBe(1)
})

test("a subagent's turn start is its own: no prompt line, and the main turn keeps its count", async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'refactor it', turnId: 'T1' })
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.turn.start({ text: 'Look at the parser again', turnId: 'A1', agentId: 'sub1' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'T1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Look at the parser again/ })).toBeUndefined()
  expect(await ui.find({ text: /refactor it/ })).toBeDefined()
  expect(await ui.find({ text: /^edits 1$/ })).toBeDefined()
  await ui.unmount()
})

test('a line keeps the pieces that fit, in order, counting each lead and the gaps between them', () => {
  const pieces = [{ width: 5 }, { width: 5, lead: 2 }, { width: 3 }]
  expect([piecesThatFit(pieces, 13, 1), piecesThatFit(pieces, 12, 1), piecesThatFit(pieces, 17, 1), piecesThatFit(pieces, 4, 1)]).toEqual([2, 1, 3, 0])
  expect([cellWidth('■ ▰▱ 48%'), cellWidth('')]).toEqual([8, 0])
})

// ---------------------------------------------------------------- width check

// The kit lays nothing out, so this measures the drawn tree as a row layout would: the fewest cells
// each element needs without spilling (a truncating Text or a clipping Box needs none, a Text that
// asks to wrap its longest word, any other Text its whole length, a plain Button with a hotkey `1: `
// more than its label), and checks that every Box given a width holds what it contains.
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isDrawn = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && typeof (n as Drawn).type === 'string'
const cellsOf = (s: string) => [...s].length
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isDrawn(n) ? (n.children ?? []).map(textOf).join('') : ''
const spaceOf = (v: unknown) => (typeof v === 'number' ? v : v === undefined ? 0 : 1)
const longestWord = (s: string) => Math.max(0, ...s.split(/\s+/).map(cellsOf))
const needs = (n: unknown, out: string[], path: string): number => {
  if (typeof n === 'string') return longestWord(n)
  if (!isDrawn(n)) return 0
  const p = n.props ?? {}
  const here = `${path}/${String(p.key ?? n.type)}`
  if (n.type === 'Text') return p.wrap === undefined ? cellsOf(textOf(n)) : p.wrap === 'wrap' ? longestWord(textOf(n)) : 1
  if (n.type === 'Button') return cellsOf(String(p.label ?? '')) + (p.plain ? (p.hotkey ? 3 : 0) : 4)
  if (n.type === 'Client') return typeof p.width === 'number' ? p.width : 5
  if (n.type !== 'Box') return 0
  const kids = (n.children ?? []).filter(c => c !== null && c !== undefined && c !== false && c !== '')
  const inner = kids.map((c, i) => needs(c, out, `${here}[${i}]`))
  const isColumn = p.flexDirection === 'column' || p.flexDirection === 'column-reverse'
  const content =
    isColumn || p.flexWrap === 'wrap'
      ? Math.max(0, ...inner)
      : inner.reduce((a, b) => a + b, 0) + spaceOf(p.columnGap ?? p.gap) * Math.max(0, inner.length - 1)
  const need = content + (p.borderStyle ? 2 : 0) + 2 * spaceOf(p.paddingX ?? p.padding)
  const margin = spaceOf(p.marginLeft) + spaceOf(p.marginRight) + 2 * spaceOf(p.marginX)
  // A Box with a width must hold its contents, clipping or not; one without clips to nothing if it may.
  if (typeof p.width === 'number') {
    if (need > p.width) out.push(`${here}: needs ${need} in ${p.width}`)
    return p.width + margin
  }
  return (p.overflow === 'hidden' ? 0 : need) + margin
}

/**
 * What a graphical surface needs of a line of text: no `truncate` Text nests Texts (the desktop app wraps the
 * nested pieces, or lays truncating ones out as blocks of their own), and no Text placed in a Box starts or
 * ends with a space (it collapses spaces, so a gap between pieces is the Box's, not the text's).
 */
const desktopFaults = (n: unknown, out: string[], path = '', parent = ''): string[] => {
  if (!isDrawn(n)) return out
  const p = n.props ?? {}
  const here = `${path}/${String(p.key ?? n.type)}`
  const kids = (n.children ?? []).filter(isDrawn)
  if (n.type === 'Text') {
    const text = textOf(n)
    if (p.wrap === 'truncate' && kids.some(k => k.type === 'Text')) out.push(`${here}: truncates nested Texts "${text}"`)
    if (parent === 'Box' && text !== text.trim()) out.push(`${here}: edge spaces "${text}"`)
    return out
  }
  kids.forEach((k, i) => desktopFaults(k, out, `${here}[${i}]`, n.type))
  return out
}
const svgsOf = (n: unknown, out: Drawn[] = []): Drawn[] => {
  if (!isDrawn(n)) return out
  if (n.type === 'Svg') out.push(n)
  ;(n.children ?? []).forEach(k => svgsOf(k, out))
  return out
}
const spillsOf = (tree: unknown, columns: number) => {
  const out: string[] = []
  const need = needs(tree, out, '')
  if (need > columns) out.push(`root: needs ${need} in ${columns}`)
  return out
}

/** A session with every panel busy: a compaction window, limits, consults with advice, checks of every kind, agents, a loop. */
const busySession = async ($: Parameters<TestBody>[0], on: On) => {
  const clock = engine(on)
  await clock.advance(3_600_000) // clocks draw as m:ss, as in a session, not as the '—' of an unknown start
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('tool.check', (_$, e) => ({ decision: (e.tool_use_id ?? '').endsWith('7') ? 'deny' : 'allow' }))
  on('tool.call', (_$, e) => ({ result: {}, text: String((e as { command?: unknown }).command ?? '').includes('mvn') ? MAVEN_PASS : 'ok' }))
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: e.subagentType.includes('advisor') ? 'adv1' : `b${++n}` }))
  const usage = { input_tokens: 4000, output_tokens: 900, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.step', async function* () {
    yield { kind: 'text' as const, index: 0, text: 'ok' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'B1', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (agentId?: string) => {
    const s = $.turn.step({ turnId: 'B1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) void _
    await s.result
  }
  await $.session.measure({
    context: { window: 1_000_000, tokens: 360_000, percent: 36 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 82, resetsAt: new Date(3 * 3_600_000).toISOString() },
      { kind: 'seven_day_opus', percentUsed: 40, resetsAt: new Date(4 * 86_400_000).toISOString() },
    ],
    cost: { usd: 123.45 },
    changed: ['context', 'rateLimits', 'cost'],
  } as never)
  await $.turn.start({ text: 'Refactor the configuration loader and keep every public name stable please', turnId: 'B1' })
  await step()
  const tools = [
    { tool: 'Bash', input: { command: 'npm run test -- --reporter=verbose --coverage packages/configuration-loader' } },
    { tool: 'Read', input: { file_path: '/Users/someone/projects/a-very-long-repository-name/src/configuration/loader.ts' } },
    { tool: 'WebFetch', input: { url: 'https://example.com/a/very/long/documentation/path/for/the/loader' } },
  ]
  for (let i = 0; i < 60; i += 1) await $.tool.check({ ...tools[i % 3]!, tool_use_id: `k${i}` })
  // A test run, then an edit after it: the checks panel with its stale line, and the files panel.
  await $.tool.call({ tool: 'Bash', command: 'rtk mvn verify -pl a-very-long-module-name-for-the-configuration-loader -am', tool_use_id: 'run1' } as never)
  await clock.advance(1000)
  await $.tool.call({ tool: 'Edit', file_path: '/Users/someone/projects/a-very-long-repository-name/src/configuration/a-long-file-name-for-the-loader.ts', old_string: 'a', new_string: 'b', tool_use_id: 'edit0' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/x/loader.ts', old_string: 'a', new_string: 'b', tool_use_id: 'edit1' } as never)
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review of the loader'))
  await $.turn.complete({
    answer: 'Ship it once the configuration loader keeps its public names and the migration test covers the old shape',
    durationMs: 9000, isAborted: false, turnId: 'A1', agentId: 'adv1', reason: 'answer',
  })
  for (const d of ['Write the configuration loader regression tests', 'Map every call site of the old loader', 'Review the migration path for saved state']) {
    await $.agent.spawn(spawn('general-purpose', d))
  }
  await step('b1')
  await step('wf-unclaimed-loop')
  await clock.advance(95_000)
  await $.turn.complete({ answer: '', durationMs: 95_000, isAborted: false, turnId: 'B1', reason: 'answer' })
  return clock
}

test('every panel fits the pane at every width from 24 columns, on every surface and placement, in lines a graphical surface keeps whole', { timeoutMs: 60_000 }, async ($, on) => {
  await busySession($, on)
  const failures: string[] = []
  const check = async (label: string) => {
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      for (let cols = 24; cols <= 40; cols += 1) {
        for (const placement of ['dock', 'inline'] as const) {
          const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement }, surface })
          for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${label} ${surface} ${placement} ${cols}: ${s}`)
          await ui.unmount()
        }
      }
      for (const cols of [64, 120]) {
        const ui = await $.ui.mount({ ...pane(cols), surface })
        for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${label} ${surface} dock ${cols}: ${s}`)
        await ui.unmount()
      }
    }
  }
  await check('lanes, finished')
  // The gate drill-down and an expanded card open, and a turn running.
  const opener = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await opener.press({ key: 'gate-shell' })
  await opener.press({ key: 'card-b1' })
  await opener.unmount()
  await $.turn.start({ text: 'and once more', turnId: 'B2' })
  await check('drill-down, expanded, running')
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const cols of [24, 32, 40, 64, 120]) {
      for (const placement of ['dock', 'inline'] as const) {
        const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement }, surface })
        for (const f of desktopFaults(await ui.drawn(), [])) failures.push(`${surface} ${placement} ${cols}: ${f}`)
        await ui.unmount()
      }
    }
  }
  // One line per panel and width that spills, the surface left out (they draw the same boxes).
  expect([...new Set(failures.map(f => f.replace(/ (terminal|desktop|vscode|mobile) /, ' ')))]).toEqual([])
})

test('a single agent card fits from 24 columns', async ($, on) => {
  const clock = engine(on)
  await clock.advance(3_600_000)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'one' }))
  await $.turn.start({ text: 'go', turnId: 'O1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the configuration loader regression tests'))
  const failures: string[] = []
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (let cols = 24; cols <= 40; cols += 1) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${surface} ${cols}: ${s}`)
      await ui.unmount()
    }
  }
  expect(failures).toEqual([])
  // Wide enough for a card to hold its crab: a graphical surface draws one, the terminal does not.
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    const hasCrab = svgsOf(await ui.drawn()).some(n => String(n.props?.alt).startsWith('agent 1'))
    expect(hasCrab).toBe(surface === 'desktop')
    await ui.unmount()
  }
})

test('a running connector keeps its length every frame: one face, clipped at its width, the dot still moving', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'rail1' }))
  await $.turn.start({ text: 'go', turnId: 'R1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the loader')) // an agent running: the agents panel's connector animates
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect((await ui.find({ key: 'fan-out' }))?.type).toBe('Client')
    // The panels themselves have no connector between them.
    expect(await ui.find({ key: 'link-gate' })).toBeUndefined()
    const heads = new Set<number>()
    for (let frame = 0; frame < 30; frame += 1) {
      const tree = (await ui.drawn({ in: 'fan-out' })) as Drawn
      const texts: Drawn[] = []
      const walk = (n: unknown) => {
        if (!isDrawn(n)) return
        if (n.type === 'Text') texts.push(n)
        else (n.children ?? []).forEach(walk)
      }
      walk(tree)
      const line = texts.map(textOf).join('')
      // The box is the line's width and clips; its text is that width and four spare cells, every frame.
      expect([tree.type, tree.props?.width, tree.props?.overflow]).toEqual(['Box', 64, 'hidden'])
      expect(cellsOf(line)).toBe(64 + 4)
      expect(texts.every(t => t.props?.mono === true)).toBe(true)
      expect(/^[─●•┬┴]+$/.test(line)).toBe(true)
      const head = [...line].slice(0, 64).indexOf('●')
      if (head >= 0) heads.add(head)
      await ui.advance(110)
    }
    expect(heads.size > 5).toBe(true) // the dot travels along the line
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- comms

test('a recipient is matched by id, then by the name it was spawned under; anything else stays as written', () => {
  const cards = [normalizeCard({ id: 'a1', type: 'Explore' }), normalizeCard({ id: 'a2', type: 'reviewer' })]
  expect([resolveTo('a2', cards), resolveTo('explore', cards), resolveTo(' Main ', cards), resolveTo('stranger', cards)]).toEqual(['a2', 'a1', 'main', 'stranger'])
})

test('messages fold into one edge per sender and recipient, keep the newest, and are capped', () => {
  const m = (at: number, from: string, to: string, text: string): Msg => ({ at, from, to, kind: 'message', text })
  const edges = edgesOf([m(1, 'main', 'a1', 'go'), m(2, 'a1', 'a2', 'hand over'), m(3, 'main', 'a1', 'again')])
  expect(edges.map(e => [e.from, e.to, e.count, e.last.text])).toEqual([
    ['main', 'a1', 2, 'again'],
    ['a1', 'a2', 1, 'hand over'],
  ])
  let list: Msg[] = []
  for (let i = 0; i < 100; i += 1) list = addMsg(list, m(i, 'main', 'a1', String(i)))
  expect([list.length, list[0]?.text, list.at(-1)?.text]).toEqual([80, '20', '99'])
  expect(normalizeMsgs([{ at: 'x', to: 7, kind: 'weird' }])).toEqual([{ at: 0, from: 'main', to: '7', kind: 'message', text: '' }])
})

test('the flow graph draws a box per loop and an arrow per link, and drops links to loops it does not show', () => {
  const nodes = [
    { id: 'main', label: 'main', hue: 0, isLive: true },
    { id: 'a1', label: 'Explore', hue: 1, isLive: true },
    { id: 'a2', label: 'Rev<&>', hue: 2, isLive: false },
  ]
  const svg = flowSvg(nodes, [
    { from: 'main', to: 'a1', count: 2 },
    { from: 'a1', to: 'a2', count: 1 },
    { from: 'a2', to: 'gone', count: 5 },
  ])
  expect(svg.match(/<rect /g)?.length).toBe(3)
  expect(svg.match(/marker-end/g)?.length).toBe(2)
  expect(svg).toContain('>Rev</text>') // markup characters are dropped from a label
})

test('the comms panel lists who said what to whom, and draws the graph only where Svg exists', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `k${++n}` }))
  on('session.send', () => ({ isDelivered: true as const }))
  await $.turn.start({ text: 'talk', turnId: 'K1' })
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))
  await $.agent.spawn(spawn('reviewer', 'Review the parser'))
  await $.session.send({ to: 'k1', text: 'also check token=sk-proj-1234567890abcdef', origin: { kind: 'model' } })
  await $.session.send({ to: 'Explore', text: 'and the tests', origin: { kind: 'model' } })

  const term = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await term.find({ text: /comms · 4 messages · 2 routes/ })).toBeDefined()
  expect(await term.find({ text: /main → Map the c/ })).toBeDefined()
  expect(await term.find({ text: /1234567890/ })).toBeUndefined() // masked before it is stored
  expect(svgsOf(await term.drawn()).some(s => String(s.props?.alt).includes('links between'))).toBe(false)
  await term.unmount()

  for (const columns of [24, 40, 110]) {
    for (const surface of ['terminal', 'desktop'] as const) {
      const narrow = await $.ui.mount({ ...pane(columns), surface })
      expect(await narrow.find({ text: /comms ·/ })).toBeDefined()
      await narrow.unmount()
    }
  }

  const desk = await $.ui.mount({ ...pane(80), surface: 'desktop' })
  expect(svgsOf(await desk.drawn()).some(s => String(s.props?.alt).includes('2 links between 3 loops'))).toBe(true)
  await desk.unmount()
})

test('tool calls are tallied per tool and shown as the busiest chips', () => {
  let c = normalizeCard({ id: 'a1' })
  for (const tool of ['Bash', 'Bash', 'Edit', 'Bash', 'Read', 'Edit']) c = noteTool(c, { tool, text: tool, isError: false })
  expect(c.toolTally).toEqual({ Bash: 3, Edit: 2, Read: 1 })
  expect(c.tools.length).toBe(3) // the notes stay at the last three
  expect([chipsOf(c.toolTally), chipsOf(c.toolTally, 3), chipsOf(undefined)]).toEqual(['Bash ×3 · Edit ×2', 'Bash ×3 · Edit ×2 · Read ×1', ''])
})

test('scrubbing shows the comms as they stood: later messages and agents not yet spawned are gone', () => {
  const m = (at: number, to: string): Msg => ({ at, from: 'main', to, kind: 'prompt', text: to })
  const cards = [
    { ...normalizeCard({ id: 'a1' }), spawnedAt: 10, endedAt: 30, status: 'done' },
    { ...normalizeCard({ id: 'a2' }), spawnedAt: 40, endedAt: null, status: 'running' },
  ]
  const msgs = [m(10, 'a1'), m(40, 'a2')]
  const live = sceneAt(msgs, cards, null)
  expect([live.isPast, live.msgs.length, live.cards.length]).toEqual([false, 2, 2])
  const past = sceneAt(msgs, cards, 1)
  expect([past.isPast, past.msgs.length, past.cards.map(c => c.id), past.cards[0]?.status]).toEqual([true, 1, ['a1'], 'running']) // a1 had not finished at 10
  expect(sceneAt(msgs, cards, 0).cards).toEqual([])
  expect(sceneAt(msgs, cards, 9).isPast).toBe(false)
  // Back from live lands one message back; forward past the newest is live again; back stops at none.
  expect([stepScrub(null, 2, -1), stepScrub(1, 2, 1), stepScrub(0, 2, -1), stepScrub(null, 0, -1)]).toEqual([1, null, 0, null])
})

test('a live link is dashed, and its dashes move only when asked; tool chips sit under their agent', () => {
  const nodes = [
    { id: 'main', label: 'main', hue: 0, isLive: true },
    { id: 'a1', label: 'Explore', hue: 1, isLive: true, chips: 'Bash ×3' },
  ]
  const edges = [{ from: 'main', to: 'a1', count: 1, isLive: true }]
  expect(flowSvg(nodes, edges)).toContain('stroke-dashoffset')
  expect(flowSvg(nodes, edges, 520, false)).not.toContain('<animate')
  expect(flowSvg(nodes, edges, 520, false)).toContain('stroke-dasharray')
  expect(flowSvg(nodes, [{ ...edges[0]!, isLive: false }])).not.toContain('stroke-dasharray')
  expect(flowSvg(nodes, edges)).toContain('>Bash ×3</text>')
  expect(flowSvg(nodes.map(n => ({ ...n, chips: undefined })), edges)).toMatch(/height="98"/) // without chips the graph is 14 shorter
})

test('the architect has a node: its prompt and the messages to it are listed under its label', () => {
  const a = { ...DEFAULT_ARCHITECT, ids: ['r9'], consults: [{ id: 'r9', at: 5, endAt: null, moment: 'before done' as const, via: 'x' }] }
  const loops = withArchitect([normalizeCard({ id: 'a1' })], a, 'architect')
  expect(loops.map(c => [c.id, c.type, c.status, c.spawnedAt])).toEqual([['a1', 'agent', 'running', 0], ['r9', 'architect', 'running', 5]])
  expect(resolveTo('architect', loops)).toBe('r9')
})

test('the architect spawn and a message to it appear in comms', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'r9' }))
  on('session.send', () => ({ isDelivered: true as const }))
  await $.turn.start({ text: 'review', turnId: 'A1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await $.session.send({ to: 'r9', text: 'see the diff', origin: { kind: 'model' } })
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await ui.find({ text: /comms · 2 messages · 1 route/ })).toBeDefined()
  expect(await ui.find({ text: /main → architect/ })).toBeDefined()
  await ui.unmount()
})

test('the back, next and live buttons move through the comms; an expanded card shows its full prompt', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `s${++n}` }))
  on('session.send', () => ({ isDelivered: true as const }))
  await $.turn.start({ text: 'go', turnId: 'S1' })
  const long = `Map the call sites ${'and read every one of them carefully '.repeat(6)}end`
  await $.agent.spawn({ ...spawn('Explore', 'Map the call sites'), prompt: long })
  await $.agent.spawn(spawn('reviewer', 'Review the parser'))
  await $.session.send({ to: 's1', text: 'first note', origin: { kind: 'model' } })

  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await ui.find({ text: /comms · 3 messages · 2 routes$/ })).toBeDefined()
  await ui.press({ key: 'comms-back' })
  expect(await ui.find({ text: /comms · replay · 2 of 3 messages/ })).toBeDefined()
  expect(await ui.find({ text: /first note/ })).toBeUndefined() // the later message is out of this moment
  await ui.press({ key: 'comms-back' })
  await ui.press({ key: 'comms-back' })
  expect(await ui.find({ text: /comms · replay · 0 of 3 messages/ })).toBeDefined()
  await ui.press({ key: 'comms-next' })
  expect(await ui.find({ text: /comms · replay · 1 of 3 messages/ })).toBeDefined()
  await ui.press({ key: 'comms-live' })
  expect(await ui.find({ text: /comms · 3 messages · 2 routes$/ })).toBeDefined()
  expect(await ui.find({ text: /first note/ })).toBeDefined()

  await ui.press({ key: 'card-s1' })
  const full = await ui.find({ type: 'Markdown', text: /^Map the call sites/ })
  expect(String(full?.props.text)).toBe(long)
  await ui.unmount()
})

test('looking back keeps its moment when new messages push the oldest off the full list', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'q1' }))
  on('session.send', () => ({ isDelivered: true as const }))
  await $.agent.spawn(spawn('Explore', 'look around'))
  for (let i = 1; i < 80; i += 1) await $.session.send({ to: 'q1', text: `note ${i}`, origin: { kind: 'model' } })
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  await ui.press({ key: 'comms-back' })
  expect(await ui.find({ text: /note 78$/ })).toBeDefined()
  expect(await ui.find({ text: /note 79$/ })).toBeUndefined()
  await $.session.send({ to: 'q1', text: 'note 80', origin: { kind: 'model' } })
  await $.session.send({ to: 'q1', text: 'note 81', origin: { kind: 'model' } })
  // Still the moment after note 78, now three back from the newest.
  expect(await ui.find({ text: /note 78$/ })).toBeDefined()
  expect(await ui.find({ text: /note 79$/ })).toBeUndefined()
  expect(await ui.find({ text: /comms · replay · 77 of 80 messages/ })).toBeDefined()
  await ui.unmount()
})

test('a message nobody received leaves no trace, and /clear forgets the rest', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'z1' }))
  on('session.send', () => ({ isDelivered: false as const, reason: 'nobody by that name' }))
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.session.send({ to: 'ghost', text: 'hello?', origin: { kind: 'model' } })
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await ui.find({ text: /comms · 1 message · 1 route/ })).toBeDefined() // the spawn prompt only
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const fresh = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await fresh.find({ text: /comms ·/ })).toBeUndefined()
  await fresh.unmount()
})

test('a graphical surface draws the context meter and no second time axis; the terminal keeps its glyphs', async ($, on) => {
  await busySession($, on)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...pane(120), surface })
    const alts = svgsOf(await ui.drawn()).map(n => String(n.props?.alt))
    expect(alts.some(a => a.startsWith('context '))).toBe(true)
    // The lanes are the one time axis: the SVG copy under the log is gone.
    expect(alts.some(a => a.includes('time axis'))).toBe(false)
    expect(await ui.find({ text: /━/ })).toBeDefined()
    // The busy session the width test draws holds both new panels.
    expect(await ui.find({ text: /checks · tests & builds/ })).toBeDefined()
    expect(await ui.find({ text: /^2 files edited since the last test run$/ })).toBeDefined()
    expect(await ui.find({ text: /files · 2 edited this session/ })).toBeDefined()
    await ui.unmount()
  }
  const term = await $.ui.mount({ ...pane(120), surface: 'terminal' })
  expect(svgsOf(await term.drawn())).toEqual([])
  await term.unmount()
})

// ---------------------------------------------------------------- 0.3.0: checks, files, failure reasons

// What rtk's mvn filter returns for a failing run (captured from rtk 2026-11, its compact form).
const MAVEN_RTK_FAIL = `[INFO] Scanning for projects...
[INFO] Running com.credify.ims.BarServiceTest
[ERROR] Tests run: 5, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.5 s <<< FAILURE! - in com.credify.ims.BarServiceTest
org.opentest4j.AssertionFailedError: expected: <1> but was: <2>
[INFO] Results:
[ERROR] Failures:
[ERROR]   BarServiceTest.shouldDoIt:42 expected: <1> but was: <2>
[ERROR] Tests run: 15, Failures: 1, Errors: 0, Skipped: 1
[INFO] BUILD FAILURE`

// A passing two-module reactor: one Results line per module, summed.
const MAVEN_PASS = `[INFO] Tests run: 7, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.2 s - in com.x.UtilTest
[INFO] Results:
[INFO] Tests run: 7, Failures: 0, Errors: 0, Skipped: 0
[INFO] Results:
[INFO] Tests run: 10, Failures: 0, Errors: 0, Skipped: 1
[INFO] BUILD SUCCESS`

test('a build or test run is read from Bash output: Maven (raw or rtk), jest, vitest, bun, tsc', () => {
  expect(parseTestRun('rtk mvn test -pl investor-mgt-srvc-server', MAVEN_RTK_FAIL, true)).toEqual({ kind: 'maven', passed: 13, failed: 1, skipped: 1, isOk: false })
  expect(parseTestRun('mvn verify', MAVEN_PASS, false)).toEqual({ kind: 'maven', passed: 16, failed: 0, skipped: 1, isOk: true })
  expect(parseTestRun('cd x && ./mvnw compile -q', '[ERROR] COMPILATION ERROR :\n[INFO] BUILD FAILURE', true)).toEqual({ kind: 'maven', passed: null, failed: 0, skipped: 0, isOk: false })
  // A goal that builds nothing is not a check; neither is a command that only mentions one.
  expect(parseTestRun('mvn dependency:tree', 'BUILD SUCCESS', false)).toBeNull()
  expect(parseTestRun('cat build.log', MAVEN_PASS, false)).toBeNull()
  expect(parseTestRun('npx jest', 'Tests:       1 failed, 2 skipped, 40 passed, 43 total', true)).toEqual({ kind: 'tests', passed: 40, failed: 1, skipped: 2, isOk: false })
  expect(parseTestRun('npm run test', '      Tests  40 passed (40)', false)).toEqual({ kind: 'tests', passed: 40, failed: 0, skipped: 0, isOk: true })
  expect(parseTestRun('claude plugin test .', ' 62 pass\n 0 fail\nRan 62 tests', false)).toEqual({ kind: 'tests', passed: 62, failed: 0, skipped: 0, isOk: true })
  expect(parseTestRun('npx tsc -p . --noEmit', 'a.ts(1,1): error TS2322: x\nFound 2 errors in 1 file.', true)).toEqual({ kind: 'tsc', passed: null, failed: 2, skipped: 0, isOk: false })
  expect(parseTestRun('tsc --noEmit', '', false)).toEqual({ kind: 'tsc', passed: null, failed: 0, skipped: 0, isOk: true })
  expect(parseTestRun('ls -la', '', false)).toBeNull()
  // 0.5.1: a runner named in another command's arguments is not a run, even when that command fails.
  expect(parseTestRun('grep -rn "mvn test" .', '', true)).toBeNull()
  expect(parseTestRun('rg vitest src', '', true)).toBeNull()
  expect(parseTestRun('git commit -m "fix jest config"', '[main 1a2b] fix', false)).toBeNull()
  expect(parseTestRun('npx tsc --version', 'Version 5.6.3', false)).toBeNull()
  // A run piped into a filter, or after an env assignment, still is one.
  expect(parseTestRun('mvn test | tail -5', MAVEN_PASS, false)?.kind).toBe('maven')
  expect(parseTestRun('CI=1 npm test', '      Tests  40 passed (40)', false)?.passed).toBe(40)
  const run = { kind: 'maven' as const, passed: 13, failed: 1, skipped: 1, isOk: false, at: 1, by: 'main', command: 'mvn test' }
  expect(runCounts(run)).toBe('13 passed · 1 failed · 1 skipped')
  expect(runCounts({ ...run, passed: null, kind: 'tsc', failed: 1 })).toBe('1 type error')
  expect(addRun(Array.from({ length: 25 }, (_, i) => ({ ...run, at: i })), run).length).toBe(20)
})

test("a failed call's reason is its located error line, its path cut to the file and its secrets masked", () => {
  const javac = '[ERROR] COMPILATION ERROR :\n[ERROR] /Users/x/ws/srvc/src/main/java/com/c/Foo.java:[12,5] cannot find symbol\n[INFO] BUILD FAILURE'
  expect(failureLine(javac)).toBe('Foo.java:[12,5] cannot find symbol')
  expect(failureLine('Exit code 1\ncurl: (6) could not resolve host\nmore')).toBe('curl: (6) could not resolve host')
  expect(failureLine('Exit code 2\nboom token=abcdef123456')).toBe('boom token=•••')
  expect(failureLine(undefined)).toBe('')
})

test('edits are kept per file with who made them, and counted against the last run', () => {
  let fs = noteFile([], { path: '/a/b/Foo.java', by: 'main', at: 10 })
  fs = noteFile(fs, { path: '/a/b/Foo.java', by: 'ag1', at: 20 })
  fs = noteFile(fs, { path: '/a/b/Bar.java', by: 'main', at: 30 })
  expect(fs.map(f => [f.path, f.edits, f.by])).toEqual([['/a/b/Foo.java', 2, ['main', 'ag1']], ['/a/b/Bar.java', 1, ['main']]])
  expect([editsSince(fs, 5), editsSince(fs, 20), editsSince(fs, 30)]).toEqual([2, 1, 0])
  const many = Array.from({ length: 45 }, (_, i) => i).reduce((l, i) => noteFile(l, { path: `/f${i}`, by: 'main', at: i }), fs)
  expect(many.length).toBe(40)
  expect(many.some(f => f.path === '/f44')).toBe(true)
})

test('a running crab animates in its own SVG; a still one draws one frame', () => {
  expect(crabSvg(0, true)).toContain('<animate')
  expect(crabSvg(0, false)).not.toContain('<animate')
  expect(crabSvg(0, true).match(/<g /g)?.length).toBe(4)
})

test('a server-side advisor is read from the step result when assistant rows are not delivered, and counted once', async ($, on) => {
  const clock = engine(on)
  on('turn.step', async function* () {
    await clock.sleep(10)
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'A1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage, serverToolUses: [{ id: 'srv7', name: 'advisor', input: {}, startedAt: 2, endedAt: 8 }] }
  })
  await $.turn.start({ text: 'plan it', turnId: 'A1' })
  const s = $.turn.step({ turnId: 'A1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const done = (async () => {
    for await (const _ of s) void _
    return s.result
  })()
  await clock.advance(10)
  await done
  // The same consult arriving later through an assistant row adds nothing.
  await $.session
    .append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'server_tool_use', id: 'srv7', name: 'advisor', input: {} }] as never },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'late-row',
    })
    .catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await ui.find({ text: /^1$/ })).toBeDefined()
  await ui.unmount()
})

test('with the mode unknown, an ask that ran is "cleared", not credited to you, and the main box leaves the mode out', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'go', turnId: 'U1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'q1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'q1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'U1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /1 cleared/ })).toBeDefined()
  expect(await ui.find({ text: /\d+ you\b/ })).toBeUndefined()
  // 0.8.0: an unknown mode says nothing worth a field; the box shows it once it is known.
  expect(await ui.find({ text: /\bmode\b/ })).toBeUndefined()
  await ui.unmount()
})

test('a test run fills the checks panel, header and status; a later edit marks it stale; files list who edited what', async ($, on) => {
  // engine() less its ui.status stub: this one records what the status line was given.
  const clock = mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const status: string[] = []
  on('ui.status', (_$, e) => (status.push(JSON.stringify(e)), { value: undefined }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ed1' }))
  on('tool.call', (_$, e) => {
    const cmd = String((e as { command?: unknown }).command ?? '')
    return cmd.startsWith('rtk mvn') ? { result: {}, text: MAVEN_RTK_FAIL, isError: true } : { result: {}, text: 'ok' }
  })
  await $.turn.start({ text: 'fix it', turnId: 'K1' })
  await $.tool.call({ tool: 'Edit', file_path: '/ws/srvc/src/Foo.java', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'rtk mvn test -pl srvc' } as never)
  const first = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await first.find({ text: /checks · tests & builds/ })).toBeDefined()
  expect(await first.find({ text: /^13 passed · 1 failed · 1 skipped$/ })).toBeDefined()
  expect(await first.find({ text: /^✗ tests$/ })).toBeDefined()
  expect(await first.find({ text: /edited since/ })).toBeUndefined()
  expect(await first.find({ text: /files · 1 edited this session/ })).toBeDefined()
  expect(await first.find({ text: /✗ 13 passed/ })).toBeDefined() // the log line
  await first.unmount()
  expect(status.some(s => s?.includes('tests ✗ 1'))).toBe(true)

  await $.agent.spawn(spawn('general-purpose', 'Patch the bar'))
  await clock.advance(1000)
  await $.tool.call({ tool: 'Edit', file_path: '/ws/srvc/src/Bar.java', old_string: 'a', new_string: 'b', agentId: 'ed1' } as never)
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /^1 file edited since the last test run$/ })).toBeDefined()
  expect(await after.find({ text: /^1 untested$/ })).toBeDefined()
  expect(await after.find({ text: /^src\/Bar\.java$/ })).toBeDefined()
  expect(await after.find({ text: /×1 · Patch the/ })).toBeDefined()
  await after.unmount()
  expect(status.some(s => s?.includes('untested 1'))).toBe(true)
})

test("a failed call's log line says why", async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'Exit code 1\n/ws/src/Foo.java:[12,5] cannot find symbol', isError: true }))
  await $.turn.start({ text: 'build', turnId: 'F1' })
  await $.tool.call({ tool: 'Bash', command: 'make build' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  // The reason has a row of its own (no mark, no separator); the call it came from sits dim beneath it.
  expect(await ui.find({ text: /^Foo\.java:\[12,5\] cannot find symbol$/ })).toBeDefined()
  expect(await ui.find({ text: /^Bash → make build$/ })).toBeDefined()
  await ui.unmount()
})

test('the header names the deck and only what needs attention; the footer lists the keys while focused', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'deny' }))
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf x' }, tool_use_id: 'd1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^CHAT DECK$/ })).toBeDefined()
  expect(await ui.find({ text: /SESSION DECK|WORKS|IDLE/ })).toBeUndefined()
  expect(await ui.find({ text: /^✗ 1 denied$/ })).toBeDefined()
  expect(await ui.find({ text: /^a f s o$/ })).toBeDefined()
  await ui.unmount()
  const unfocused = await $.ui.mount({ ...pane(64), props: { ...pane(64).props, isFocused: false }, surface: 'terminal' })
  expect(await unfocused.find({ text: /^a f s o$/ })).toBeUndefined()
  await unfocused.unmount()
  const narrow = await $.ui.mount({ ...pane(30), surface: 'terminal' })
  expect(await narrow.find({ text: /^CHAT DECK$/ })).toBeUndefined() // the frame's title names it
  await narrow.unmount()
})

test("an expanded card draws its prompt and answer as markdown, the answer whole", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'md1' }))
  await $.turn.start({ text: 'go', turnId: 'MD' })
  await $.agent.spawn({ ...spawn('general-purpose', 'Summarise'), prompt: '## Task\n- read **core.ts**' })
  const answer = `Done. ${'x'.repeat(300)}`
  await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 'MD2', reason: 'answer', agentId: 'md1' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await ui.press({ key: 'card-md1' })
  expect((await ui.find({ type: 'Markdown', text: /## Task/ }))?.props.dimColor).toBe(true)
  expect(String((await ui.find({ type: 'Markdown', text: /^Done\./ }))?.props.text).length).toBe(answer.length)
  await ui.unmount()
})

test('a failed build says why, in the log and the checks panel, even when its exit code was 0', async ($, on) => {
  engine(on)
  const javac = '[ERROR] COMPILATION ERROR :\n[ERROR] /ws/srvc/src/main/java/com/c/Foo.java:[12,5] cannot find symbol\n[INFO] BUILD FAILURE'
  on('tool.call', (_$, e) => {
    const cmd = String((e as { command?: unknown }).command ?? '')
    // `| tail` hides the failing exit code: only the output says the build failed.
    return cmd.includes('tail') ? { result: {}, text: MAVEN_RTK_FAIL } : { result: {}, text: javac, isError: true }
  })
  await $.turn.start({ text: 'build', turnId: 'J1' })
  await $.tool.call({ tool: 'Bash', command: 'mvn compile -pl srvc' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^✗ build failed · Foo\.java:\[12,5\]$/ })).toBeDefined()
  expect(await ui.find({ text: /^cannot find symbol$/ })).toBeDefined()
  expect(await ui.find({ text: /^↳ Foo\.java:\[12,5\] cannot find symbol$/ })).toBeDefined()
  expect(await ui.find({ text: /^✗ build$/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: 'Bash', command: 'mvn test 2>&1 | tail -40' } as never)
  const piped = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  // The counts and the reason are one log line, wrapped over its rows.
  expect(await piped.find({ type: 'Text', text: /^✗ 13 passed · 1 failed · 1 skipped ·/ })).toBeDefined()
  expect(await piped.find({ type: 'Text', text: /expected: <1> but was: <2>$/ })).toBeDefined()
  expect(await piped.find({ text: /^✗ tests$/ })).toBeDefined()
  await piped.unmount()
})

test('a build or tsc run that ran no tests is not "tests ✓", and leaves earlier edits untested', async ($, on) => {
  const clock = engine(on)
  on('tool.call', (_$, e) => {
    const cmd = String((e as { command?: unknown }).command ?? '')
    return { result: {}, text: cmd.includes('mvn test') ? MAVEN_PASS : cmd.includes('mvn') ? '[INFO] BUILD SUCCESS' : '' }
  })
  await $.turn.start({ text: 'go', turnId: 'B9' })
  await $.tool.call({ tool: 'Bash', command: 'mvn test' } as never)
  await clock.advance(1000)
  await $.tool.call({ tool: 'Edit', file_path: '/ws/src/Foo.java', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'mvn compile' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^✓ build$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ tests$/ })).toBeUndefined()
  expect(await ui.find({ text: /^1 untested$/ })).toBeDefined()
  expect(await ui.find({ text: /^build ok$/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: 'Bash', command: 'tsc --noEmit' } as never)
  const tsc = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await tsc.find({ text: /^✓ tsc$/ })).toBeDefined()
  expect(await tsc.find({ text: /^1 untested$/ })).toBeDefined()
  await tsc.unmount()
})

// ---------------------------------------------------------------- 0.4.0: hotspots, slow calls, runway, effort

test('a check that asked gets the allow rule it would need, and the most frequent come first', () => {
  const ck = (tool: string, detail: string, verdict: Check['verdict']): Check => ({ id: detail, tool, bucket: 'shell', verdict, inSubagent: false, detail, at: 0 })
  expect(allowRule(ck('Bash', 'Bash → mvn test -pl srvc', 'ask'))).toBe('Bash(mvn test:*)')
  expect(allowRule(ck('Bash', 'Bash → cd /ws/srvc && ./mvnw verify', 'ask'))).toBe('Bash(./mvnw verify:*)')
  // Never broader than the call: flags and their values stay up to the subcommand.
  expect(allowRule(ck('Bash', 'Bash → git -C /x status', 'ask'))).toBe('Bash(git -C /x status:*)')
  expect(allowRule(ck('Bash', 'Bash → rtk mvn test -pl srvc', 'ask'))).toBe('Bash(rtk mvn test:*)')
  expect(allowRule(ck('Bash', 'Bash → FOO=1 npm test', 'ask'))).toBe('Bash(npm test:*)')
  expect(allowRule(ck('Bash', 'Bash → mvn -q -pl a-very-long-module…', 'ask'))).toBe('Bash(mvn -q -pl:*)')
  expect(allowRule(ck('WebFetch', 'WebFetch → https://x', 'ask'))).toBe('WebFetch')
  const recent = [
    ck('Bash', 'Bash → mvn test -pl a', 'cleared'),
    ck('Bash', 'Bash → mvn test -pl b', 'ask'),
    ck('Bash', 'Bash → rm -rf x', 'deny'),
    ck('Bash', 'Bash → mvn test', 'deny'),
    ck('Read', 'Read → a.ts', 'rule'),
  ]
  expect(hotspots(recent)).toEqual([
    { rule: 'Bash(mvn test:*)', count: 3, denied: 1 },
    { rule: 'Bash(rm -rf x:*)', count: 1, denied: 1 },
  ])
})

test('a failure splits into its reason and its call; the log tallies its events; a slow call has a bar against the turn', () => {
  expect(splitFailure('✗ Foo.java:[12,5] cannot find symbol · Bash → make build')).toEqual({ reason: 'Foo.java:[12,5] cannot find symbol', call: 'Bash → make build' })
  expect(splitFailure('✗ no matches found: x · Bash → grep "a · b → c"')).toEqual({ reason: 'no matches found: x', call: 'Bash → grep "a · b → c"' })
  expect(splitFailure('Bash → rm -rf x  denied')).toBeNull()
  expect(splitFailure('✗ 3 tests failed')).toBeNull()
  expect(logTally([{ kind: 'info' }, { kind: 'error' }, { kind: 'error' }, { kind: 'done' }])).toEqual({ events: 4, errors: 2 })
  expect(slowBar(4000, 90_000, 6)).toBe('█░░░░░') // never empty
  expect(slowBar(45_000, 90_000, 6)).toBe('███░░░')
  expect(slowBar(9000, 9000, 6)).toBe('██████')
  expect(slowBar(20_000, 9000, 6)).toBe('██████') // never wider than the bar
})

test("a turn keeps its three slowest calls of 3 s or more; the runway estimates turns left; effort has five levels", () => {
  let s = slowest([], { text: 'quick', ms: 500 })
  expect(s).toEqual([])
  for (const [text, ms] of [['a', 4000], ['b', 9000], ['c', 3000], ['d', 6000]] as const) s = slowest(s, { text, ms })
  expect(s.map(x => x.text)).toEqual(['b', 'd', 'a'])
  const same = slowest(s, { text: 'e', ms: 3500 })
  expect(same).toBe(s) // not among the slowest: the same list, so the hook writes nothing
  // 20k a turn, 120k used of 200k: 4 turns left.
  expect(runway([60_000, 80_000, 100_000], 120_000, 200_000)).toBe(4)
  expect(runway([], 120_000, 200_000)).toBeNull()
  expect(runway([130_000], 120_000, 200_000)).toBeNull() // no growth (a compaction): no estimate
  expect([effortLevel('low'), effortLevel('xhigh'), effortLevel('max'), effortLevel('')]).toEqual([1, 4, 5, 0])
})

test('parallel agents with one description prefix are told apart by their type, numbered when the type matches too', () => {
  const mk = (id: string, type: string, description: string) => ({ id, type, description }) as never
  const all = [
    mk('1', 'pr-review-toolkit:silent-failure-hunter', 'Wave 1: silent failures'),
    mk('2', 'investor-workflow:investor-ac-reviewer', 'Wave 1: investigate ac'),
    mk('3', 'investor-workflow:investor-ac-reviewer', 'Wave 1: investigate ac again'),
    mk('5', 'investor-workflow:investor-boundary-reviewer', 'Wave 1: investigate boundaries'),
    mk('4', 'general-purpose', 'Run the tests'),
  ]
  expect(all.map(c => cardLabel(c, all))).toEqual(['Wave 1: silent failures', 'investor-ac-reviewer 1', 'investor-ac-reviewer 2', 'investor-boundary-reviewer', 'Run the tests'])
  // 0.5.1: twins of one type keep their own words past the shared ones; alike titles fall back to numbers.
  const same = [mk('a', 'general-purpose', 'Investigate auth token refresh'), mk('b', 'general-purpose', 'Investigate payment retries')]
  expect(same.map(c => cardLabel(c, same))).toEqual(['auth token refresh', 'payment retries'])
  const alike = [mk('a', 'Explore', 'Run the tests'), mk('b', 'Explore', 'Run the tests')]
  expect(alike.map(c => cardLabel(c, alike))).toEqual(['Explore 1', 'Explore 2'])
})

test('long text wraps at word boundaries into at most the rows allowed, the last ending in an ellipsis', () => {
  expect(wrapLines('short', 20, 3)).toEqual(['short'])
  expect(wrapLines('one two three four five', 9, 5)).toEqual(['one two', 'three', 'four five'])
  expect(wrapLines('abcdefghijkl', 5, 5)).toEqual(['abcde', 'fghij', 'kl']) // a word longer than a row is split
  const capped = wrapLines('aaa bbb ccc ddd eee fff', 7, 2)
  expect(capped).toHaveLength(2)
  expect(capped[1]!.endsWith('…')).toBe(true)
  expect(wrapLines('   ', 10, 3)).toEqual(['']) // never empty: a row is always drawn
})

test('a graphical surface draws the effort as a gradient gauge, the meter with a gloss; the terminal keeps glyphs', async ($, on) => {
  engine(on)
  expect(meterSvg(50, 84)).toContain('cd-meter-gloss')
  expect(effortSvg(2, 40).match(/url\(#cd-effort-fill\)/g)).toHaveLength(2) // two of five segments filled
  const desktop = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  const svgs = await desktop.findAll({ type: 'Svg' })
  expect(svgs.some(s => String(s.props.alt).startsWith('effort '))).toBe(true)
  await desktop.unmount()
  const terminal = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ text: /▮|▯/ })).toBeDefined()
  await terminal.unmount()
})

test("a user's answer to AskUserQuestion is not one of the turn's slowest calls", async ($, on) => {
  const clock = engine(on)
  on('tool.call', async () => {
    await clock.sleep(5000)
    return { result: {}, text: 'ok' }
  })
  await $.turn.start({ text: 'go', turnId: 'Q1' })
  const call = $.tool.call({ tool: 'AskUserQuestion', input: {} } as never)
  await clock.advance(5000)
  await call
  const ui = await $.ui.mount({ ...pane(70), surface: 'terminal' })
  expect(await ui.find({ text: /^slowest/ })).toBeUndefined()
  await ui.unmount()
})

test('the gate strip leaves out what a rule allowed and lists what asked most with its rule', async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : String(e.tool_use_id).endsWith('x') ? 'deny' : 'ask' }))
  for (let i = 0; i < 5; i += 1) await $.tool.check({ tool: 'Read', input: { file_path: `/f${i}` }, tool_use_id: `r${i}` })
  const allAllowed = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  // 0.8.0: while a rule allowed every check, the panel is that one line; the totals come back with the first ask.
  expect(await allAllowed.find({ text: /^5 allowed by rule$/ })).toBeDefined()
  expect(await allAllowed.find({ text: /denied/ })).toBeUndefined()
  await allAllowed.unmount()
  await $.tool.check({ tool: 'Bash', input: { command: 'mvn test -pl a' }, tool_use_id: 'b1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mvn test -pl b' }, tool_use_id: 'b2x' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^[■✗]{2,}$/ }))?.text).toBe('■✗')
  expect(await ui.find({ text: /^×2$/ })).toBeDefined()
  expect(await ui.find({ text: /^Bash\(mvn test:\*\)$/ })).toBeDefined()
  expect(await ui.find({ text: /^1 denied$/ })).toBeDefined()
  await ui.unmount()
})

test("a card shows its latest call; the receipt shows the turn's slowest calls; wording is spelled out", async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'nw1' }))
  on('tool.call', async () => {
    await clock.sleep(5000)
    return { result: {}, text: 'ok' }
  })
  await $.turn.start({ text: 'go', turnId: 'N1' })
  await $.agent.spawn(spawn('general-purpose', 'Run the tests'))
  const call = $.tool.call({ tool: 'Bash', command: 'mvn verify -pl srvc', agentId: 'nw1' } as never)
  await clock.advance(5000)
  await call
  const ui = await $.ui.mount({ ...pane(70), surface: 'terminal' })
  expect(await ui.find({ text: /^→ Bash → mvn verify -pl srvc$/ })).toBeDefined()
  expect(await ui.find({ text: /^slowest calls$/ })).toBeDefined()
  expect(await ui.find({ text: /^Bash → mvn verify -pl srvc$/ })).toBeDefined() // its own row, with its time and bar
  expect(await ui.find({ text: /^5s$/ })).toBeDefined()
  // 0.8.0: the turn's clock is on the main card; the receipt, while it runs, is where its time went.
  expect(await ui.find({ text: /^● working$/ })).toBeDefined()
  expect(await ui.find({ text: /^◐ this turn$/ })).toBeDefined()
  expect(await ui.find({ text: /back to/ })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete({ answer: '', durationMs: 5000, isAborted: false, turnId: 'N1', reason: 'answer' })
  const done = await $.ui.mount({ ...pane(70), surface: 'terminal' })
  expect(await done.find({ text: /^slowest calls$/ })).toBeDefined()
  expect(await done.find({ text: /^Bash → mvn verify -pl srvc$/ })).toBeDefined()
  await done.unmount()
})

test('the main box estimates the turns left once the context grows, and /clear forgets the growth', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  const measure = (tokens: number) =>
    $.session.measure({ context: { tokens, window: 200_000, percent: tokens / 2000 }, cost: { usd: 1 }, rateLimits: [], changed: ['context'] } as never)
  for (const [i, tokens] of [100_000, 130_000, 160_000].entries()) {
    await measure(tokens)
    await $.turn.start({ text: 'go', turnId: `R${i}` })
  }
  await measure(170_000)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  // 30k, 30k and 10k a turn: about 23k, and 30k left: 1 turn.
  expect(await ui.find({ text: /^~1 turn left$/ })).toBeDefined()
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await measure(20_000)
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /turns? left/ })).toBeUndefined()
  await after.unmount()
})

// ---------------------------------------------------------------- 0.8.0: chrome, actions, layout

test('text cut in the middle keeps both ends within its cells; engine notes say what they are about', () => {
  const cut = midCut('~/workspace/INV-23511-IAC-scope/doc-package-generation', 24)
  expect(cut.startsWith('~/workspace/') && cut.endsWith('generation') && cut.includes('…')).toBe(true)
  expect([...cut].length <= 24).toBe(true)
  expect(midCut('short', 24)).toBe('short')
  expect([midCut('abcdef', 3), midCut('abcdef', 0)]).toEqual(['abc', ''])
  expect(promptLine('<task-notification>\n<summary>Agent "Explore" completed</summary>\n</task-notification>')).toEqual({ who: 'engine', text: 'task notification: Agent "Explore" completed' })
  expect(promptLine('<task-notification>chat-deck: its hook was skipped</task-notification>')).toEqual({ who: 'engine', text: 'task notification: chat-deck: its hook was skipped' })
  expect(promptLine('<system-reminder></system-reminder>')).toEqual({ who: 'engine', text: 'system reminder' })
})

test('a card folds to its header on its chevron and unfolds again; the fold is kept by the view', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'allow' }))
  for (let i = 0; i < 3; i += 1) await $.tool.check({ tool: 'Read', input: { file_path: `/f${i}` }, tool_use_id: `fo${i}` })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^3 allowed by rule$/ })).toBeDefined()
  expect((await ui.find({ key: 'fold-gate' }))?.props.label).toBe('▾')
  await ui.press({ key: 'fold-gate' })
  expect(await ui.find({ text: /^3 allowed by rule$/ }), 'the body is folded away').toBeUndefined()
  expect(await ui.find({ text: /GATE · permissions/ }), 'the header stays').toBeDefined()
  expect((await ui.find({ key: 'fold-gate' }))?.props.label).toBe('▸')
  await ui.unmount()
  const again = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await again.find({ text: /^3 allowed by rule$/ }), 'still folded on the next drawing').toBeUndefined()
  await again.press({ key: 'fold-gate' })
  expect(await again.find({ text: /^3 allowed by rule$/ })).toBeDefined()
  await again.unmount()
})

test('a failed call with no output reads as reason and call, with one mark; the failed-call count filters the log', async ($, on) => {
  engine(on)
  on('tool.call', (_$, e) => (String((e as { command?: unknown }).command) === 'false' ? { result: {}, text: '', isError: true } : { result: {}, text: 'ok' }))
  await $.turn.start({ text: 'try it', turnId: 'E1' })
  await $.tool.call({ tool: 'Edit', file_path: '/ws/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^failed, no output$/ }), 'the reason row').toBeDefined()
  expect(await ui.find({ text: /^Bash → false$/ }), 'the call beneath it').toBeDefined()
  expect(await ui.find({ text: /  ✗$/ }), 'no trailing mark').toBeUndefined()
  expect(await ui.find({ key: 'log-errors' })).toBeDefined()
  expect(await ui.find({ text: /^try it$/ }), 'the prompt line before filtering').toBeDefined()
  await ui.press({ key: 'log-errors' })
  expect(await ui.find({ text: /^try it$/ }), 'filtered to failed calls').toBeUndefined()
  expect(await ui.find({ text: /session log · failed calls/ })).toBeDefined()
  await ui.press({ key: 'log-errors' })
  expect(await ui.find({ text: /^try it$/ }), 'back to every line').toBeDefined()
  await ui.unmount()
})

test('every log row names its sender; the turn in flight shows its clock and counts on the main card', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'edit two files', turnId: 'W1' })
  await $.tool.call({ tool: 'Edit', file_path: '/ws/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/ws/b.ts', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /^● main$/ })).length, 'both edits name main').toBe(2)
  expect(await ui.find({ type: 'Text', text: /^● working$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^this turn$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 edits$/ })).toBeDefined()
  expect(await ui.find({ key: 'panel-receipt' }), 'no receipt while the turn has no slow call').toBeUndefined()
  await ui.unmount()
})

test('a path or command is cut in the middle and copied whole when pressed', async ($, on) => {
  engine(on)
  const copied: string[] = []
  const toasts: string[] = []
  on('ui.copy', (_$, e) => (copied.push((e as { text: string }).text), { value: { isCopied: true } }) as never)
  on('ui.toast', (_$, e) => (toasts.push((e as { text: string }).text), { value: undefined }) as never)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  const long = '/Users/someone/projects/a-very-long-repository-name/src/configuration/a-long-file-name-for-the-loader.ts'
  await $.tool.call({ tool: 'Edit', file_path: long, old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  const button = await ui.find({ key: `copy-file-${long}` })
  expect(button, 'the file row is a button').toBeDefined()
  expect(String(button?.props.label)).toContain('…')
  expect(String(button?.props.label).endsWith('loader.ts')).toBe(true)
  await ui.press({ key: `copy-file-${long}` })
  expect(copied).toEqual([long])
  expect(toasts.some(t => t.startsWith('copied '))).toBe(true)
  await ui.unmount()
  // A graphical surface also shows the whole path while the pointer rests on it.
  const desk = await $.ui.mount({ ...pane(40), surface: 'desktop' })
  // (A drawing's `hover` is the surface's to apply and is not in the tree a test reads: the hidden, placed card is.)
  const tip = (await desk.find({ key: `tip-file-${long}` })) as unknown as { children: { props?: Record<string, unknown> }[] }
  expect(tip.children.some(k => k.props?.display === 'none' && k.props?.position === 'absolute')).toBe(true)
  expect(await desk.find({ type: 'Text', text: /^\/Users\/someone\/projects/ }), 'the tip holds the whole path').toBeDefined()
  await desk.unmount()
})

// The scroll itself is a host call with no hook to observe it here: what a test can see is the unfold.
test('the header chips are buttons that unfold (and scroll to) their panel', async ($, on) => {
  engine(on)
  on('tool.call', (_$, e) => (String((e as { command?: unknown }).command ?? '').includes('mvn') ? { result: {}, text: MAVEN_PASS } : { result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'mvn verify' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const counts = /^16 passed · 0 failed · 1 skipped$/
  expect(await ui.find({ text: counts }), 'open').toBeDefined()
  await ui.press({ key: 'fold-checks' })
  expect(await ui.find({ text: counts }), 'folded').toBeUndefined()
  expect((await ui.find({ key: 'attn-run' }))?.props.label).toBe('✓ tests')
  await ui.press({ key: 'attn-run' })
  expect(await ui.find({ text: counts }), 'the chip unfolded it').toBeDefined()
  await ui.unmount()
  // The pane's name heads the terminal only: a graphical frame names it already.
  const desk = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  expect(await desk.find({ text: /^CHAT DECK$/ })).toBeUndefined()
  await desk.unmount()
})

test('wide, the now and attention panels hold the left column; gate and architect go where there is room', async ($, on) => {
  await busySession($, on)
  const ui = await $.ui.mount({ ...pane(130), surface: 'terminal' })
  const keysIn = (n: unknown, out: string[] = []): string[] => {
    if (!isDrawn(n)) return out
    if (typeof n.props?.key === 'string' && n.props.key.startsWith('panel-')) out.push(n.props.key.slice(6))
    ;(n.children ?? []).forEach(k => keysIn(k, out))
    return out
  }
  // The body's first row holds the two columns, side by side.
  const root = (await ui.drawn()) as Drawn
  const body = (root.children ?? []).filter(isDrawn)[1]!
  const pair = (body.children ?? []).filter(isDrawn)[0]!
  const [leftCol, rightCol] = (pair.children ?? []).filter(isDrawn)
  const l = keysIn(leftCol)
  const r = keysIn(rightCol)
  expect(l.slice(0, 2), 'main heads the left column, checks under it').toEqual(['main', 'checks'])
  expect(r.includes('files'), 'the work is on the right').toBe(true)
  expect([...l, ...r].filter(k => k === 'gate' || k === 'architect').sort()).toEqual(['architect', 'gate'])
  await ui.unmount()
})

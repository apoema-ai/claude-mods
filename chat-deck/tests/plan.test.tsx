// The plan panel (0.7.0), ported from the plan-bar mod's tests: the band above the prompt is now a panel in the pane.
import { expect, mock, test } from 'claude-code/testing'

import { planLine, planLines } from '../hooks/plan'
import type { PlanLineProps } from '../hooks/plan'

/** The `on` a test body is handed. */
type On = Parameters<NonNullable<Parameters<typeof test>[2]>>[1]
type Surface = 'desktop' | 'terminal'
type CallTool = (input: unknown) => Promise<{ result?: unknown; context?: string[] }>
type View = Awaited<ReturnType<Parameters<NonNullable<Parameters<typeof test>[2]>>[0]['ui']['mount']>>

const TOOL = 'mcp__chat-deck__plan'
const NOW = 1_000_000
const iso = (ms: number) => new Date(ms).toISOString()

/** The file `path` names: exact, or a key led by a star that any home can end with. */
const keyOf = (files: Record<string, string>, path: string) =>
  path in files ? path : Object.keys(files).find(k => k.startsWith('*') && path.endsWith(k.slice(1)))

/** Each tool spec the mod registered, newest test only. */
let specs: { isDeferred?: boolean; description?: string }[] = []

/** Mocks every $ call the mod makes; `files` stands in for the disk. */
function rig(on: On, files: Record<string, string>) {
  const ran: string[][] = []
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  let n = 0
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('session.id', async () => ({ value: 'sess1' }) as never)
  on('session.cwd', async () => ({ value: '/Users/test/vault' }) as never)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('env.get', async () => ({ value: '/Users/test' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async ($, e) => {
    specs.push(e as { isDeferred?: boolean; description?: string })
    return { value: { tool: TOOL } } as never
  })
  const clock = mock.clock(on, { now: NOW })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId: `agent-${++n}` }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', async ($, e) => {
    statuses.push((e as { text: string | undefined }).text)
    return { value: undefined } as never
  })
  on('ui.toast', async ($, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  // 'Slow' stays running until the test calls release(); 'Broken' fails.
  let releaseSlow: () => void = () => undefined
  on('tool.call', async (_, e) => {
    if ((e.tool as string) === 'Slow') await new Promise<void>(res => (releaseSlow = res))
    return ((e.tool as string) === 'Broken' ? { result: 'boom', text: 'boom', isError: true } : { result: 'ok', text: 'ok' }) as never
  })
  on('turn.complete', async () => ({ text: '' }) as never)
  on('turn.start', async (_, e) => ({ turnId: e.turnId }) as never)
  on('fs.exists', async ($, e) => ({ value: keyOf(files, (e as { path: string }).path) !== undefined }) as never)
  on('fs.read', async ($, e) => ({ value: files[keyOf(files, (e as { path: string }).path) ?? ''] ?? '' }) as never)
  on('fs.write', async ($, e) => {
    const { path, text } = e as { path: string; text: string }
    files[path] = text
    return { value: undefined } as never
  })
  on('process.run', async ($, e) => {
    const argv = (e as { argv?: string[] }).argv ?? []
    ran.push(argv)
    // No git here: the git panel stays out of the way.
    return { value: { exitCode: argv[0] === 'mkdir' ? 0 : 1, stdout: '', stderr: '' } } as never
  })
  return { ran, clock, toasts, statuses, release: () => releaseSlow() }
}

const pane = (surface: Surface, bodyColumns = 80, placement: 'dock' | 'inline' = 'dock') =>
  ({
    plugin: 'chat-deck',
    component: 'Pane',
    requestId: 'chatdeck',
    surface,
    props: { title: 'Chat Deck', isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows: 70 }, view: {} },
  }) as never

/** The plan bar's drawing on a graphical surface: the Svg whose alt names the count. */
async function planSvgOf(v: View) {
  const all = (await v.findAll({ type: 'Svg' })) as unknown as { props: { alt?: string; source?: string } }[]
  return all.find(x => /Tasks \d+\/\d+/.test(String(x.props.alt ?? '')))
}

/** The line under the bar, as the client clock would draw it when the pane drew, or the plain Text. */
async function lineSays(v: View) {
  const el = (await v.find({ key: 'plan-now' })) as { type: string; props: Record<string, unknown>; text?: string } | undefined
  if (!el) return ''
  if (el.type === 'Client') {
    const p = el.props.props as PlanLineProps & { now: number }
    return planLine(p, p.now)
  }
  return String(el.text ?? '')
}

/** What the panel says: its bar (the drawing's alt text on desktop, the texts in the terminal) and the line under it. */
async function planSays(v: View, surface: Surface) {
  const band = await v.find({ key: 'plan-band' })
  if (!band) return ''
  const bar =
    surface === 'desktop'
      ? String((await planSvgOf(v))?.props.alt ?? '')
      : ((await v.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join(' ')
  return `${bar} | ${await lineSays(v)}`
}

const planFile = (files: Record<string, string>) => Object.keys(files).find(k => k.endsWith('/.claude/mods-state/plan-sess1.json'))

const steps4 = (done: number, live: boolean) =>
  ['Read the brief', 'Draft the outline', 'Build the slides', 'Check the deck'].map((text, i) => ({
    text,
    status: i < done ? 'completed' : i === done && live ? 'in_progress' : 'pending',
  }))

const start = async ($: Parameters<NonNullable<Parameters<typeof test>[2]>>[0], surface: Surface, source = 'startup') =>
  $.session.start({ source, cwd: '/Users/test/vault', surface, isInteractive: true } as never)

test('/chat-deck off writes the shared switch, clears the status and stops the plan tool, on brings it back', { timeoutMs: 30000 }, async ($, on) => {
  const switches = '/Users/test/.claude/mods/switches.json'
  const files: Record<string, string> = { [switches]: '{ "other": false }' }
  const { clock, statuses } = rig(on, files)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const run = async (args: string) => ($.command.run({ command: 'chat-deck', args } as never) as Promise<{ text: string }>)

  expect((await run('status')).text, 'on at the start').toBe('Chat Deck is on. Type /chat-deck off to turn it off.')
  expect(String((await callTool({ tool: TOOL, tool_use_id: 'p1', title: 'Make the deck', steps: steps4(1, true) })).result), 'plan kept').toBe('Plan saved: 1 of 4 steps done.')

  expect((await run('off')).text).toMatch(/off in every chat/)
  expect(JSON.parse(files[switches]!), 'switch written, other keys kept').toEqual({ other: false, 'chat-deck': false })
  expect(statuses[statuses.length - 1], 'status line cleared').toBeUndefined()
  expect(String((await callTool({ tool: TOOL, tool_use_id: 'p2', title: 'Make the deck', steps: steps4(2, true) })).result), 'plan tool stands down').toMatch(/Chat Deck is off/)
  expect(((await $.command.run({ command: 'chatdeck', args: '' } as never)) as { text: string }).text, 'the pane will not open').toMatch(/is off/)

  expect((await run('on')).text).toBe('Chat Deck is on.')
  expect(JSON.parse(files[switches]!), 'switch removed').toEqual({ other: false })
  await clock.settle()
  expect(String((await callTool({ tool: TOOL, tool_use_id: 'p3', title: 'Make the deck', steps: steps4(2, true) })).result), 'plan kept again').toBe('Plan saved: 2 of 4 steps done.')
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the plan tool writes the plan file and draws "2 of 4" in the pane (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const { clock, ran } = rig(on, files)
    await start($, surface)
    const callTool = $.tool.call as unknown as CallTool
    const said = await callTool({ tool: TOOL, tool_use_id: 'p1', title: 'Make the deck', steps: steps4(2, true) })
    await clock.settle()
    expect(String(said.result), 'tool answer').toBe('Plan saved: 2 of 4 steps done.')
    const path = planFile(files)
    expect(path, 'plan file written').toBeDefined()
    expect(ran.some(a => a[0] === 'mkdir' && String(a[a.length - 1]).endsWith('/.claude/mods-state')), 'state folder made').toBe(true)
    const saved = JSON.parse(files[path!]!) as { title: string; steps: { status: string; doneAt?: string }[]; updatedAt: string }
    expect(saved.title, 'title saved').toBe('Make the deck')
    expect(saved.steps.map(st => st.status), 'statuses saved').toEqual(['completed', 'completed', 'in_progress', 'pending'])
    expect(typeof saved.steps[0]!.doneAt, 'done steps carry a time').toBe('string')

    const v = await $.ui.mount(pane(surface))
    const says = await planSays(v, surface)
    expect(says, 'count').toContain('Tasks 2/4')
    expect(await v.find({ text: '▸ Build the slides' }), 'the step in progress is the header').toBeDefined()
    expect(await v.find({ text: /\d+ steps/ }), 'no step count in the header').toBeUndefined()
    // 0.8.0: the line holds the step in progress's time alone (none yet, it has just started); what finished
    // before it, and when, is in the step list.
    expect(await lineSays(v), 'nothing under the bar until the step has run a second').toBe('')
    expect(await v.find({ key: 'plan-step-1' }), 'the list is closed').toBeUndefined()
    await v.press({ key: 'plan-steps' })
    expect(await v.find({ key: 'plan-step-1' }), 'the list opens').toBeDefined()
    expect(await v.find({ text: /^Draft the outline$/ }), 'a finished step is listed').toBeDefined()
    expect(await v.find({ text: /^Check the deck$/ }), 'so is one still to come').toBeDefined()
    await v.press({ key: 'plan-steps' })
    expect(await v.find({ key: 'plan-step-1' }), 'and closes again').toBeUndefined()
    if (surface === 'desktop') {
      const svg = String((await planSvgOf(v))?.props.source)
      expect(svg, 'emerald-to-teal gradient').toContain('#0f766e')
      expect(svg, 'sparkles twinkle').toContain('@keyframes tw')
      expect(svg, 'the step in progress glows').toContain('class="lv"')
    } else {
      const cells = await v.findAll({ text: /^█$/ })
      expect(cells.length > 0, 'finished segments are filled').toBe(true)
      expect(cells[0]!.props.color, 'light emerald at the start').toBe('#34d399')
      expect(cells[cells.length - 1]!.props.color, 'deep teal at the head').toBe('#0f766e')
    }

    // A running subagent adds no segment, but the line under the bar names it by type.
    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Build the slides', subagentType: 'general-purpose' } as never)
    await clock.settle()
    const el = (await v.find({ key: 'plan-now' })) as unknown as { props: { props: PlanLineProps & { now: number } } }
    expect(planLine(el.props.props, el.props.props.now + 3_100), "the model's subagents, by type").toMatch(/^this step \d+s · 1 subagent running: general-purpose$/)
    expect(await planSays(v, surface), 'the count is still steps').toContain('Tasks 2/4')
  })

  test(`plan updates: finished steps stay, rewording keeps the time, a new total is announced (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const { clock, toasts } = rig(on, files)
    await start($, surface)
    const callTool = $.tool.call as unknown as CallTool
    const send = (steps: unknown) => callTool({ tool: TOOL, tool_use_id: 'p', title: 'Make the deck', steps })
    const saved = () => JSON.parse(files[planFile(files)!]!) as { steps: { text: string; doneAt?: string }[] }
    const v = await $.ui.mount(pane(surface))

    await send(steps4(2, true))
    await clock.settle()
    const doneAt = saved().steps[0]!.doneAt
    await send(steps4(2, true).slice(2))
    await clock.settle()
    expect(await planSays(v, surface), 'finished steps kept').toContain('Tasks 2/4')

    await clock.advance(5_000)
    const reworded = steps4(3, true).map((st, i) => (i === 0 ? { ...st, text: 'Read the brief again' } : st))
    await send(reworded)
    await clock.settle()
    expect(saved().steps[0]!.doneAt, 'done time kept across a rewording').toBe(doneAt)
    expect(saved().steps, 'still four steps').toHaveLength(4)

    await send([...reworded, { text: 'Send it', status: 'pending' }, { text: 'Archive it', status: 'pending' }])
    await clock.settle()
    expect(toasts.some(t => t.includes('Plan now has 6 steps (was 4)')), 'new total announced').toBe(true)
    expect(await planSays(v, surface), 'count follows the list, late steps marked').toContain('Tasks 3/6 +2')

    await send([{ text: 'Something else', status: 'in_progress' }, { text: 'And more', status: 'pending' }])
    await clock.settle()
    expect(await planSays(v, surface), 'a new plan starts from zero').toContain('Tasks 0/2')
  })

  test(`the step in progress fills its segment as its time runs (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock } = rig(on, {})
    await start($, surface)
    const callTool = $.tool.call as unknown as CallTool
    const send = (steps: unknown) => callTool({ tool: TOOL, tool_use_id: 'p', title: 'T', steps })
    const work = async (seconds: number) => {
      await clock.advance(seconds * 1000 + 100)
      await clock.settle()
    }
    const v = await $.ui.mount(pane(surface))
    const filled = async () =>
      surface === 'desktop'
        ? (String((await planSvgOf(v))?.props.source).match(/fill="url\(#cd-plan-g\)"/g) ?? []).length
        : (await v.findAll({ text: /^█$/ })).length

    await send(steps4(0, true))
    await work(4)
    await send(steps4(1, true))
    await clock.settle()
    const before = await filled()
    await work(2)
    // The pane redraws on the next write; a tool call is the usual one.
    await callTool({ tool: 'Read', tool_use_id: 'r1', file_path: '/x' })
    await clock.settle()
    expect(await filled(), 'two seconds against a four-second step fill part of the next segment').toBeGreaterThan(before)
    expect(await planSays(v, surface), 'the count still moves only when a step is done').toContain('Tasks 1/4')
  })

  test(`a step finishing raises a toast, and a finished plan holds 20 s then hides (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock, toasts } = rig(on, {})
    await start($, surface)
    const callTool = $.tool.call as unknown as CallTool
    const plan = (steps: unknown, n: number) => callTool({ tool: TOOL, tool_use_id: `p${n}`, title: 'Make the deck', steps })
    await plan(steps4(1, true), 1)
    await clock.settle()
    expect(toasts, 'no toast for steps already done in a new plan').toHaveLength(0)
    await plan(steps4(2, true), 2)
    await clock.settle()
    expect(toasts, 'the step that finished').toEqual(['Done: Draft the outline'])

    await plan(steps4(4, false), 3)
    await clock.settle()
    expect(toasts[toasts.length - 1], 'whole plan done').toBe('All 4 steps done.')
    const v = await $.ui.mount(pane(surface))
    expect(await planSays(v, surface), 'held when done').toContain('Tasks 4/4')
    expect(await lineSays(v), 'the held panel reads the summary').toBe('All 4 steps done')
    await clock.advance(19_000)
    expect(await v.find({ key: 'plan-band' }), 'still there before 20 s').toBeDefined()
    await clock.advance(1_500)
    expect(await v.find({ key: 'plan-band' }), 'gone after 20 s').toBeUndefined()

    await plan(steps4(0, true), 4)
    await clock.settle()
    expect(await planSays(v, surface), 'a new plan shows').toContain('Tasks 0/4')
  })
}

test('done and next update the open plan without resending it', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, toasts } = rig(on, {})
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const send = async (args: Record<string, unknown>) => String((await callTool({ tool: TOOL, tool_use_id: 'p', ...args })).result)
  const v = await $.ui.mount(pane('terminal'))

  expect(await send({ next: true }), 'no plan yet').toContain('no open plan to update')
  await send({ title: 'Make the deck', steps: steps4(0, true) })
  expect(await send({ next: true }), 'next finishes the current step and starts the next').toBe('Plan saved: 1 of 4 steps done. Now: Draft the outline.')
  expect(await send({ done: ['build the SLIDES'] }), 'done names a step, case aside').toBe('Plan saved: 2 of 4 steps done. Now: Draft the outline.')
  const bad = await send({ done: ['Ship it'] })
  expect(bad, 'an unknown name is refused with the steps').toContain('no step called "Ship it"')
  expect(bad, 'the refusal lists the steps').toContain('Read the brief | Draft the outline | Build the slides | Check the deck')
  await clock.settle()
  expect(await planSays(v, 'terminal'), 'a refusal changes nothing').toContain('Tasks 2/4')
  await send({ next: true })
  expect(await send({ next: true }), 'the last step finishes').toBe('Plan saved: 4 of 4 steps done.')
  await clock.settle()
  expect(toasts[toasts.length - 1], 'whole plan done').toBe('All 4 steps done.')
  expect(await send({ next: true }), 'a finished plan is not updated').toContain('no open plan to update')
})

test('the plan tool refuses two steps in progress and a first plan that is all done', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  const { clock } = rig(on, files)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const send = (steps: unknown) => callTool({ tool: TOOL, tool_use_id: 'p', title: 'T', steps })
  expect(String((await send([{ text: 'A', status: 'in_progress' }, { text: 'B', status: 'in_progress' }])).result)).toContain('only one step can be in_progress')
  expect(String((await send([{ text: 'A', status: 'completed' }, { text: 'B', status: 'completed' }])).result)).toContain('a new plan starts with its steps pending')
  await clock.settle()
  expect(planFile(files), 'nothing saved').toBeUndefined()
  await send([{ text: 'A', status: 'in_progress' }, { text: 'B', status: 'pending' }])
  expect(String((await send([{ text: 'A', status: 'completed' }, { text: 'B', status: 'completed' }])).result)).toBe('Plan saved: 2 of 2 steps done.')
})

test('a TodoWrite call on the main chat is mirrored into the plan; a subagent list is not', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  const { clock } = rig(on, files)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const todos = [
    { content: 'Pull the numbers', status: 'completed', activeForm: 'Pulling the numbers' },
    { content: 'Write the summary', status: 'in_progress', activeForm: 'Writing the summary' },
    { content: 'Send the link', status: 'pending', activeForm: 'Sending the link' },
  ]
  await callTool({ tool: 'TodoWrite', tool_use_id: 't0', todos, agentId: 'agent-x' })
  await clock.settle()
  expect(planFile(files), 'no plan from a subagent').toBeUndefined()
  await callTool({ tool: 'TodoWrite', tool_use_id: 't1', todos })
  await clock.settle()
  const saved = JSON.parse(files[planFile(files)!]!) as { steps: { text: string }[] }
  expect(saved.steps.map(st => st.text), 'todos mirrored').toEqual(['Pull the numbers', 'Write the summary', 'Send the link'])
  const v = await $.ui.mount(pane('terminal'))
  expect(await planSays(v, 'terminal'), 'panel from TodoWrite').toContain('Tasks 1/3')
  expect(await v.find({ text: '▸ Writing the summary' }), 'current todo on top, in its present-tense form').toBeDefined()
  expect(await lineSays(v), 'the line has no time to show yet').toBe('')
})

test('the plan tool sits in front, and work without a plan gets one nudge', { timeoutMs: 30000 }, async ($, on) => {
  specs = []
  const files: Record<string, string> = {}
  const { clock } = rig(on, files)
  await start($, 'desktop')
  await clock.settle()
  expect(specs[0]?.isDeferred, 'not behind ToolSearch').toBe(false)
  expect(specs[0]?.description, 'the tool itself says when to plan').toContain('call it first, before other tools')
  expect(specs[0]?.description, 'it names the pane, not a bar above the prompt').toContain('Chat Deck pane')
  const callTool = $.tool.call as unknown as CallTool
  const first = await callTool({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' })
  const second = await callTool({ tool: 'Bash', tool_use_id: 'b2', command: 'ls' })
  expect([...(first.context ?? []), ...(second.context ?? [])], 'two calls: quiet').toHaveLength(0)
  const third = await callTool({ tool: 'Bash', tool_use_id: 'b3', command: 'ls' })
  expect((third.context ?? []).join(' '), 'no plan yet: nudge').toContain('before more tool calls')
  expect((third.context ?? []).join(' '), 'the nudge names the app list first, then this tool').toMatch(/mcp__ccd_turn__update_plan.*mcp__chat-deck__plan/)
  const fourth = await callTool({ tool: 'Bash', tool_use_id: 'b4', command: 'ls' })
  expect(fourth.context ?? [], 'only once a turn').toHaveLength(0)
  await callTool({ tool: TOOL, tool_use_id: 'p1', steps: steps4(0, true) })
  const after = await callTool({ tool: 'Read', tool_use_id: 'r1', file_path: '/x' })
  expect(after.context ?? [], 'plan made: quiet').toHaveLength(0)
  expect(planFile(files), 'plan file written for Chat Inventory').toBeDefined()
})

test('the desktop app task list feeds the plan, and the plan tool then stands down', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const host = (args: Record<string, unknown>) => callTool({ tool: 'mcp__ccd_turn__update_plan', tool_use_id: 'h', ...args })
  const v = await $.ui.mount(pane('terminal'))
  await host({ items: steps4(0, true).map(st => ({ content: st.text, status: st.status })), scope: 'first_task' })
  await clock.settle()
  expect(await planSays(v, 'terminal'), 'items: the whole list').toContain('Tasks 0/4')
  await host({ advance: true })
  await clock.settle()
  expect(await v.find({ text: '▸ Draft the outline' }), 'advance: next step').toBeDefined()
  await host({ done: [2], start: 4 })
  await clock.settle()
  expect(await planSays(v, 'terminal'), 'done by number').toContain('Tasks 2/4')
  expect(await v.find({ text: '▸ Check the deck' }), 'start: out of order').toBeDefined()
  const said = await callTool({ tool: TOOL, tool_use_id: 'p', next: true })
  expect(String(said.result), 'the plan tool points at the app list').toContain('mcp__ccd_turn__update_plan')
  await clock.settle()
  expect(await planSays(v, 'terminal'), 'no step finished twice').toContain('Tasks 2/4')
  const ctx = (await Promise.all([1, 2, 3].map(i => callTool({ tool: 'Bash', tool_use_id: `b${i}`, command: 'ls' })))).flatMap(r => r.context ?? [])
  expect(ctx.join(' '), 'the app list counts as a plan: no nudge').not.toContain('no plan')
})

test('a failed step shows red, is counted, and can be retried', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  const { clock, toasts } = rig(on, files)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const send = async (args: Record<string, unknown>) => String((await callTool({ tool: TOOL, tool_use_id: 'p', title: 'Make the deck', ...args })).result)
  const v = await $.ui.mount(pane('terminal'))
  await send({ steps: steps4(1, true) })
  expect(await send({ failed: [2] }), 'failed by number').toBe('Plan saved: 1 of 4 steps done.')
  await clock.settle()
  expect(toasts[toasts.length - 1], 'toast').toBe('Failed: Draft the outline')
  expect(await planSays(v, 'terminal'), 'label counts it').toContain('Tasks 1/4 · 1 failed')
  expect(await lineSays(v), 'line under the bar').toBe('Failed: Draft the outline')
  expect(String((await v.find({ text: /^▒+$/ }))?.props.color), 'red run').toBe('#ef4444')
  expect(JSON.parse(files[planFile(files)!]!).steps[1].status, 'written to the plan file').toBe('failed')
  const d = await $.ui.mount(pane('desktop'))
  expect(String((await planSvgOf(d))?.props.source), 'red segment on the desktop').toContain('fill="#ef4444"')
  await send({ steps: steps4(1, true) })
  await clock.settle()
  expect(await planSays(v, 'terminal'), 'retried: in progress again').not.toContain('failed')
  expect(await v.find({ text: '▸ Draft the outline' }), 'retry is the step in progress').toBeDefined()
})

test('the line shows elapsed time and the last call; the end toast sums up', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, toasts } = rig(on, {})
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const send = (args: Record<string, unknown>) => callTool({ tool: TOOL, tool_use_id: 'p', title: 'Ship it', ...args })
  const v = await $.ui.mount(pane('terminal', 120))
  await send({ steps: steps4(0, true) })
  await callTool({ tool: 'Bash', tool_use_id: 'b1', command: 'mvn test -pl core' })
  await clock.advance(65_200)
  // The client clock counts on from the pane's reading; the test reads it at the time the pane drew.
  const el = (await v.find({ key: 'plan-now' })) as unknown as { props: { props: PlanLineProps & { now: number } } }
  expect(planLine(el.props.props, NOW + 65_200), 'step, time, last call').toBe('this step 1m05s · Bash: mvn test -pl core')
  await send({ next: true })
  await clock.settle()
  expect(toasts[toasts.length - 1], 'a finished step says how long it took').toBe('Done: Read the brief (1m05s)')
  await send({ next: true })
  await clock.advance(120_000)
  await send({ next: true })
  await clock.advance(5_000)
  await send({ next: true })
  await clock.settle()
  expect(toasts[toasts.length - 1], 'total and longest step').toBe('All 4 steps done in 3m10s · longest: Build the slides 2m00s.')
  expect(await lineSays(v), 'the held panel reads the same summary').toBe('All 4 steps done in 3m10s · longest: Build the slides 2m00s')
})

test('the activity says a call is still running, and when it failed', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, release } = rig(on, {})
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const v = await $.ui.mount(pane('terminal', 120))
  await callTool({ tool: TOOL, tool_use_id: 'p', title: 'Ship it', steps: steps4(0, true) })
  const slow = callTool({ tool: 'Slow', tool_use_id: 's1', command: 'mvn verify' })
  await clock.settle()
  const el = (await v.find({ key: 'plan-now' })) as unknown as { props: { props: PlanLineProps & { now: number } } }
  expect(planLine(el.props.props, el.props.props.now + 5_000), 'running, with its time').toContain('Slow: mvn verify · running 5s')
  release()
  await slow
  await clock.settle()
  const after = await lineSays(v)
  expect(after, 'returned: the call stays named').toContain('Slow: mvn verify')
  expect(after, 'returned: no longer running').not.toContain('running')
  await callTool({ tool: 'Broken', tool_use_id: 'x1', command: 'mvn test' })
  await clock.settle()
  expect(await lineSays(v), 'an error result is marked').toContain('Broken: mvn test · failed')
})

test('a list with no title takes the prompt that opened the turn', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  const { clock } = rig(on, files)
  on('prompt.submit', async (_, e) => e as never)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const v = await $.ui.mount(pane('terminal'))
  await $.prompt.submit({ text: '\nFix the flaky login test in the auth module and add a regression check\nmore detail' } as never)
  await $.prompt.submit({ text: 'also check the logs', turnId: 't1' } as never)
  await callTool({ tool: 'mcp__ccd_turn__update_plan', tool_use_id: 'h', items: steps4(0, true).map(st => ({ content: st.text, status: st.status })) })
  await clock.settle()
  expect(JSON.parse(files[planFile(files)!]!).title, 'first line, cut to 40 with the ellipsis').toBe('Fix the flaky login test in the auth mo…')
  expect(String((await v.find({ text: '▸ Read the brief' })) ? 'shown' : ''), 'the header is the step, not the title').toBe('shown')
})

test('a plan call sent beside other calls is not nudged as work without a plan', { timeoutMs: 30000 }, async ($, on) => {
  rig(on, {})
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  await callTool({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' })
  await callTool({ tool: 'Bash', tool_use_id: 'b2', command: 'ls' })
  const [third] = await Promise.all([
    callTool({ tool: 'Bash', tool_use_id: 'b3', command: 'ls' }),
    callTool({ tool: 'mcp__ccd_turn__update_plan', tool_use_id: 'h', items: [{ content: 'A', status: 'in_progress' }] }),
  ])
  expect((third.context ?? []).join(' '), 'no nudge beside a plan call').not.toContain('no plan')
})

test('a resume brings back a recent plan with its times and late-step marks', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  files['*/.claude/mods-state/plan-sess1.json'] = JSON.stringify({
    title: 'Recent work',
    steps: [
      { text: 'A', status: 'completed', startedAt: iso(NOW - 120_000), doneAt: iso(NOW - 60_000) },
      { text: 'B', status: 'in_progress', startedAt: iso(NOW - 30_000) },
      { text: 'C', status: 'pending', added: true },
    ],
    startedAt: iso(NOW - 120_000),
    updatedAt: iso(NOW - 30_000),
  })
  const { clock } = rig(on, files)
  await start($, 'terminal', 'resume')
  await clock.settle()
  const v = await $.ui.mount(pane('terminal'))
  expect(await planSays(v, 'terminal'), 'recent plan back, its late step still marked').toContain('Tasks 1/3 +1')
  expect(await lineSays(v), 'its start time kept').toBe('this step 30s')
  // The finished step keeps its time in the list.
  await v.press({ key: 'plan-steps' })
  expect(await v.find({ text: /^1m00s$/ }), "A's time").toBeDefined()
})

test('a plan untouched for half a day does not come back on resume', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  files['*/.claude/mods-state/plan-sess1.json'] = JSON.stringify({
    title: 'Old work',
    steps: [{ text: 'A', status: 'in_progress' }, { text: 'B', status: 'pending' }],
    updatedAt: iso(NOW - 13 * 60 * 60 * 1000),
  })
  const { clock } = rig(on, files)
  await start($, 'terminal', 'resume')
  await clock.settle()
  const v = await $.ui.mount(pane('terminal'))
  expect(await v.find({ key: 'plan-band' }), 'stale plan stays away').toBeUndefined()
})

test('done takes step numbers, and a finished step left out keeps its place', { timeoutMs: 30000 }, async ($, on) => {
  const files: Record<string, string> = {}
  const { clock } = rig(on, files)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  const send = async (args: Record<string, unknown>) => String((await callTool({ tool: TOOL, tool_use_id: 'p', title: 'T', ...args })).result)
  const order = () => (JSON.parse(files[planFile(files)!]!) as { steps: { text: string }[] }).steps.map(st => st.text)
  const all = steps4(2, true)
  await send({ steps: all })
  await send({ steps: [all[0], all[2], all[3]] })
  await clock.settle()
  expect(order(), 'the omitted finished step stays second').toEqual(all.map(st => st.text))
  expect(await send({ done: [3] }), 'done by number').toBe('Plan saved: 3 of 4 steps done.')
  expect(await send({ done: [9] }), 'a number out of range is refused').toContain('no step 9; the plan has 4')
})

// ---------------------------------------------------------------- new in chat-deck

test('the panel sits under main, in the left column when wide, and draws at every width', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  await callTool({ tool: TOOL, tool_use_id: 'p', title: 'Make the deck', steps: steps4(1, true) })
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const cols of [24, 40, 80, 110, 140]) {
      const v = await $.ui.mount(pane(surface, cols))
      expect(await v.find({ key: 'plan-band' }), `drawn at ${cols} on ${surface}`).toBeDefined()
      expect(await planSays(v, surface), `count at ${cols} on ${surface}`).toContain('Tasks 1/4')
      await v.unmount()
    }
  }
})

test('the status line carries the plan count, and the inline summary one plan row in 8', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, statuses } = rig(on, {})
  on('tool.check', () => ({ decision: 'allow' }) as never)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  await $.turn.start({ text: 'go', turnId: 'M1' } as never)
  for (const d of ['one', 'two', 'three', 'four']) await $.agent.spawn({ tool_use_id: `s-${d}`, prompt: d, description: `task ${d}`, subagentType: 'general-purpose' } as never)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' } as never)
  await callTool({ tool: TOOL, tool_use_id: 'p', title: 'Make the deck', steps: steps4(1, true) })
  await clock.settle()
  expect(statuses[statuses.length - 1], 'status line').toContain('plan 1/4')
  const v = await $.ui.mount(pane('terminal', 80, 'inline'))
  const root = (await v.drawn()) as { children?: unknown[] }
  expect((root.children ?? []).filter(Boolean).length <= 8, 'still at most 8 rows').toBe(true)
  expect(await v.find({ text: 'Tasks 1/4' }), 'the plan row').toBeDefined()
  expect(await v.find({ text: '· Draft the outline' }), 'with the step in progress').toBeDefined()
  expect(await v.find({ text: /\+2 more agents/ }), 'one agent row gave way to it').toBeDefined()
})

test('hiding the plan panel hides its band, and the plan still works', { timeoutMs: 30000 }, async ($, on) => {
  specs = []
  const { clock } = rig(on, {})
  await start($, 'terminal')
  await clock.settle()
  expect(specs, 'the tool is registered').toHaveLength(1)
  const callTool = $.tool.call as unknown as CallTool
  await callTool({ tool: TOOL, tool_use_id: 'p', title: 'Make the deck', steps: steps4(1, true) })
  await clock.settle()
  const v = await $.ui.mount(pane('terminal'))
  expect(await v.find({ key: 'plan-band' }), 'the band shows').toBeDefined()
  await v.press({ key: 'panels-toggle' })
  await v.press({ key: 'panel-plan' })
  expect(await v.find({ key: 'plan-band' }), 'no panel once hidden').toBeUndefined()
  expect(String((await callTool({ tool: TOOL, tool_use_id: 'p2', next: true })).result), 'the plan still takes updates').not.toContain('no open plan')
  await v.unmount()
})

test('/clear starts the plan fresh', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, {})
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  await callTool({ tool: TOOL, tool_use_id: 'p', title: 'Make the deck', steps: steps4(1, true) })
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'sess1' } as never)
  await clock.settle()
  const v = await $.ui.mount(pane('terminal'))
  expect(await v.find({ key: 'plan-band' }), 'no plan after /clear').toBeUndefined()
  expect(String((await callTool({ tool: TOOL, tool_use_id: 'p2', next: true })).result), 'nothing to update').toContain('no open plan')
})

test('the line under the bar is one row at every width: the step in progress, its call, its agents', { timeoutMs: 30000 }, async ($, on) => {
  const x: PlanLineProps = { cur: { startedAt: NOW - 30_000 }, head: '', act: null, agents: '' }
  expect(planLines(x, NOW), 'the step time').toEqual(['this step 30s'])
  expect(planLines({ ...x, agents: '1 subagent running: Explore' }, NOW), 'one row with the agents').toEqual(['this step 30s · 1 subagent running: Explore'])
  expect(planLines({ ...x, cur: { startedAt: NOW - 200 } }, NOW), 'under a second: nothing').toEqual([])

  const { clock } = rig(on, {})
  await start($, 'terminal')
  const callTool = $.tool.call as unknown as CallTool
  await callTool({ tool: TOOL, tool_use_id: 'p', title: 'T', steps: steps4(0, true) })
  await clock.advance(5_000)
  await callTool({ tool: TOOL, tool_use_id: 'p', next: true })
  await clock.advance(5_000)
  await callTool({ tool: 'Bash', tool_use_id: 'b1', command: 'mvn verify' })
  await clock.settle()
  const rowsAt = async (cols: number) => {
    const v = await $.ui.mount(pane('terminal', cols))
    const el = (await v.find({ key: 'plan-now' })) as unknown as { props: { height: number } }
    const h = el.props.height
    await v.unmount()
    return h
  }
  expect(await rowsAt(100), 'wide: one row').toBe(1)
  expect(await rowsAt(50), 'narrow: still one row, cut at its end').toBe(1)
})

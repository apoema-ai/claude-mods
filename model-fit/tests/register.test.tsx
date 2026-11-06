import { expect, mock, test } from 'claude-code/testing'

/** The `on` a test body is handed. */
type On = Parameters<NonNullable<Parameters<typeof test>[2]>>[1]

type Reply = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

const opus = 'claude-opus-5-5'
const sonnet = 'claude-sonnet-5-5'
const say = (model: string, effort: string, reason = 'mechanical edits') => ({ isAnswered: true as const, text: JSON.stringify({ model, effort, reason }) })

/** Mocks every $ call the mod makes; `cfg` and `st` are what a test changes mid-run. */
function rig(on: On, init: { model?: string; cfg?: Record<string, unknown>; replies?: Reply[]; tokens?: number; stubborn?: boolean; lag?: number } = {}) {
  const st = { model: init.model ?? opus, tokens: init.tokens ?? 5000 }
  const cfg: Record<string, unknown> = { trigger: 'prompt', auto: false, guardTokens: 80000, models: 'haiku,sonnet,opus', efforts: 'low,medium,high,xhigh', rubricFile: '', ...init.cfg }
  const replies = [...(init.replies ?? [])]
  const files: Record<string, string> = {}
  const ran: { command: string; args: string }[] = []
  const toasts: string[] = []
  const steps: { model: string; effort?: unknown }[] = []
  const judged: string[] = []
  const submitted: string[] = []
  // `lag`: the switch shows only after that many reads, as on the queued path live.
  let lagLeft = 0
  let lagTo = ''

  on('session.start', async (_, e) => ({ cwd: e.cwd }) as never)
  on('env.get', async () => ({ value: '/Users/test' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('command.list', async () => ({ value: [{ name: 'model', source: 'builtin' }, { name: 'effort', source: 'builtin' }, { name: 'superpowers:executing-plans', source: 'plugin' }] }) as never)
  on('command.run', async (_, e) => {
    const { command, args } = e as unknown as { command: string; args: string }
    ran.push({ command, args })
    const to = args === 'sonnet' ? sonnet : args === 'opus' ? opus : args
    if (command === 'model' && !init.stubborn) {
      if (init.lag) [lagTo, lagLeft] = [to, init.lag]
      else st.model = to
    }
    return { text: '' } as never
  })
  on('session.model', async () => {
    if (lagTo && lagLeft-- <= 0) [st.model, lagTo] = [lagTo, '']
    return { value: st.model } as never
  })
  on('session.turns', async () => ({ value: 3 }) as never)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: st.tokens }, rateLimits: [] } }) as never)
  on('model.complete', async (_, e) => {
    judged.push((e as unknown as { prompt: string }).prompt)
    return { value: replies.shift() ?? { isAnswered: false, reason: 'api-error' } } as never
  })
  on('prompt.submit', async (_, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('turn.step', async function* (_, e) {
    steps.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('ui.toast', async (_, e) => {
    toasts.push((e as unknown as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return (<Box />) as never
  })
  // The settings file stands for `cfg`: a read gives it, a write updates it.
  const isCfg = (path: string) => path.endsWith('/.claude/mods/model-fit.json')
  on('fs.exists', async (_, e) => ({ value: isCfg((e as unknown as { path: string }).path) || (e as unknown as { path: string }).path in files }) as never)
  on('fs.read', async (_, e) => {
    const { path } = e as unknown as { path: string }
    return { value: isCfg(path) ? JSON.stringify(cfg) : (files[path] ?? '') } as never
  })
  on('fs.write', async (_, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    if (isCfg(path)) Object.assign(cfg, JSON.parse(text))
    else files[path] = text
    return { value: undefined } as never
  })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  const clock = mock.clock(on, { now: 1_000_000 })
  return { st, cfg, files, ran, toasts, steps, judged, submitted, clock, replies }
}

const start = ($: { session: { start: (i: never) => Promise<unknown> } }) => $.session.start({ source: 'startup', cwd: '/Users/test/x', surface: 'desktop', isInteractive: true } as never)
const stepOf = (model: string, effort = 'high') => ({ turnId: 't1', index: 0, model, effort, messageCount: 1 }) as never
const band = async ($: { ui: { mount: (i: never) => Promise<{ findAll: (q: object) => Promise<{ text?: string }[]> }> } }) => {
  const v = await $.ui.mount({ plugin: 'model-fit', surface: 'desktop', component: 'AbovePrompt', props: { isWorking: false, hasSurvey: false, maxRows: 20, bodyColumns: 80, scroll: {}, view: {} } } as never)
  return (await v.findAll({ type: 'Text' })).map(t => t.text).join(' ')
}
const logText = (files: Record<string, string>) => Object.entries(files).filter(([k]) => k.endsWith('model-fit.log')).map(([, v]) => v).join('')

test('an upgrade shows the band at once, with the reason', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, { model: sonnet, replies: [say('opus', 'high', 'design across several files')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const says = await band($ as never)
  expect(says, 'the offer').toContain('sonnet')
  expect(says).toMatch(/opus\s*\|\s*high/)
  expect(says, 'the reason').toContain('design across several files')
  expect(says, 'a stronger pick is marked').toContain('▲ stronger')
})

test('/model-fit off writes the shared switch and stops every look, on removes it', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, files, judged } = rig(on, { model: sonnet, replies: [say('opus', 'high', 'design across several files'), say('opus', 'high', 'design across several files')] })
  const switches = '/Users/test/.claude/mods/switches.json'
  files[switches] = '{ "other": false }'
  await start($ as never)
  expect(((await $.command.run({ command: 'model-fit', args: '' } as never)) as { text: string }).text).toContain('Model Fit is on. Type /model-fit off to turn it off.')

  const off = (await $.command.run({ command: 'model-fit', args: 'off' } as never)) as { text: string }
  expect(off.text).toMatch(/off in every chat/)
  expect(JSON.parse(files[switches] ?? '{}')).toEqual({ other: false, 'model-fit': false })
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  expect(judged, 'off: no Judge call').toHaveLength(0)
  expect(await band($ as never), 'off: no offer').not.toContain('opus')
  expect(((await $.command.run({ command: 'model-fit', args: '' } as never)) as { text: string }).text).toContain('Model Fit is off in every chat')

  const back = (await $.command.run({ command: 'model-fit', args: 'on' } as never)) as { text: string }
  expect(back.text).toBe('Model Fit is on.')
  expect(JSON.parse(files[switches] ?? '{}')).toEqual({ other: false })
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  expect(judged, 'on again: judged').toHaveLength(1)
  expect(await band($ as never)).toMatch(/opus\s*\|\s*high/)
})

test('the reason wraps instead of being cut, and a cheaper pick is marked', { timeoutMs: 30000 }, async ($, on) => {
  const long = 'the work is mechanical edits across a handful of files with no design decisions and no ambiguity left to resolve'
  const { clock } = rig(on, { replies: [say('sonnet', 'medium', long), say('sonnet', 'medium', long)] })
  await start($ as never)
  await $.prompt.submit({ text: 'rename a variable' } as never)
  await $.prompt.submit({ text: 'rename another' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'model-fit', surface: 'desktop', component: 'AbovePrompt', props: { isWorking: false, hasSurvey: false, maxRows: 20, bodyColumns: 80, scroll: {}, view: {} } } as never)
  const why = (await v.find({ type: 'Text', text: /mechanical edits/ })) as { props: { wrap?: string }; text?: string } | undefined
  expect(why?.props.wrap, 'wraps').toBe('wrap')
  expect(why?.text, 'whole reason, no cut').toContain('no ambiguity left to resolve')
  expect(await band($ as never)).toContain('▼ cheaper')
})

test('the card warns that a model change drops the prompt cache, with the context size', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, { model: sonnet, tokens: 42_000, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const says = await band($ as never)
  expect(says, 'the warning').toContain('drops the prompt cache')
  expect(says, 'the size').toContain('about 42k tokens')
})

test('a downgrade shows only after two prompts that agree', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, { replies: [say('sonnet', 'medium'), say('sonnet', 'medium')] })
  await start($ as never)
  await $.prompt.submit({ text: 'rename a variable' } as never)
  await clock.settle()
  expect(await band($ as never), 'first one waits').not.toContain('Model Fit')
  await $.prompt.submit({ text: 'rename another variable' } as never)
  await clock.settle()
  expect(await band($ as never), 'second one shows').toContain('Model Fit')
})

test('the cache guard keeps the model above the limit', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, { tokens: 150_000, replies: [say('sonnet', 'low'), say('sonnet', 'low')] })
  await start($ as never)
  // The effort is known only from a request, so one goes out first.
  for await (const _c of $.turn.step(stepOf(opus, 'high'))) void _c
  await $.prompt.submit({ text: 'rename a variable' } as never)
  await clock.settle()
  await $.prompt.submit({ text: 'rename another' } as never)
  await clock.settle()
  const says = await band($ as never)
  expect(says, 'effort falls').toMatch(/opus\s*\|\s*low/)
  expect(says, 'model kept').toContain('model kept')
})

test('the Switch button runs /model and /effort', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ran } = rig(on, { model: sonnet, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'model-fit', surface: 'desktop', component: 'AbovePrompt', props: { isWorking: false, hasSurvey: false, maxRows: 20, bodyColumns: 80, scroll: {}, view: {} } } as never)
  await v.press({ key: 'fit-switch' })
  await clock.settle()
  expect(ran).toEqual([{ command: 'model', args: 'opus' }, { command: 'effort', args: 'high' }])
  expect(await band($ as never), 'the band goes away').not.toContain('Model Fit')
})

test('Auto sends this turn on the recommendation, then runs /model after it', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ran, steps } = rig(on, { model: sonnet, cfg: { auto: true }, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  for await (const _c of $.turn.step(stepOf(sonnet, 'medium'))) void _c
  expect(steps[0]?.model, 'this turn goes out on opus').toBe('opus')
  expect(steps[0]?.effort).toBe('high')
  expect(ran, 'nothing is run inside the turn').toEqual([])
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done' } as never)
  await clock.settle()
  expect(ran[0], '/model follows the turn').toEqual({ command: 'model', args: 'opus' })
  expect(await band($ as never), 'the band says what changed').toMatch(/opus\s*\|\s*high/)
})

test('a Setting the person changed pauses Auto', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, st, steps, toasts } = rig(on, { cfg: { auto: true }, replies: [say('sonnet', 'medium'), say('sonnet', 'medium'), say('sonnet', 'medium')] })
  await start($ as never)
  for await (const _c of $.turn.step(stepOf(opus))) void _c
  st.model = sonnet
  await $.prompt.submit({ text: 'rename a variable' } as never)
  await clock.settle()
  expect(toasts.some(t => t.includes('paused')), 'a toast says Auto paused').toBe(true)
  for await (const _c of $.turn.step(stepOf(sonnet))) void _c
  expect(steps.at(-1)?.model, 'requests are left alone').toBe(sonnet)
})

test('a failed Judge shows nothing, changes nothing and logs one line', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ran, files } = rig(on, { cfg: { auto: true }, replies: [{ isAnswered: false, reason: 'api-error' }] })
  await start($ as never)
  await $.prompt.submit({ text: 'design it' } as never)
  await clock.settle()
  expect(await band($ as never), 'nothing is offered').not.toContain('→')
  expect(ran).toEqual([])
  expect(logText(files)).toContain('judge: api-error')
})

test('an unreadable Judge answer shows nothing', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, files } = rig(on, { replies: [{ isAnswered: true, text: 'I think sonnet.' }] })
  await start($ as never)
  await $.prompt.submit({ text: 'design it' } as never)
  await clock.settle()
  expect(await band($ as never)).not.toContain('Model Fit')
  expect(logText(files)).toContain('unreadable reply')
})

test('trigger off makes no Judge call; skill ignores a plain prompt', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, judged, cfg } = rig(on, { cfg: { trigger: 'off' }, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design it' } as never)
  cfg.trigger = 'skill'
  await $.prompt.submit({ text: 'design it again' } as never)
  await clock.settle()
  expect(judged).toEqual([])
})

test('a skill in the table is mapped with no Judge call and effort untouched', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, judged } = rig(on, { cfg: { trigger: 'skill' } })
  await start($ as never)
  await $.prompt.submit({ text: '/superpowers:executing-plans', command: { name: 'superpowers:executing-plans', args: '' } } as never)
  await clock.settle()
  expect(judged, 'no Judge call').toEqual([])
  const says = await band($ as never)
  expect(says, 'sonnet is offered').toMatch(/→\s*sonnet/)
  expect(says, 'effort is not part of it: the one in use, unknown here, shows on both sides').toMatch(/sonnet\s*\|\s*—/)
})

test('the Skill tool starts a look in the middle of a turn', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, { cfg: { trigger: 'skill' } })
  await start($ as never)
  const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await callTool({ tool: 'Skill', tool_use_id: 's1', skill: 'superpowers:executing-plans', args: '' })
  await clock.settle()
  expect(await band($ as never)).toContain('→ sonnet')
})

test('/model-fit sets the trigger and Auto, and shows the status', { timeoutMs: 30000 }, async ($, on) => {
  const { cfg } = rig(on)
  await start($ as never)
  const run = $.command.run as unknown as (input: { command: string; args?: string }) => Promise<{ text: string }>
  expect((await run({ command: 'model-fit', args: 'trigger skill' })).text).toContain('skill')
  expect(cfg.trigger).toBe('skill')
  await run({ command: 'model-fit', args: 'auto on' })
  expect(cfg.auto).toBe(true)
  const status = (await run({ command: 'model-fit' })).text
  expect(status).toContain('Trigger: skill')
  expect(status).toContain('Auto: on')
  expect((await run({ command: 'model-fit', args: 'status' })).text, 'status is no longer a verb: plain /model-fit shows it').toContain('Usage')
  expect((await run({ command: 'model-fit', args: 'nonsense' })).text).toContain('Usage')
  expect((await run({ command: 'model-fit', args: 'skill' })).text, 'a bare trigger word is not a trigger').toContain('Usage')
  expect((await run({ command: 'model-fit', args: 'trigger off' })).text).toContain('trigger off')
  expect(cfg.trigger, 'trigger off is the setting, not the switch').toBe('off')
})

test('when /model answers but the model does not change, the requests carry it and the log says why', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, steps, toasts, files } = rig(on, { model: sonnet, stubborn: true, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const v = await $.ui.mount({ plugin: 'model-fit', surface: 'desktop', component: 'AbovePrompt', props: { isWorking: false, hasSurvey: false, maxRows: 20, bodyColumns: 80, scroll: {}, view: {} } } as never)
  const press = v.press({ key: 'fit-switch' })
  await clock.advance(2000)
  await press
  expect(toasts.some(t => t.includes('opus · high is pending')), 'the toast says pending, not success').toBe(true)
  expect(logText(files)).toContain('left the model at')
  for await (const _c of $.turn.step(stepOf(sonnet, 'medium'))) void _c
  expect(steps.at(-1)?.model, 'the next request goes out on opus').toBe('opus')
})

const mountBand = ($: { ui: { mount: (i: never) => Promise<{ press: (k: { key: string }) => Promise<unknown>; find: (q: object) => Promise<unknown> }> } }, isWorking = false) =>
  $.ui.mount({ plugin: 'model-fit', surface: 'desktop', component: 'AbovePrompt', props: { isWorking, hasSurvey: false, maxRows: 20, bodyColumns: 80, scroll: {}, view: {} } } as never)

test('the card has one action, Switch, and it sends no prompt of its own', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, submitted } = rig(on, { model: sonnet, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const v = await mountBand($ as never)
  expect(await v.find({ type: 'Button', key: 'fit-go' }), 'no Switch and go').toBeUndefined()
  expect(await v.find({ type: 'Button', text: /^Switch to opus · high$/ }), 'the primary names its target').toBeDefined()
  expect(await v.find({ type: 'Button', text: /^Dismiss$/ }), 'the dismiss has a word, not a glyph').toBeDefined()
  await v.press({ key: 'fit-switch' })
  await clock.settle()
  expect(submitted, 'only the person prompt went out').toHaveLength(1)
})

test('a Switch pressed while the agent works is queued, shows Queued, and runs when the turn ends', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ran } = rig(on, { model: sonnet, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  await $.turn.start({ turnId: 't1' } as never)
  const mount = () => $.ui.mount({ plugin: 'model-fit', surface: 'desktop', component: 'AbovePrompt', props: { isWorking: true, hasSurvey: false, maxRows: 20, bodyColumns: 80, scroll: {}, view: {} } } as never)
  const v = await mount()
  await v.press({ key: 'fit-switch' })
  await clock.settle()
  expect(ran, 'nothing runs while the agent works').toEqual([])
  const queuedBand = await mount()
  expect(await queuedBand.find({ text: /Queued/ }), 'the band says Queued').toBeDefined()
  expect(await queuedBand.find({ text: /^Switch$/ }), 'the Switch button is gone').toBeUndefined()
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done' } as never)
  await clock.settle()
  expect(ran[0], 'the switch runs after the turn').toEqual({ command: 'model', args: 'opus' })
  expect(await band($ as never), 'the band goes away').not.toContain('Model Fit')
})

test('with Auto on the band stays up, shows what Auto did, and its Switch button cannot be pressed', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = rig(on, { model: sonnet, cfg: { auto: true }, replies: [say('opus', 'high', 'design across several files')] })
  await start($ as never)
  expect(await band($ as never), 'up before any look, with the Setting').toMatch(/Now\s+sonnet/)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const says = await band($ as never)
  expect(says, 'the switch Auto makes').toMatch(/opus\s*\|\s*high/)
  expect(says, 'said as what Auto does').toContain('Auto switches to opus · high')
  expect(says, 'and why').toContain('design across several files')
  const v = await mountBand($ as never)
  expect(await v.find({ type: 'Button', key: 'fit-switch' }), 'Switch is not a button').toBeUndefined()
  expect(await v.find({ type: 'Text', text: /^Switch$/ }), 'and no fake dim Switch either').toBeUndefined()
  expect(await v.find({ type: 'Button', key: 'fit-trigger' }), 'the trigger stays in reach').toBeDefined()
  expect(await v.find({ type: 'Button', key: 'fit-dismiss' }), 'no ✕ while Auto is on').toBeUndefined()
})

test('the band collapses to one line that keeps the move and Switch, and the toggle expands it again', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, cfg, ran } = rig(on, { model: sonnet, replies: [say('opus', 'high', 'design across several files')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const v = await mountBand($ as never)
  expect(await v.find({ type: 'Button', key: 'fit-collapse' }), 'the toggle is in the header').toBeDefined()
  await v.press({ key: 'fit-collapse' })
  expect(cfg.collapsed, 'the choice is kept in the settings file').toBe(true)
  const says = await band($ as never)
  expect(says, 'the title stays').toContain('Model Fit')
  expect(says, 'the move stays, as model | effort').toMatch(/opus\s*\|\s*high/)
  expect(says, 'the reason is folded away').not.toContain('design across several files')
  const c = await mountBand($ as never)
  expect(await c.find({ type: 'Button', key: 'fit-trigger' }), 'Trigger is folded away').toBeUndefined()
  await c.press({ key: 'fit-collapse' })
  expect(cfg.collapsed, 'the toggle expands it').toBe(false)
  expect(await band($ as never), 'the reason is back').toContain('design across several files')
  const again = await mountBand($ as never)
  await again.press({ key: 'fit-collapse' })
  const folded = await mountBand($ as never)
  await folded.press({ key: 'fit-switch' })
  expect(ran[0], 'Switch still works while collapsed').toEqual({ command: 'model', args: 'opus' })
})

test('a collapsed band with nothing on offer shows the Setting and the Auto state on one line', { timeoutMs: 30000 }, async ($, on) => {
  rig(on, { model: sonnet, cfg: { auto: true, collapsed: true } })
  await start($ as never)
  const says = await band($ as never)
  expect(says, 'the Setting, with a dash before any request has said the effort').toMatch(/sonnet\s*\|\s*—/)
  for await (const _c of $.turn.step(stepOf(sonnet, 'medium'))) void _c
  expect(await band($ as never), 'the model and effort once a request has said it').toMatch(/sonnet\s*\|\s*medium/)
  expect(says, 'the Auto state').toContain('Auto · on')
  expect(says, 'no expanded line').not.toContain('Now:')
})

test('a switch that lands a moment after /model answers is not logged as a failure',{ timeoutMs: 30000 }, async ($, on) => {
  const { clock, toasts, files, ran } = rig(on, { model: sonnet, lag: 2, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  const press = (await mountBand($ as never)).press({ key: 'fit-switch' })
  await clock.advance(2000)
  await press
  expect(logText(files), 'no false failure').not.toContain('left the model at')
  expect(toasts.some(t => t.includes('now opus')), 'the toast says it switched').toBe(true)
  expect(ran.map(r => r.command), '/effort follows').toEqual(['model', 'effort'])
})

test('turning Auto off before its switch runs cancels it and leaves the recommendation as a card', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ran, cfg } = rig(on, { model: sonnet, cfg: { auto: true }, replies: [say('opus', 'high', 'design across several files')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  await clock.settle()
  await $.turn.start({ turnId: 't1' } as never)
  await (await mountBand($ as never, true)).press({ key: 'fit-auto' })
  await clock.settle()
  expect(cfg.auto, 'Auto is off').toBe(false)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done' } as never)
  await clock.settle()
  expect(ran, "Auto's queued switch does not run").toEqual([])
  const v = await mountBand($ as never)
  expect(await band($ as never), 'the recommendation stays').toMatch(/opus\s*\|\s*high/)
  expect(await v.find({ type: 'Button', key: 'fit-switch' }), 'with a Switch to press').toBeDefined()
})

test("a switch that lands after the read-back gave up is not taken for the person's change", { timeoutMs: 30000 }, async ($, on) => {
  const { clock, st, toasts, files } = rig(on, { model: sonnet, stubborn: true, cfg: { auto: true }, replies: [say('opus', 'high')] })
  await start($ as never)
  await $.prompt.submit({ text: 'design the new module' } as never)
  for await (const _c of $.turn.step(stepOf(sonnet, 'medium'))) void _c
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done' } as never)
  await clock.advance(2000)
  // The switch Auto asked for lands only now, after the read-back gave up.
  st.model = opus
  for await (const _c of $.turn.step(stepOf(opus, 'high'))) void _c
  expect(toasts.some(t => t.includes('paused')), 'Auto is not paused by its own switch').toBe(false)
  expect(toasts.some(t => t.includes('now opus')), 'the landing is confirmed').toBe(true)
  expect(logText(files), 'and logged').toContain('/model opus landed late')
  const run = $.command.run as unknown as (input: { command: string; args?: string }) => Promise<{ text: string }>
  expect((await run({ command: 'model-fit' })).text).not.toContain('paused')
})

test('pressing Auto: paused resumes Auto instead of turning it off', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, st, cfg } = rig(on, { cfg: { auto: true }, replies: [say('sonnet', 'medium')] })
  await start($ as never)
  for await (const _c of $.turn.step(stepOf(opus))) void _c
  st.model = sonnet
  await $.prompt.submit({ text: 'rename a variable' } as never)
  await clock.settle()
  const v = await mountBand($ as never)
  expect(await v.find({ type: 'Button', text: /Auto · paused/ }), 'paused first').toBeDefined()
  await v.press({ key: 'fit-auto' })
  await clock.settle()
  expect(cfg.auto, 'Auto stays on').toBe(true)
  const run = $.command.run as unknown as (input: { command: string; args?: string }) => Promise<{ text: string }>
  expect((await run({ command: 'model-fit' })).text, 'and is no longer paused').not.toContain('paused')
})

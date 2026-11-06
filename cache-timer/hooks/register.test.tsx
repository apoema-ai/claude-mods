import { expect, mock, test } from 'claude-code/testing'

import { PALETTES, blockLens, cellColor, firstReplySince, labelColor, rewroteWarm, tierOf } from './register'

type On = Parameters<typeof mock.clock>[0]

const BAND = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({ plugin: 'cache-timer', component: 'AbovePrompt', requestId: 'band', props: { isWorking: false, hasSurvey: false, bodyColumns, maxRows: 20 }, surface }) as never

const TRANSCRIPT = '/home/u/.claude/projects/p1/abc123.jsonl'

// The fake clock starts here, so transcript timestamps can be placed before or after a turn's start.
const T0 = Date.parse('2026-11-05T22:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

// One main-thread (or sidechain) reply line with its cache read and write, recorded at `at`.
const reply = (at: number, read: number, write: number, sidechain = false) =>
  JSON.stringify({ type: 'assistant', isSidechain: sidechain, timestamp: iso(at), message: { usage: { cache_read_input_tokens: read, cache_creation_input_tokens: write } } })

// A transcript whose newest main-thread reply wrote to the cache with `ttl` ('1h' or '5m'), after a sidechain reply that must be ignored.
const transcript = (ttl: string) =>
  ttl === 'unknown' ? JSON.stringify({ type: 'user' }) : [
    JSON.stringify({ type: 'assistant', message: { usage: { cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 } } } }),
    JSON.stringify({ type: 'assistant', message: { usage: { cache_creation: ttl === '1h' ? { ephemeral_1h_input_tokens: 10 } : { ephemeral_5m_input_tokens: 10 } } } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { usage: { cache_creation: { ephemeral_1h_input_tokens: ttl === '1h' ? 0 : 10 } } } }),
    'not json',
  ].join('\n')

// Stands for the engine beneath the mod. `ttl` is the cache length the fake transcript was written with.
function engine(on: On, ttl: string) {
  const clock = mock.clock(on, { now: T0 })
  // `switches` is the text of ~/.claude/mods/switches.json, which a test can change.
  // `size` and `ttl` are the transcript's size and cache length, which a test can change between replies.
  // `extra` is more transcript lines, after the ones `ttl` gives. `fail` makes every ping an API error.
  const seen = { forks: 0, toasts: [] as string[], switches: '', lists: 0, size: 1000, ttl, fail: false, extra: [] as string[] }
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.list', (_, e) => {
    seen.lists += 1
    return { value: e.path === '/home/u/.claude/projects' ? [{ name: 'p1', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] : [] }
  })
  on('fs.stat', (_, e) => {
    if (e.path !== TRANSCRIPT) throw new Error('no such file')
    return { value: { kind: 'file' as const, size: seen.size, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_, e) => {
    if (e.path === TRANSCRIPT) return { value: [transcript(seen.ttl), ...seen.extra].join('\n') }
    if (!e.path.endsWith('/.claude/mods/switches.json')) throw new Error('unexpected read')
    return { value: seen.switches }
  })
  on('fs.write', (_, e) => {
    if (!e.path.endsWith('/.claude/mods/switches.json')) throw new Error('unexpected write')
    seen.switches = e.text
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'abc123' }))
  on('session.usage', () => ({ value: { context: { tokens: 84_000 } } }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PostModelSwitch', () => ({}) as never)
  on('classic.PostCompact', () => ({}) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', () => {
    seen.forks += 1
    if (seen.fail) return { value: { isAnswered: false, reason: 'api-error', error: 'overloaded', status: 529 } } as never
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 84_000, cache_creation_input_tokens: 0 } } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>prompt</Text>
  })
  return { clock, seen }
}

type Found = { type?: string; text?: string; props: { color?: string; source?: string; alt?: string } }
type Mounted = { find: (q: object) => Promise<unknown>; findAll: (q: object) => Promise<unknown[]> }

/** The countdown bar: the gradient picture on desktop, the first filled block on the terminal. */
const barOf = async (ui: unknown, surface: 'terminal' | 'desktop') =>
  ((await (ui as Mounted).find(surface === 'desktop' ? { type: 'Svg' } : { text: /^█$/ })) as Found | undefined)

async function replied($: { session: { start: (i: never) => unknown }; turn: { complete: (i: never) => unknown } }, clock: ReturnType<typeof mock.clock>) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as never)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()
}

test('after a reply the band counts down with the cache length the helper reports, on every surface', async ($, on) => {
  const { clock } = engine(on, '1h')
  await replied($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(BAND(surface))
    expect(await ui.find({ type: 'Text', text: /Cache warm/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 hour cache/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a cache the helper cannot read is a 5 min guess, and goes cold when it runs out', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)

  const warm = await $.ui.mount(BAND('terminal'))
  expect(await warm.find({ type: 'Text', text: /5 min cache \(guess\)/ })).toBeDefined()
  await warm.unmount()

  await clock.advance(6 * 60_000)
  const cold = await $.ui.mount(BAND('terminal'))
  expect(await cold.find({ type: 'Text', text: /Cache cold/ })).toBeDefined()
  expect(await cold.find({ type: 'Text', text: /Cache warm/ })).toBeUndefined()
  await cold.unmount()
})

test('the transcript folder is searched once, not on every reply', async ($, on) => {
  const { clock, seen } = engine(on, '1h')
  await replied($, clock)
  expect(seen.lists, 'one search for the first reply').toBe(1)

  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await $.turn.complete({ turnId: 't3', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()
  expect(seen.lists, 'no new search for later replies').toBe(1)
})

test('a transcript that grows past the size cap keeps the last known cache length', async ($, on) => {
  const { clock, seen } = engine(on, '1h')
  await replied($, clock)

  // The reply wrote a 5 min cache, but the file is now too big to read: the 1 hour answer stands.
  seen.ttl = '5m'
  seen.size = 30_000_000
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()

  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /1 hour cache/ })).toBeDefined()
  await ui.unmount()
})

test('a chat first seen already over the size cap stays a 5 min guess', async ($, on) => {
  const { clock, seen } = engine(on, '1h')
  seen.size = 30_000_000
  await replied($, clock)

  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /5 min cache \(guess\)/ })).toBeDefined()
  await ui.unmount()
})

test('/keepwarm pings once, shortly before the cache goes cold', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)

  const answer = await $.command.run({ command: 'keepwarm', args: '' } as never)
  expect(answer.text).toMatch(/Keep warm is on/)

  // Nothing happens at 3 min; the ping goes out 45 s before the 5 min cache lapses.
  await clock.advance(3 * 60_000)
  expect(seen.forks).toBe(0)
  await clock.advance(80_000)
  expect(seen.forks).toBe(1)

  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /last ping read 84k cached tokens/ })).toBeDefined()
  await ui.unmount()
})

test('/keepwarm says so when there is no reply to keep warm yet', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()

  const answer = await $.command.run({ command: 'keepwarm', args: '' } as never)
  expect(answer.text).toMatch(/Nothing to keep warm yet/)
})

test('a message from the person stops keep warm; /keepwarm off stops it too', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)

  await $.command.run({ command: 'keepwarm', args: '' } as never)
  await $.prompt.submit({ wait: false, origin: { kind: 'composer' }, text: 'hello again' })
  await clock.settle()
  expect(seen.toasts).toContain('Keep warm stopped: you sent a message.')

  await $.command.run({ command: 'keepwarm', args: '' } as never)
  const off = await $.command.run({ command: 'keepwarm', args: 'off' } as never)
  expect(off.text).toMatch(/Keep warm is off/)
  await clock.advance(5 * 60_000)
  expect(seen.forks).toBe(0)
})

test('the shared switches turn the band off and hide it, and a change reaches an open chat', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)

  const bandShown = async () => {
    const ui = await $.ui.mount(BAND('terminal'))
    const shown = (await ui.find({ type: 'Text', text: /Cache warm/ })) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await bandShown()).toBe(true)

  seen.switches = '{ "cache-timer:hidden": true }'
  await clock.advance(3000)
  expect(await bandShown()).toBe(false)

  seen.switches = '{ "cache-timer": false }'
  await clock.advance(3000)
  expect(await bandShown()).toBe(false)

  seen.switches = '{ "other": false }'
  await clock.advance(3000)
  expect(await bandShown()).toBe(true)
})

test('switching the mod off stops keep warm', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)
  await $.command.run({ command: 'keepwarm', args: '' } as never)

  seen.switches = '{ "cache-timer": false }'
  await clock.advance(3000)
  expect(seen.toasts).toContain('Keep warm stopped: Cache Timer was switched off.')

  await clock.advance(5 * 60_000)
  expect(seen.forks).toBe(0)
})

test('/cache-timer off writes the shared switch and stops the band and keep warm, /cache-timer on removes it', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  seen.switches = '{ "other": false }'
  await replied($, clock)
  await $.command.run({ command: 'keepwarm', args: '' } as never)

  const bandShown = async () => {
    const ui = await $.ui.mount(BAND('terminal'))
    const shown = (await ui.find({ type: 'Text', text: /Cache warm/ })) !== undefined
    await ui.unmount()
    return shown
  }
  expect(await bandShown()).toBe(true)

  const status = (await $.command.run({ command: 'cache-timer', args: 'status' } as never)) as { text: string }
  expect(status.text).toMatch(/is on/)

  const off = (await $.command.run({ command: 'cache-timer', args: 'off' } as never)) as { text: string }
  expect(off.text).toMatch(/off in every chat/)
  expect(JSON.parse(seen.switches)).toEqual({ other: false, 'cache-timer': false })
  expect(await bandShown()).toBe(false)
  expect(seen.toasts).toContain('Keep warm stopped: Cache Timer was switched off.')

  const on2 = (await $.command.run({ command: 'cache-timer', args: 'on' } as never)) as { text: string }
  expect(on2.text).toBe('Cache Timer is on.')
  expect(JSON.parse(seen.switches)).toEqual({ other: false })
  expect(await bandShown()).toBe(true)
})

test('/cachetimer hide takes the band away and /cachetimer show brings it back', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)

  await $.command.run({ command: 'cachetimer', args: 'hide' } as never)
  const hidden = await $.ui.mount(BAND('terminal'))
  expect(await hidden.find({ type: 'Text', text: /Cache warm/ })).toBeUndefined()
  await hidden.unmount()

  await $.command.run({ command: 'cachetimer', args: 'show' } as never)
  const shown = await $.ui.mount(BAND('terminal'))
  expect(await shown.find({ type: 'Text', text: /Cache warm/ })).toBeDefined()
  await shown.unmount()
})

test('hiding the band while keep warm runs leaves a chip, and its Stop button stops keep warm', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)
  await $.command.run({ command: 'keepwarm', args: '' } as never)

  const hidden = await $.command.run({ command: 'cachetimer', args: 'hide' } as never)
  expect(hidden.text).toMatch(/Keep warm is still on/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(BAND(surface))
    expect(await ui.find({ type: 'Text', text: /Cache warm/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Keeping cache warm · first ping in/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount(BAND('terminal'))
  await ui.press({ key: 'stop' })
  await ui.unmount()
  expect(seen.toasts).toContain('Keep warm is off.')
  const after = await $.ui.mount(BAND('terminal'))
  expect(await after.find({ type: 'Text', text: /Keeping cache warm/ })).toBeUndefined()
  await after.unmount()

  await clock.advance(5 * 60_000)
  expect(seen.forks).toBe(0)
})

test('the shared hide switch also keeps the keep warm chip', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)
  await $.command.run({ command: 'keepwarm', args: '' } as never)

  seen.switches = '{ "cache-timer:hidden": true }'
  await clock.advance(3000)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /Cache warm/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Keeping cache warm/ })).toBeDefined()
  await ui.unmount()
})

test('on a cold cache /keepwarm explains the write and only /keepwarm now rewarms', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)
  await clock.advance(6 * 60_000)

  const refused = await $.command.run({ command: 'keepwarm', args: '' } as never)
  expect(refused.text).toMatch(/already cold/)
  expect(refused.text).toMatch(/84k tokens/)
  await clock.advance(5000)
  expect(seen.forks, 'no ping without the explicit rewarm').toBe(0)

  const forced = await $.command.run({ command: 'keepwarm', args: 'now' } as never)
  expect(forced.text).toMatch(/Rewarming now/)
  await clock.advance(2000)
  expect(seen.forks).toBe(1)
})

test('the cold band rewarms only on a second press, and the first press wears off', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)
  await clock.advance(6 * 60_000)

  const label = async () => {
    const ui = await $.ui.mount(BAND('terminal'))
    const button = await ui.find({ key: 'rewarm' })
    await ui.unmount()
    return String((button?.props as { label?: string } | undefined)?.label)
  }
  expect(await label()).toBe('Rewarm now')

  const first = await $.ui.mount(BAND('terminal'))
  await first.press({ key: 'rewarm' })
  await first.unmount()
  await clock.advance(2000)
  expect(seen.forks, 'one press does not ping').toBe(0)
  expect(await label()).toMatch(/Confirm: write 84k tokens/)

  // Unconfirmed, it wears off.
  await clock.advance(10_000)
  expect(await label()).toBe('Rewarm now')

  const ui = await $.ui.mount(BAND('terminal'))
  await ui.press({ key: 'rewarm' })
  await ui.press({ key: 'rewarm' })
  await ui.unmount()
  await clock.advance(2000)
  expect(seen.forks).toBe(1)
})

test('failed pings retry, do not count as pings, and three in a row stop keep warm', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  seen.fail = true
  await replied($, clock)
  await $.command.run({ command: 'keepwarm', args: '' } as never)

  await clock.advance(260_000)
  expect(seen.forks, 'first ping, 45 s before the 5 min cache lapses').toBe(1)
  await clock.advance(20_000)
  expect(seen.forks, 'retried after 20 s').toBe(2)

  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /last ping failed \(overloaded 529\), retrying/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ping 2\/30/ })).toBeUndefined()
  await ui.unmount()

  await clock.advance(20_000)
  expect(seen.forks).toBe(3)
  expect(seen.toasts).toContain('Keep warm stopped: 3 pings in a row failed (overloaded 529).')
  await clock.advance(60_000)
  expect(seen.forks).toBe(3)
})

test('a narrow band drops the details and the bar but keeps the countdown and buttons', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    const wide = await $.ui.mount(BAND(surface, 120))
    expect(await wide.find({ type: 'Text', text: /84k cached/ })).toBeDefined()
    expect(await barOf(wide, surface)).toBeDefined()
    await wide.unmount()

    const narrow = await $.ui.mount(BAND(surface, 40))
    expect(await narrow.find({ type: 'Text', text: /Cache warm/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /84k cached/ })).toBeUndefined()
    expect(await barOf(narrow, surface)).toBeUndefined()
    expect(await narrow.find({ key: 'keepwarm' })).toBeDefined()
    expect(await narrow.find({ key: 'hide' })).toBeDefined()
    await narrow.unmount()
  }
})

test('on desktop the bar is three gradient blocks that fill from the left', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)

  const svg = async () => {
    const ui = await $.ui.mount(BAND('desktop'))
    const bar = await barOf(ui, 'desktop')
    await ui.unmount()
    return bar
  }
  const fills = (source: string | undefined) => (String(source).match(/fill="url\(#ct-g\)"/g) ?? []).length
  const tracks = (source: string | undefined) => (String(source).match(/class="k"/g) ?? []).length
  const gradients = (source: string | undefined) => (String(source).match(/<linearGradient/g) ?? []).length

  const full = await svg()
  expect(full?.type).toBe('Svg')
  expect(tracks(full?.props?.source), 'three blocks').toBe(3)
  expect(fills(full?.props?.source), 'all three filled').toBe(3)
  expect(gradients(full?.props?.source), 'one gradient across all three').toBe(1)
  expect(full?.props?.source, 'greens only').toContain('#16a34a')
  expect(full?.props?.source).toContain('#86efac')
  expect(full?.props?.source).not.toContain('#991b1b')
  expect(full?.props?.alt).toMatch(/100% of the cache life left/)

  await clock.advance(150_000) // half left: the first block and half of the second, orange to yellow
  const middle = (await svg())?.props?.source
  expect(fills(middle)).toBe(2)
  expect(middle).toContain('#f97316')
  expect(middle).toContain('#facc15')
  expect(middle).not.toContain('#16a34a')

  await clock.advance(90_000) // one fifth left: part of the first block only, dark red to orange
  const low = await svg()
  expect(tracks(low?.props?.source), 'the blocks stay in view').toBe(3)
  expect(fills(low?.props?.source)).toBe(1)
  expect(low?.props?.source).toContain('#991b1b')
})

test('the palette is the third the countdown is in, one gradient across the blocks still in play', () => {
  expect(PALETTES[0], 'the last third: dark red to orange').toEqual(['#991b1b', '#ef4444', '#f97316'])
  expect(PALETTES[1], 'the middle third: orange to yellow').toEqual(['#f97316', '#f59e0b', '#facc15'])
  expect(PALETTES[2], 'the first third: dark to light green').toEqual(['#16a34a', '#4ade80', '#86efac'])
  expect([tierOf(1), tierOf(0.67), tierOf(0.5), tierOf(1 / 3), tierOf(0.1)]).toEqual([2, 2, 1, 0, 0])

  expect(blockLens(18)).toEqual([6, 6, 6])
  expect(blockLens(8)).toEqual([3, 2, 3])
  expect(blockLens(8).reduce((a, b) => a + b, 0)).toBe(8)

  // First third: the whole bar is one green gradient, no break at the block edges.
  expect(cellColor(18, 0, 1)).toBe('#16a34a')
  expect(cellColor(18, 17, 1)).toBe('#86efac')
  expect(cellColor(18, 5, 1), 'no restart at the edge').not.toBe('#16a34a')
  expect(cellColor(18, 6, 1)).not.toBe('#16a34a')
  // Middle third: one orange-to-yellow gradient over the first two blocks.
  expect(cellColor(18, 0, 0.5)).toBe('#f97316')
  expect(cellColor(18, 11, 0.5)).toBe('#facc15')
  expect(cellColor(18, 6, 0.5), 'no restart at the edge').not.toBe('#f97316')
  // Last third: dark red to orange in the first block.
  expect(cellColor(18, 0, 0.2)).toBe('#991b1b')
  expect(cellColor(18, 5, 0.2)).toBe('#f97316')

  expect(labelColor(1)).toBe('#16a34a')
  expect(labelColor(0.5)).toBe('#ea580c')
  expect(labelColor(0.2)).toBe('#991b1b')
})

test('the terminal bar drains from the right in the palette of the third it is in, one gradient across the blocks in play', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)

  // 5 min cache at 120 columns: a 20-cell bar, 18 cells of it in three blocks of 6 with a blank between them.
  const room = 18
  const cells = async () => {
    const ui = await $.ui.mount(BAND('terminal'))
    const blocks = (await (ui as unknown as Mounted).findAll({ text: /^█$/ })) as Found[]
    const empty = await ui.find({ text: /^░+$/ })
    const label = (await ui.find({ type: 'Text', text: /^◷ Cache warm\s*$/ })) as Found | undefined
    await ui.unmount()
    return { colors: blocks.map(b => b.props.color), empty: empty !== undefined, label: label?.props.color }
  }
  const placeColors = (n: number, share: number) => Array.from({ length: n }, (_, k) => cellColor(room, k, share))

  const full = await cells()
  expect(full.colors, 'full: every cell, one green gradient').toEqual(placeColors(18, 1))
  expect(full.colors[0], 'dark green on the far left').toBe('#16a34a')
  expect(full.colors[17], 'light green on the far right').toBe('#86efac')
  expect(full.empty, 'a full bar has no empty cells').toBe(false)
  expect(full.label).toBe('#16a34a')

  await clock.advance(150_000) // half left: the first block and half the second, one orange-to-yellow gradient; the third is empty
  const middle = await cells()
  expect(middle.colors).toEqual(placeColors(9, 0.5))
  expect(middle.colors[0]).toBe('#f97316')
  expect(middle.empty).toBe(true)
  expect(middle.label).toBe('#ea580c')

  await clock.advance(90_000) // one fifth left: part of the first block, dark red to orange
  const low = await cells()
  expect(low.colors).toEqual(placeColors(4, 0.2))
  expect(low.colors[0]).toBe('#991b1b')
  expect(low.label).toBe('#991b1b')
})

// What Claude Code sends after a model switch; a test changes only what it is about.
const SWITCH = (over: Record<string, unknown> = {}) =>
  ({ from_model: 'claude-sonnet-5-5', to_model: 'claude-opus-5-5', requested_model: 'opus', source: 'command', context_tokens: 150_000, prompt_cache_warm: true, cache_ttl: '5m', estimated_cache_write_usd: 1, pricing: 'catalog', ...over }) as never

const says = async ($: { ui: { mount: (i: never) => Promise<Mounted & { unmount: () => Promise<void> }> } }, re: RegExp) => {
  const ui = await $.ui.mount(BAND('terminal'))
  const hit = (await ui.find({ type: 'Text', text: re })) !== undefined
  await ui.unmount()
  return hit
}

test('a model switch while the cache is warm replaces the countdown with a reset line until the next reply', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)
  expect(await says($, /Cache warm/)).toBe(true)

  await $.classic.PostModelSwitch(SWITCH())
  await clock.settle()
  expect(await says($, /Cache reset by switching to opus-5-5/)).toBe(true)
  expect(await says($, /your next message writes 150k tokens to it again/)).toBe(true)
  expect(await says($, /Cache warm/), 'no countdown that promises a discount').toBe(false)

  // The reset line has Hide and nothing that pings.
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  expect(await ui.find({ key: 'keepwarm' })).toBeUndefined()
  await ui.unmount()

  // A narrow band keeps the fact and drops the cost.
  const narrow = await $.ui.mount(BAND('terminal', 60))
  expect(await narrow.find({ type: 'Text', text: /Cache reset by switching to opus-5-5/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /your next message writes/ })).toBeUndefined()
  await narrow.unmount()

  // The next reply writes the cache afresh: the countdown is back.
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()
  expect(await says($, /Cache warm/)).toBe(true)
  expect(await says($, /Cache reset/)).toBe(false)
})

test('a model switch that cannot have cost anything leaves the countdown alone', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)

  await $.classic.PostModelSwitch(SWITCH({ source: 'resume' }))
  await $.classic.PostModelSwitch(SWITCH({ prompt_cache_warm: false }))
  await $.classic.PostModelSwitch(SWITCH({ to_model: 'claude-sonnet-5-5' }))
  await clock.settle()
  expect(await says($, /Cache reset/)).toBe(false)
  expect(await says($, /Cache warm/)).toBe(true)
})

test('a compaction of the main chat resets the band, a subagent compaction does not', async ($, on) => {
  const { clock } = engine(on, 'unknown')
  await replied($, clock)

  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary', agent_id: 'sub1' } as never)
  await clock.settle()
  expect(await says($, /Cache reset/), 'a subagent compacting is not the main chat').toBe(false)

  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' } as never)
  await clock.settle()
  expect(await says($, /Cache reset by auto-compaction/)).toBe(true)
  expect(await says($, /writes the shorter conversation to it again/)).toBe(true)
})

test('a reset stops keep warm, and a rewarm after it is explicit', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)
  await $.command.run({ command: 'keepwarm', args: '' } as never)

  await $.classic.PostModelSwitch(SWITCH())
  await clock.settle()
  expect(seen.toasts).toContain('Keep warm stopped: the cache was reset by switching to opus-5-5.')
  await clock.advance(5 * 60_000)
  expect(seen.forks, 'no ping on the old schedule: it would write the whole chat unasked').toBe(0)

  // Reset again so the line is up, then ask for keep warm.
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()
  await $.classic.PostModelSwitch(SWITCH())
  await clock.settle()
  const refused = await $.command.run({ command: 'keepwarm', args: '' } as never)
  expect(refused.text).toMatch(/already cold/)
  await clock.advance(5000)
  expect(seen.forks).toBe(0)

  const forced = await $.command.run({ command: 'keepwarm', args: 'now' } as never)
  expect(forced.text).toMatch(/Rewarming now/)
  await clock.advance(2000)
  expect(seen.forks, 'the rewarm pings at once').toBe(1)
  expect(await says($, /Cache reset/), 'and clears the reset line').toBe(false)
})

test('the Hide button says how to bring the band back', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)

  const ui = await $.ui.mount(BAND('terminal'))
  await ui.press({ key: 'hide' })
  await ui.unmount()
  expect(seen.toasts).toContain('Cache Timer hidden. Type /cachetimer to show it again.')
})

test('a background turn does not stop keep warm', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)
  await $.command.run({ command: 'keepwarm', args: '' } as never)

  await $.prompt.submit({ wait: false, origin: { kind: 'task-notification' }, text: 'a task finished' } as never)
  await clock.settle()
  expect(seen.toasts).not.toContain('Keep warm stopped: you sent a message.')

  await clock.advance(260_000)
  expect(seen.forks).toBe(1)
})

// Figures from a real chat: the first request after a model switch, and the next ordinary one.
const WARM = { lastEnd: 0, ttlMs: 60 * 60_000, known: true, tokens: 152_000, now: 0 }

test('a first request that wrote what it should have read counts as a reset; ordinary, cold and big-file turns do not', () => {
  expect(rewroteWarm(WARM, 60_000, { read: 51_115, write: 103_868 }), 'after a model switch').toBe(103_868)
  expect(rewroteWarm(WARM, 60_000, { read: 154_983, write: 689 }), 'an ordinary turn').toBe(0)
  expect(rewroteWarm(WARM, 60_000, { read: 150_000, write: 40_000 }), 'a big file read on a warm cache').toBe(0)
  expect(rewroteWarm(WARM, 2 * 60 * 60_000, { read: 51_115, write: 103_868 }), 'the cache had lapsed: the cold band said so').toBe(0)
  expect(rewroteWarm(WARM, 60_000, { read: 0, write: 5000 }), 'too small to matter').toBe(0)
  expect(rewroteWarm(null, 60_000, { read: 0, write: 90_000 }), 'no reply before it').toBe(0)
  expect(rewroteWarm(WARM, 0, { read: 0, write: 90_000 }), 'no turn start seen').toBe(0)
})

test('the first main-thread reply since the turn began is the one read, not a sidechain or an older one', () => {
  const text = [reply(T0 - 5000, 1, 2), 'not json', reply(T0 + 1000, 10, 20, true), reply(T0 + 2000, 30, 40), reply(T0 + 3000, 50, 60)].join('\n')
  expect(firstReplySince(text, T0)).toEqual({ read: 30, write: 40 })
  expect(firstReplySince(text, T0 + 10_000)).toBeNull()
})

test('a turn that found the cache reset says what it rewrote, without the hooks, until the next reply', async ($, on) => {
  const { clock, seen } = engine(on, '1h')
  await replied($, clock)

  await clock.advance(60_000)
  await $.turn.start({ text: 'hi', turnId: 't2' } as never)
  seen.extra = [reply(T0 + 61_000, 20_000, 90_000), reply(T0 + 70_000, 110_000, 800)]
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()
  expect(await says($, /cache had been reset .* so that reply wrote 90k tokens to it again/)).toBe(true)
  expect(await says($, /Cache warm/), 'the countdown carries on').toBe(true)

  const narrow = await $.ui.mount(BAND('terminal', 70))
  expect(await narrow.find({ type: 'Text', text: /Cache was reset · that reply rewrote 90k/ })).toBeDefined()
  await narrow.unmount()

  await clock.advance(60_000)
  await $.turn.start({ text: 'more', turnId: 't3' } as never)
  seen.extra.push(reply(T0 + 122_000, 110_000, 900))
  await $.turn.complete({ turnId: 't3', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()
  expect(await says($, /cache had been reset/), 'gone after an ordinary reply').toBe(false)
})

test('a rewrite after the cache went cold is the cold band\'s news, not a reset', async ($, on) => {
  const { clock, seen } = engine(on, 'unknown')
  await replied($, clock)

  await clock.advance(6 * 60_000)
  await $.turn.start({ text: 'back', turnId: 't2' } as never)
  seen.extra = [reply(T0 + 6 * 60_000 + 1000, 20_000, 90_000)]
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, usage: null } as never)
  await clock.settle()
  expect(await says($, /cache had been reset/)).toBe(false)
})

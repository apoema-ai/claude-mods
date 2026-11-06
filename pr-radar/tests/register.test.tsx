import { expect, mock, test } from 'claude-code/testing'

/** The `on` a test body is handed. */
type On = Parameters<NonNullable<Parameters<typeof test>[2]>>[1]

const pr = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  isDraft: false,
  reviewDecision: null,
  updatedAt: '2026-11-05T10:00:00Z',
  repository: { nameWithOwner: 'o/r' },
  author: { login: 'zedupgrade' },
  reviewRequests: { nodes: [] },
  latestReviews: { nodes: [] },
  commits: { nodes: [] },
  ...extra,
})

/** Answers `gh`: the login, then a list per search. `fail` makes every graphql call exit 1. */
function rig(on: On, opts: { fail?: boolean } = {}) {
  const calls: string[][] = []
  const clock = mock.clock(on)
  on('session.start', async (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['engine'] }) as never)
  on('process.run', async (_, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    calls.push(argv)
    if (argv[2] === 'user') return { value: { exitCode: 0, stdout: 'me\n', stderr: '' } } as never
    if (opts.fail) return { value: { exitCode: 1, stdout: '', stderr: 'HTTP 401' } } as never
    const q = argv[argv.length - 1] ?? ''
    const nodes = q.includes('author:me') && !q.includes('-author')
      ? [pr(1, { reviewDecision: 'APPROVED', latestReviews: { nodes: [{ state: 'APPROVED', submittedAt: '', author: { login: 'anaupgrade', __typename: 'User' } }] } }), pr(2)]
      : q.includes('review-requested')
        ? [pr(3)]
        : []
    return { value: { exitCode: 0, stdout: JSON.stringify({ data: { search: { nodes } } }), stderr: '' } } as never
  })
  return { calls, clock }
}

const graphql = (calls: string[][]) => calls.filter(a => a[2] === 'graphql').length
const viewport = { columns: 120, rows: 40, isFullscreen: true }

test('session start fetches once, and /pr-radar text prints both lists', async ($, on) => {
  const { calls, clock } = rig(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()
  const answer = (await $.command.run({ command: 'pr-radar', args: 'text' } as never)) as { text: string }
  expect(answer.text).toContain('Approved (1)')
  expect(answer.text).toContain('r #1 PR 1')
  expect(answer.text).toContain('r #3 PR 3 by zed')
  expect(graphql(calls)).toBe(3)
})

test('the timer refreshes again after the interval', async ($, on) => {
  const { calls, clock } = rig(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()
  await clock.advance(5 * 60_000)
  expect(graphql(calls)).toBe(6)
})

test('Manual stops the timer refreshes, Auto brings them back', async ($, on) => {
  const { calls, clock } = rig(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()
  const answer = (await $.command.run({ command: 'pr-radar', args: 'manual' } as never)) as { text: string }
  expect(answer.text).toContain('Manual')
  await clock.advance(5 * 60_000)
  expect(graphql(calls)).toBe(3)
  await $.command.run({ command: 'pr-radar', args: 'refresh' } as never)
  expect(graphql(calls)).toBe(6)
  await $.command.run({ command: 'pr-radar', args: 'auto' } as never)
  await clock.advance(5 * 60_000)
  expect(graphql(calls)).toBe(9)
})

test('a failing gh keeps the report and shows the reason', async ($, on) => {
  rig(on, { fail: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const answer = (await $.command.run({ command: 'pr-radar', args: 'refresh' } as never)) as { text: string }
  const text = (await $.command.run({ command: 'pr-radar', args: 'text' } as never)) as { text: string }
  expect(answer.text).toBe('PR Radar: refreshed.')
  expect(text.text).toContain('last refresh failed: HTTP 401')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band shows the counts that matter and Refresh fetches again on ${surface}`, async ($, on) => {
    const { calls, clock } = rig(on)
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-radar', component: 'AbovePrompt', requestId: 'band', surface, viewport, props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 116, scroll: { offset: 0, bodyRows: 8 }, view: 'band' } as never })
    expect(await ui.find({ type: 'Text', text: '2 open' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 approved' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 awaiting' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 to review' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '0 changes' })).toBeUndefined()
    // Desktop draws the label, so the short text must be the label.
    expect(((await ui.find({ key: 'radar-hide' }))?.props as { label?: string } | undefined)?.label).toBe('✕')
    expect(((await ui.find({ key: 'radar-refresh' }))?.props as { label?: string } | undefined)?.label).toMatch(/^↻ /)
    // Hotkey badges only where they cost nothing: the terminal.
    expect(((await ui.find({ key: 'radar-open' }))?.props as { hotkey?: string } | undefined)?.hotkey).toBe(surface === 'terminal' ? 'o' : undefined)
    await ui.press({ key: 'radar-refresh' })
    await clock.settle()
    expect(graphql(calls)).toBe(6)
    await ui.unmount()
  })

  test(`the pane opens on the review tab when something waits on me, and switches tabs on ${surface}`, async ($, on) => {
    const { clock } = rig(on)
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-radar', component: 'Pane', requestId: 'pr-radar', surface, viewport, props: { title: 'PR Radar', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: 'pane' } as never })
    expect(await ui.find({ type: 'Text', text: '● Needs your review' })).toBeDefined()
    await ui.press({ key: 'radar-tab-mine' })
    expect(await ui.find({ type: 'Text', text: '● Approved' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● Awaiting first review' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ana ✓' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'no reviews yet' })).toBeDefined()
    await ui.unmount()
  })

  test(`the mode button flips between Auto and Manual on ${surface}`, async ($, on) => {
    const { calls, clock } = rig(on)
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-radar', component: 'AbovePrompt', requestId: 'band', surface, viewport, props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 116, scroll: { offset: 0, bodyRows: 8 }, view: 'band' } as never })
    const label = async () => ((await ui.find({ key: 'radar-mode' }))?.props as { label?: string } | undefined)?.label
    expect(await label()).toBe('Auto')
    await ui.press({ key: 'radar-mode' })
    expect(await label()).toBe('Manual')
    await clock.advance(5 * 60_000)
    expect(graphql(calls)).toBe(3)
    await ui.press({ key: 'radar-mode' })
    expect(await label()).toBe('Auto')
    await ui.unmount()
  })

  test(`the pane has the same mode button on ${surface}`, async ($, on) => {
    const { calls, clock } = rig(on)
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-radar', component: 'Pane', requestId: 'pr-radar', surface, viewport, props: { title: 'PR Radar', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: 'pane' } as never })
    const label = async () => ((await ui.find({ key: 'radar-mode' }))?.props as { label?: string } | undefined)?.label
    expect(await label()).toBe('Auto · 5m')
    await ui.press({ key: 'radar-mode' })
    expect(await label()).toBe('Manual')
    await clock.advance(5 * 60_000)
    expect(graphql(calls)).toBe(3)
    await ui.unmount()
  })

  test(`Hide takes the bar away and /pr-radar show brings it back on ${surface}`, async ($, on) => {
    const { clock } = rig(on)
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-radar', component: 'AbovePrompt', requestId: 'band', surface, viewport, props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 116, scroll: { offset: 0, bodyRows: 8 }, view: 'band' } as never })
    await ui.press({ key: 'radar-hide' })
    expect(await ui.find({ type: 'Text', text: '2 open' })).toBeUndefined()
    await $.command.run({ command: 'pr-radar', args: 'show' } as never)
    expect(await ui.find({ type: 'Text', text: '2 open' })).toBeDefined()
    await ui.unmount()
  })

  test(`the sort buttons pick a field, and pressing it again flips the direction on ${surface}`, async ($, on) => {
    const { clock } = rig(on)
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-radar', component: 'Pane', requestId: 'pr-radar', surface, viewport, props: { title: 'PR Radar', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: 'pane' } as never })
    const props = async (key: string) => (await ui.find({ key }))?.props as { variant?: string; label?: string } | undefined
    expect((await props('radar-sort-repo'))?.variant).toBe('primary')
    expect((await props('radar-sort-dir'))?.label).toBe('↑ Asc')
    await ui.press({ key: 'radar-sort-number' })
    expect((await props('radar-sort-number'))?.variant).toBe('primary')
    expect((await props('radar-sort-repo'))?.variant).toBe('secondary')
    await ui.press({ key: 'radar-sort-number' })
    expect((await props('radar-sort-dir'))?.label).toBe('↓ Desc')
    await ui.press({ key: 'radar-sort-dir' })
    expect((await props('radar-sort-dir'))?.label).toBe('↑ Asc')
    await ui.unmount()
  })
}

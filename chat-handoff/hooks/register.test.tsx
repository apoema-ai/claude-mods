import { expect, mock, test } from 'claude-code/testing'

type On = Parameters<typeof mock.clock>[0]

const HANDOFF = '# Handoff: Build the refresh mod\n\nContinue work in `~/vault`. Goal: finish it.\n\n## Next steps\n1. Test it.'
const HOME = '/Users/test'
const BAND = (surface: 'terminal' | 'desktop') => ({ plugin: 'chat-handoff', surface, component: 'AbovePrompt', props: { isWorking: false, hasSurvey: false } }) as never

// Stands for the engine and the disk beneath the mod. Tests change `w` to move the world.
const SECRETS = [
  'sk-abcdefghijklmnopqrstuvwxyz',
  'AKIAABCDEFGHIJKLMNOP',
  'github_pat_11ABCDEFG0123456789abcdefghij',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
]
const USAGE = { input_tokens: 12, output_tokens: 1400, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 900 }

function world(on: On, fork: unknown = { isAnswered: true, text: `${HANDOFF}\nkeys ${SECRETS.join(' ')}`, usage: USAGE }) {
  const w = {
    tokens: 120_000,
    files: {} as Record<string, string>,
    store: {} as Record<string, unknown>,
    runs: [] as { argv: readonly string[]; stdin?: string }[],
    switches: '',
    forkPrompt: '',
    request: false,
    copyOk: true,
    copied: '',
    toasts: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
  }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__chat-handoff__refresh' } }) as never)
  on('session.id', () => ({ value: 'sid' }) as never)
  on('session.cwd', () => ({ value: `${HOME}/vault` }) as never)
  on('session.usage', () => ({ value: { context: { tokens: w.tokens, window: 1_000_000 } } }) as never)
  on('session.messages', () =>
    ({
      value: [
        { role: 'user', text: 'Build a refresh mod', toolUses: [] },
        {
          role: 'assistant',
          text: 'Published https://claude.ai/artifact/abc',
          toolUses: [
            { tool_use_id: 't1', tool: 'Read', input: { file_path: `${HOME}/vault/a.md` } },
            { tool_use_id: 't2', tool: 'Skill', input: { skill: 'plugin-authoring' } },
            { tool_use_id: 't3', tool: 'Bash', input: { command: 'cat ~/notes/b.md /tmp/x' } },
          ],
        },
      ],
    }) as never,
  )
  on('model.fork', (_, e) => {
    w.forkPrompt = (e as { prompt: string }).prompt
    return { value: fork } as never
  })
  on('fs.exists', (_, e) => {
    const p = (e as { path: string }).path
    if (p.endsWith('/.claude/mods/switches.json')) return { value: w.switches !== '' } as never
    if (p.endsWith('/.request-sid')) return { value: w.request } as never
    return { value: (p.endsWith('.md') && !p.includes('/tmp/')) || p in w.files } as never
  })
  on('fs.write', (_, e) => {
    const { path, text } = e as { path: string; text: string }
    if (path.endsWith('/.claude/mods/switches.json')) w.switches = text
    w.files[path] = text
    return { value: undefined } as never
  })
  on('fs.read', (_, e) => {
    const p = (e as { path: string }).path
    if (p.endsWith('/.claude/mods/switches.json')) return { value: w.switches } as never
    if (p.endsWith('/pet.json')) return { value: JSON.stringify({ at: clock.now() }) } as never
    if (p.endsWith('.done')) return { value: 'Started a new chat.' } as never
    return { value: w.files[p] ?? '' } as never
  })
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: readonly string[]; init?: { stdin?: string } }
    w.runs.push({ argv, stdin: init?.stdin })
    if (argv[0] === 'rm' && argv.some(a => a.endsWith('/.request-sid'))) w.request = false
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('store.get', (_, e) => ({ value: w.store[(e as { key: string }).key] }) as never)
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    w.store[key] = value
    return { value: undefined } as never
  })
  on('ui.copy', (_, e) => {
    if (!w.copyOk) return { value: { isCopied: false, reason: 'no-clipboard' } } as never
    w.copied = (e as { text: string }).text
    return { value: { isCopied: true } } as never
  })
  on('ui.toast', (_, e) => {
    w.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal' } }) as never)
  on('ui.open', (_, e) => {
    w.opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_, e) => {
    w.closed.push((e as { id: string }).id)
    return { value: undefined } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>REST</Text>
  })
  return { w, clock }
}

const start = ($: { session: { start: (input: never) => unknown } }, surface: 'terminal' | 'desktop') =>
  $.session.start({ source: 'startup', cwd: `${HOME}/vault`, surface, isInteractive: true } as never)

for (const surface of ['desktop', 'terminal'] as const) {
  test(`offer at 250k, steps, then copy, start and close (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { w, clock } = world(on)
    await start($, surface)

    let v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'no offer below 250k').toBeUndefined()

    w.tokens = 262_000
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'offer at 262k').toBeDefined()

    await v.press({ key: 'refresh' })
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'row0' }), 'working: the step rows show').toBeDefined()
    // Partway into step 1, its bar is on screen.
    await clock.advance(100)
    v = await $.ui.mount(BAND(surface))
    expect(await v.find(surface === 'desktop' ? { type: 'Svg' } : { type: 'Text', text: /█|▓/ }), 'working: the running step draws its bar').toBeDefined()
    await clock.advance(10_000)
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'copy' }), 'ready: copy button').toBeDefined()
    expect(await v.find({ key: 'start' }), 'ready: start button').toBeDefined()

    const saved = Object.entries(w.files).find(([k]) => k.includes('/.claude/handoffs/') && k.endsWith('.md') && !k.endsWith('-draft.md'))
    expect(w.files[`${HOME}/.claude/handoffs/handoff.log`] ?? '', 'the run is logged').toContain(' ok ')
    expect(saved?.[0] ?? '', 'saved with the title slug').toContain('build-the-refresh-mod.md')
    for (const s of SECRETS) expect(saved?.[1] ?? '', `secret removed: ${s.slice(0, 12)}`).not.toContain(s.slice(0, 16))
    expect(w.files[`${HOME}/.claude/handoffs/handoff.log`] ?? '', 'the fork usage is logged').toContain('tokens out 1400, in 12, cache read 240000, cache write 900')
    expect(w.forkPrompt, 'the template asks for a shorter handoff').toContain('under 900 words')
    expect(w.forkPrompt, 'no MCP server list').not.toContain('MCP ')
    expect(w.forkPrompt, 'fork prompt lists the read file, home as ~').toContain('~/vault/a.md')
    expect(w.forkPrompt, 'fork prompt lists the skill').toContain('/plugin-authoring')
    expect(w.forkPrompt, 'fork prompt lists the link').toContain('https://claude.ai/artifact/abc')
    expect(w.forkPrompt, 'tmp paths dropped').not.toContain('/tmp/x')
    expect(w.runs.some(r => r.argv[0] === 'rm' && r.argv.some(a => a.endsWith('-draft.md'))), 'the draft is replaced').toBe(true)

    expect(await v.find({ key: 'row0' }), 'ready: the step rows collapse into one line').toBeUndefined()

    await v.press({ key: 'copy' })
    expect(w.copied, 'copy goes to the surface clipboard').toContain('# Handoff: Build the refresh mod')
    expect(w.runs.some(r => r.argv[0] === 'pbcopy'), 'no pbcopy when the surface copied').toBe(false)
    expect(w.toasts.at(-1) ?? '', 'a toast confirms the copy').toMatch(/Copied/)

    w.copyOk = false
    await v.press({ key: 'copy' })
    expect(w.runs.find(r => r.argv[0] === 'pbcopy')?.stdin ?? '', 'pbcopy when the surface did not copy').toContain('# Handoff: Build the refresh mod')

    await v.press({ key: 'preview' })
    expect(w.opened, 'preview opens the pane').toContain('chat-handoff-preview')
    const pane = await $.ui.mount({ plugin: 'chat-handoff', surface, component: 'Pane', requestId: 'chat-handoff-preview', props: { title: 'Handoff preview', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as never)
    expect(await pane.find({ key: 'handoff' }), 'the pane draws the handoff as markdown').toBeDefined()
    await pane.press({ key: 'pclose' })
    expect(w.closed, 'Close in the pane closes it').toContain('chat-handoff-preview')

    await v.press({ key: 'start' })
    await clock.advance(2_000)
    const req = Object.entries(w.files).find(([k]) => k.includes('/.claude/pet/requests/'))
    const body = JSON.parse(req?.[1] ?? '{}') as { action?: string; stay?: boolean; folder?: string; text?: string }
    expect(body.action, 'pet request is a new chat').toBe('newchat')
    expect(body.folder).toBe(`${HOME}/vault`)
    expect(body.text ?? '').toContain('# Handoff:')

    await v.press({ key: 'close' })
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'copy' }), 'closed').toBeUndefined()
  })

  test(`another mod's request runs it; a failed model step keeps the draft and logs (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { w, clock } = world(on, { isAnswered: false, reason: 'api-error', status: 529 })
    w.request = true
    await start($, surface)
    await clock.advance(20_000)

    const v = await $.ui.mount(BAND(surface))
    const log = w.files[`${HOME}/.claude/handoffs/handoff.log`] ?? ''
    expect(log, 'the request is logged').toContain('asked by another mod')
    expect(log, 'the failure is logged').toContain('failed at step 2')
    expect(w.request, 'the request file is removed').toBe(false)
    expect(await v.find({ key: 'retry' }), 'failed: try again').toBeDefined()
    expect(await v.find({ key: 'open' }), 'failed: the draft can be opened').toBeDefined()
    expect(Object.entries(w.files).find(([k]) => k.endsWith('-draft.md'))?.[1] ?? '', 'the draft holds the request').toContain('Build a refresh mod')
  })

  test(`Later snoozes the offer; /chat-refresh brings it back (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { w, clock } = world(on)
    w.tokens = 262_000
    await start($, surface)
    await clock.settle()

    let v = await $.ui.mount(BAND(surface))
    await v.press({ key: 'close' })
    await clock.advance(6_000)
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'snoozed').toBeUndefined()
    expect(w.store['snooze:sid'], 'the snooze is kept').toBe(362_000)

    const answer = await $.command.run({ command: 'chat-refresh', args: '' } as never)
    expect(answer.text).toMatch(/Refresh panel shown/)
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'shown on request').toBeDefined()
  })

  test(`the shared switches: hidden stops the offer, off draws nothing (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { w, clock } = world(on)
    w.tokens = 262_000
    await start($, surface)
    await clock.settle()

    let v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'offered').toBeDefined()

    w.switches = '{ "chat-handoff:hidden": true }'
    await clock.advance(3_000)
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'hidden: no offer').toBeUndefined()

    w.switches = '{ "chat-handoff": false }'
    await clock.advance(3_000)
    const answer = await $.command.run({ command: 'chat-handoff', args: '' } as never)
    expect(answer.text).toMatch(/is off/)
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ type: 'Text', text: /REST/ }), 'off: only the rest of the band').toBeDefined()

    w.switches = ''
    await clock.advance(6_000)
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'on again: offered again').toBeDefined()
  })

  test(`/chat-handoff off writes the shared switch and draws nothing, on removes it (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const { w, clock } = world(on)
    w.tokens = 262_000
    w.switches = '{ "other": false }'
    await start($, surface)
    await clock.settle()

    let v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'offered').toBeDefined()
    expect((await $.command.run({ command: 'chat-handoff', args: 'status' } as never)).text).toBe('Chat Handoff is on.')

    const off = await $.command.run({ command: 'chat-handoff', args: 'off' } as never)
    expect(off.text).toMatch(/off in every chat/)
    expect(JSON.parse(w.switches)).toEqual({ other: false, 'chat-handoff': false })
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'off: no offer').toBeUndefined()
    expect((await $.command.run({ command: 'chat-handoff', args: '' } as never)).text).toMatch(/\/chat-handoff on/)

    const on2 = await $.command.run({ command: 'chat-handoff', args: 'on' } as never)
    expect(on2.text).toBe('Chat Handoff is on.')
    expect(JSON.parse(w.switches)).toEqual({ other: false })
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'on again: offered again').toBeDefined()
  })

  test(`the offerAtTokens option moves the threshold and scales the snooze (${surface})`, { timeoutMs: 30000, options: { offerAtTokens: 100_000 } }, async ($, on) => {
    const { w, clock } = world(on)
    w.tokens = 90_000
    await start($, surface)
    await clock.settle()

    let v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'no offer below the chosen 100k').toBeUndefined()

    w.tokens = 105_000
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'offer at 105k, well below the 250k default').toBeDefined()

    await v.press({ key: 'close' })
    expect(w.store['snooze:sid'], 'snooze is 40% of the threshold: 40k more tokens').toBe(145_000)
  })

  test(`a snooze saved under a lower threshold does not open the offer below a raised one (${surface})`, { timeoutMs: 30000, options: { offerAtTokens: 500_000 } }, async ($, on) => {
    const { w, clock } = world(on)
    // Saved by an earlier run at the 250k default: Close at 262k kept 362k.
    w.store['snooze:sid'] = 362_000
    w.tokens = 400_000
    await start($, surface)
    await clock.settle()

    let v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'no offer at 400k with the threshold at 500k').toBeUndefined()

    w.tokens = 510_000
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    v = await $.ui.mount(BAND(surface))
    expect(await v.find({ key: 'refresh' }), 'offer once 500k is reached').toBeDefined()
  })
}

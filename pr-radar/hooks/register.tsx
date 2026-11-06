import type { EngineInterface, Register } from 'claude-code'

import {
  DEFAULT_SORT,
  QUERY,
  ago,
  byRepo,
  clock,
  counts,
  cut,
  dedupe,
  mark,
  mineGroups,
  myReview,
  parsePrs,
  repoName,
  report,
  reviewGroups,
  short,
  stateWord,
  stillWaiting,
  validLogin,
  type Data,
  type GroupKey,
  type Pr,
  type SortField,
} from './core'

const NAME = 'pr-radar'
const DATA = { plugin: 'pr-radar', key: 'data' } as const
const BUSY = { plugin: 'pr-radar', key: 'busy' } as const
const TAB = { plugin: 'pr-radar', key: 'tab' } as const
const SORT = { plugin: 'pr-radar', key: 'sort' } as const
const HIDDEN = { plugin: 'pr-radar', key: 'hidden' } as const
const MODE = { plugin: 'pr-radar', key: 'mode' } as const
const SORT_LABEL: Record<SortField, string> = { repo: 'Repository', title: 'Title', number: 'Number' }
const SORT_KEY: Record<SortField, string> = { repo: 'e', title: 't', number: 'n' }
const PANE = 'pr-radar'
const GH_TIMEOUT_MS = 30_000

// One calm brand accent (indigo); the other hues carry meaning only.
const ACCENT = '#818cf8'
const GREEN = '#34d399'
const RED = '#f87171'
const AMBER = '#fbbf24'
const SKY = '#7dd3fc'
const GROUP_COLOR: Record<GroupKey, string | undefined> = {
  changes: RED,
  approved: GREEN,
  inReview: AMBER,
  awaiting: SKY,
  draft: undefined,
  needsYou: AMBER,
  newCommits: SKY,
  reviewed: GREEN,
}
const STATE_COLOR: Record<string, string | undefined> = { APPROVED: GREEN, CHANGES_REQUESTED: RED, COMMENTED: undefined }
const WAIT_CAP = 3

// The login of the person running the session, learnt once from `gh`.
let me = ''
let everyMs = 5 * 60_000
let startMode: Mode = 'auto'

type Mode = 'auto' | 'manual'
const everyLabel = () => (everyMs % 3_600_000 ? `${everyMs / 60_000}m` : `${everyMs / 3_600_000}h`)

/** One `gh api graphql` search; the search text is data passed as a variable, never part of the query. */
async function search($: EngineInterface, q: string): Promise<Pr[]> {
  const r = await $.process.run(['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=${q}`], { timeoutMs: GH_TIMEOUT_MS })
  if (r.exitCode !== 0) throw new Error(cut(r.stderr.trim() || `gh exited ${r.exitCode}`, 160))
  return parsePrs(r.stdout)
}

/** Asks GitHub for all three lists and stores the result. A failure keeps the old lists and records the reason. */
async function refresh($: EngineInterface) {
  const { value: busy = false } = await $.state.get(BUSY)
  if (busy) return
  await $.state.set(BUSY, true)
  try {
    if (!me) {
      const r = await $.process.run(['gh', 'api', 'user', '--jq', '.login'], { timeoutMs: GH_TIMEOUT_MS })
      const login = r.stdout.trim()
      if (r.exitCode !== 0 || !validLogin(login)) throw new Error(cut(r.stderr.trim() || 'could not read the GitHub login (is gh signed in?)', 160))
      me = login
    }
    const [mine, asked, reviewed] = await Promise.all([
      search($, `is:pr is:open author:${me}`),
      search($, `is:pr is:open review-requested:${me}`),
      search($, `is:pr is:open reviewed-by:${me} -author:${me}`),
    ])
    const data: Data = { me, mine: mine.sort(byRepo), reviewing: dedupe([...asked, ...reviewed]).sort(byRepo), at: Date.now(), error: '' }
    await $.state.set(DATA, data)
  } catch (err) {
    const { value: old = null } = await $.state.get(DATA)
    await $.state.set(DATA, { me, mine: old?.mine ?? [], reviewing: old?.reviewing ?? [], at: old?.at ?? Date.now(), error: cut(String(err instanceof Error ? err.message : err), 160) })
  } finally {
    await $.state.set(BUSY, false)
  }
}

/** Picks a sort field; picking the one already chosen flips the direction. */
async function pickSort($: EngineInterface, field: SortField) {
  const { value: cur = null } = await $.state.get(SORT)
  const s = cur ?? DEFAULT_SORT
  await $.state.set(SORT, s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: s.dir })
}

async function setHidden($: EngineInterface, hidden: boolean) {
  await $.state.set(HIDDEN, hidden)
  if (hidden) $.ui.toast('PR Radar bar hidden. /pr-radar show brings it back.')
}

const modeText = (mode: Mode) => (mode === 'auto' ? `PR Radar: Auto, refreshes every ${everyLabel()}.` : 'PR Radar: Manual, refreshes only when you press Refresh.')

/** The timer keeps ticking; a tick in Manual does nothing, so switching back needs no new timer. */
async function tick($: EngineInterface) {
  const { value: mode = startMode } = await $.state.get(MODE)
  if (mode === 'auto') await refresh($)
}

export const register: Register = (on, options) => {
  const minutes = Number(options.refreshMinutes)
  everyMs = Math.max(1, Number.isFinite(minutes) ? minutes : 5) * 60_000
  startMode = String(options.refreshMode ?? 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto'

  on('session.start', async ($, e, next) => {
    await $.state.set(MODE, startMode)
    $.clock.every(everyMs, () => {
      void tick($).catch(() => undefined)
    })
    $.clock.after(0, () => {
      void refresh($).catch(() => undefined)
    })
    await $.command.register({
      name: NAME,
      description: 'PR Radar: open the details pane, "text" prints the report here, "refresh" asks GitHub again, "auto"/"manual" sets how it refreshes, "hide"/"show" the bar',
      argumentHint: '[text|refresh|auto|manual|hide|show]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'refresh') {
      await refresh($)
      return { text: 'PR Radar: refreshed.' }
    }
    if (arg === 'auto' || arg === 'manual') {
      await $.state.set(MODE, arg)
      return { text: modeText(arg) }
    }
    if (arg === 'hide' || arg === 'show') {
      await $.state.set(HIDDEN, arg === 'hide')
      return { text: arg === 'hide' ? 'PR Radar bar hidden. /pr-radar show brings it back.' : 'PR Radar bar shown.' }
    }
    const { value: data = null } = await $.state.get(DATA)
    if (arg === 'text') return { text: data ? report(data) : 'PR Radar: no data yet. Try /pr-radar refresh.' }
    const opened = await $.ui.open({ id: PANE, title: 'PR Radar', focus: true, closeOnEscape: true })
    // No pane here (claude -p, VS Code panel): print the report instead.
    if (!opened.isPlaced) return { text: data ? report(data) : 'PR Radar: no data yet. Try /pr-radar refresh.' }
    return {}
  })

  on('ui.press', { plugin: NAME, element: 'radar-refresh' }, async ($, e) => {
    void refresh($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-open' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'PR Radar', focus: true, closeOnEscape: true })
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-tab-mine' }, async ($, e) => {
    await $.state.set(TAB, 'mine')
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-tab-review' }, async ($, e) => {
    await $.state.set(TAB, 'review')
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-sort-repo' }, async ($, e) => {
    await pickSort($, 'repo')
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-sort-title' }, async ($, e) => {
    await pickSort($, 'title')
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-sort-number' }, async ($, e) => {
    await pickSort($, 'number')
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-sort-dir' }, async ($, e) => {
    const { value: cur = null } = await $.state.get(SORT)
    const s = cur ?? DEFAULT_SORT
    await $.state.set(SORT, { field: s.field, dir: s.dir === 'asc' ? 'desc' : 'asc' })
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-mode' }, async ($, e) => {
    const { value: mode = startMode } = await $.state.get(MODE)
    const nextMode: Mode = mode === 'auto' ? 'manual' : 'auto'
    await $.state.set(MODE, nextMode)
    $.ui.toast(modeText(nextMode))
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-hide' }, async ($, e) => {
    await setHidden($, true)
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'radar-show' }, async ($, e) => {
    await setHidden($, false)
    return { element: e.element }
  })

  // The band: one line, the counts that matter, Refresh and Open.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: hidden = false } = await $.state.get(HIDDEN)
    if (hidden) return next(e)
    const { value: data = null } = await $.state.get(DATA)
    const { value: busy = false } = await $.state.get(BUSY)
    const { value: mode = startMode } = await $.state.get(MODE)
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const rest = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = data ? counts(data) : null
    const sep = (k: string) => (
      <Text key={k} dimColor>
        {' · '}
      </Text>
    )
    const parts = c
      ? [
          <Text key="b-open">{`${c.mine} open`}</Text>,
          c.changes ? <Text key="b-changes" color={RED}>{`${c.changes} changes`}</Text> : null,
          c.approved ? <Text key="b-approved" color={GREEN}>{`${c.approved} approved`}</Text> : null,
          c.unreviewed ? <Text key="b-unrev">{`${c.unreviewed} awaiting`}</Text> : null,
          c.pending ? (
            <Text key="b-pending" color={AMBER} bold>
              {`${c.pending} to review`}
            </Text>
          ) : null,
        ].filter(Boolean)
      : []
    // Desktop draws a badge per hotkey, which costs more room than the label; the terminal draws none.
    const hk = (k: string) => (e.surface === 'terminal' ? k : undefined)
    const age = busy ? '…' : data ? ago(data.at, Date.now()) : ''
    const failed = !!data?.error && !busy
    return (
      <Box flexDirection="column" rowGap="sm">
        {rest as never}
        <Box key="radar-band" flexDirection="row" alignItems="center" justifyContent="space-between" gap={2} borderStyle="round" borderColor={ACCENT} paddingX={2} paddingY="xs">
          <Box key="radar-left" flexDirection="row" alignItems="center" gap={2} flexShrink={1}>
            <Box key="radar-brand" flexShrink={0}>
              <Text color={ACCENT} bold wrap="truncate">
                ◆ PR Radar
              </Text>
            </Box>
            <Box key="radar-summary" flexShrink={1}>
              <Text wrap="truncate">{c ? parts.flatMap((p, i) => (i ? [sep(`s${i}`), p] : [p])) : <Text dimColor>{busy ? 'Fetching your PRs…' : failed ? 'GitHub unreachable' : 'No data yet'}</Text>}</Text>
            </Box>
          </Box>
          <Box key="radar-actions" flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            {/* Desktop draws `label`, not children, and draws dimColor as disabled: the visible text goes in label, nothing dim but a busy Refresh. */}
            <Button variant="secondary" key="radar-mode" label={mode === 'auto' ? 'Auto' : 'Manual'} hotkey={hk('a')} onPress={() => undefined} />
            <Button variant="secondary" key="radar-refresh" label={`${failed ? '⚠ ' : ''}↻${age ? ` ${age}` : ''}`} hotkey={hk('r')} dimColor={busy} onPress={() => undefined} />
            <Button variant="secondary" key="radar-open" label="Open" hotkey={hk('o')} onPress={() => undefined} />
            <Button variant="secondary" key="radar-hide" role="dismiss" label="✕" hotkey={hk('h')} onPress={() => undefined} />
          </Box>
        </Box>
      </Box>
    )
  })

  // The details pane: two tabs, each grouped by what the PR needs.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { value: data = null } = await $.state.get(DATA)
    const { value: busy = false } = await $.state.get(BUSY)
    const { value: chosen = null } = await $.state.get(TAB)
    const { value: sortState = null } = await $.state.get(SORT)
    const { value: hidden = false } = await $.state.get(HIDDEN)
    const { value: mode = startMode } = await $.state.get(MODE)
    const sort = sortState ?? DEFAULT_SORT
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const now = Date.now()
    const c = data ? counts(data) : null
    // Unchosen, the tab opens where the work is.
    const tab = chosen ?? (c?.pending ? 'review' : 'mine')

    const dot = (k: string) => (
      <Text key={k} dimColor>
        {' · '}
      </Text>
    )
    const joined = (items: unknown[]) => items.flatMap((x, i) => (i ? [dot(`d${i}`), x] : [x]))

    const head = (p: Pr) => (
      <Box key="head" flexDirection="row" justifyContent="space-between" gap={2}>
        <Box key="title" flexShrink={1}>
          <Text bold wrap="truncate">
            {p.title}
          </Text>
        </Box>
        <Box key="age" flexShrink={0}>
          <Text dimColor>{ago(p.updated, now)}</Text>
        </Box>
      </Box>
    )
    const ref = (p: Pr) => <Link key="ref" href={p.url} label={`${repoName(p)} #${p.n}`} />

    const mineRow = (p: Pr) => {
      const waiting = stillWaiting(p).map(short)
      const bits: unknown[] = [ref(p)]
      if (p.reviews.length)
        bits.push(
          <Text key="rev">
            {p.reviews.flatMap((r, i) => [
              i ? <Text key={`rs${i}`}> </Text> : null,
              <Text key={`r${i}`} color={STATE_COLOR[r.state]} dimColor={!STATE_COLOR[r.state]}>
                {`${short(r.login)} ${mark(r.state)}`}
              </Text>,
            ])}
          </Text>,
        )
      else
        bits.push(
          <Text key="rev" dimColor>
            no reviews yet
          </Text>,
        )
      if (waiting.length)
        bits.push(
          <Text key="wait" dimColor>
            {`waiting on ${waiting.slice(0, WAIT_CAP).join(', ')}${waiting.length > WAIT_CAP ? ` +${waiting.length - WAIT_CAP}` : ''}`}
          </Text>,
        )
      return (
        <Box key={p.url} flexDirection="column" paddingLeft={2}>
          {head(p)}
          <Text key="meta" wrap="truncate">
            {joined(bits) as never}
          </Text>
        </Box>
      )
    }

    const reviewRow = (p: Pr) => {
      const m = data ? myReview(p, data.me) : null
      const bits: unknown[] = [ref(p), <Text key="by" dimColor>{`by ${short(p.author)}`}</Text>]
      if (m?.state)
        bits.push(
          <Text key="you" color={STATE_COLOR[m.state]} dimColor={!STATE_COLOR[m.state]}>
            {`you ${stateWord(m.state)} ${mark(m.state)}`}
          </Text>,
        )
      return (
        <Box key={p.url} flexDirection="column" paddingLeft={2}>
          {head(p)}
          <Text key="meta" wrap="truncate">
            {joined(bits) as never}
          </Text>
        </Box>
      )
    }

    const groupsFor = data ? (tab === 'mine' ? mineGroups(data.mine, sort) : reviewGroups(data.reviewing, data.me, sort)) : []
    const body = !data ? (
      <Text key="empty" dimColor>
        {busy ? 'Fetching your PRs from GitHub…' : 'No data yet. Press Refresh.'}
      </Text>
    ) : !groupsFor.length ? (
      <Box key="empty" flexDirection="column" paddingY="sm">
        <Text bold>{tab === 'mine' ? 'No open PRs.' : 'Nothing waiting on you.'}</Text>
        <Text dimColor>{tab === 'mine' ? 'PRs you open show up here on the next refresh.' : "Review requests and PRs you've reviewed show up here."}</Text>
      </Box>
    ) : (
      groupsFor.map(g => (
        <Box key={g.key} flexDirection="column" rowGap="xs">
          <Text key="label">
            <Text color={GROUP_COLOR[g.key]} dimColor={!GROUP_COLOR[g.key]} bold>
              {`● ${g.label}`}
            </Text>
            <Text dimColor>{` ${g.items.length}`}</Text>
          </Text>
          {g.items.map(p => (tab === 'mine' ? mineRow(p) : reviewRow(p)))}
        </Box>
      ))
    )

    return (
      <Box flexDirection="column" rowGap="sm" paddingX={1}>
        <Box key="top" flexDirection="row" alignItems="center" justifyContent="space-between" gap={2}>
          <Box key="tabs" flexDirection="row" alignItems="center" gap={1}>
            <Button key="radar-tab-mine" variant={tab === 'mine' ? 'primary' : 'secondary'} label={`My PRs · ${c?.mine ?? 0}`} hotkey="m" onPress={() => undefined} />
            <Button key="radar-tab-review" variant={tab === 'review' ? 'primary' : 'secondary'} label={c?.pending ? `To review · ${c.pending} new` : `To review · ${data?.reviewing.length ?? 0}`} hotkey="v" onPress={() => undefined} />
          </Box>
          <Box key="right" flexDirection="row" alignItems="center" gap={2}>
            <Text dimColor>{busy ? 'Refreshing…' : data ? `Updated ${ago(data.at, now)} ago`.replace('now ago', 'just now') : ''}</Text>
            {hidden ? <Button variant="secondary" key="radar-show" label="Show bar" hotkey="b" onPress={() => undefined} /> : null}
            <Button variant="secondary" key="radar-mode" label={mode === 'auto' ? `Auto · ${everyLabel()}` : 'Manual'} hotkey="a" onPress={() => undefined} />
            <Button variant="secondary" key="radar-refresh" label="Refresh" hotkey="r" dimColor={busy} onPress={() => undefined} />
          </Box>
        </Box>
        <Box key="sort" flexDirection="row" alignItems="center" gap={1}>
          <Text dimColor>Sort by</Text>
          {(['repo', 'title', 'number'] as const).map(f => (
            <Button key={`radar-sort-${f}`} variant={sort.field === f ? 'primary' : 'secondary'} label={SORT_LABEL[f]} hotkey={SORT_KEY[f]} onPress={() => undefined} />
          ))}
          <Button key="radar-sort-dir" variant="secondary" label={sort.dir === 'asc' ? '↑ Asc' : '↓ Desc'} hotkey="d" onPress={() => undefined} />
        </Box>
        {data?.error ? (
          <Text key="error" color={RED} wrap="wrap">
            {`Couldn't refresh from GitHub: ${data.error}. Showing results from ${clock(data.at)}.`}
          </Text>
        ) : null}
        {body as never}
      </Box>
    )
  })
}

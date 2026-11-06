// Pure logic of pr-radar: no engine calls, so the tests reach all of it.

export type Review = { login: string; state: string; at: string }
export type Pr = {
  n: number
  repo: string
  title: string
  url: string
  draft: boolean
  decision: string
  author: string
  reviews: Review[]
  /** People and teams a review is still requested from. */
  waiting: string[]
  lastCommit: string
  /** Last activity on the PR (ISO time). */
  updated: string
}
export type Data = { me: string; mine: Pr[]; reviewing: Pr[]; at: number; error: string }

/** Review bots add noise to "who reviewed" and "who I wait for". */
const IGNORED = new Set(['cursor', 'upgrade-tekton-ci'])
const SHOWN = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']
const MARK: Record<string, string> = { APPROVED: '✓', CHANGES_REQUESTED: '✗', COMMENTED: '●' }
const WAIT_CAP = 3

export const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim()
export const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)
/** A GitHub login is letters, digits and hyphens: anything else never reaches a search string. */
export const validLogin = (s: string) => /^[A-Za-z0-9-]{1,39}$/.test(s)

export const QUERY = `query($q:String!){search(query:$q,type:ISSUE,first:50){nodes{... on PullRequest{
number title url isDraft reviewDecision updatedAt repository{nameWithOwner} author{login}
reviewRequests(first:30){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name}}}}
latestReviews(first:30){nodes{state submittedAt author{__typename login}}}
commits(last:1){nodes{commit{committedDate}}}}}}}`

type Node = Record<string, any>

/** The PRs in a `gh api graphql` reply; an unreadable reply is an error, a missing field a default. */
export function parsePrs(stdout: string): Pr[] {
  const nodes: Node[] = JSON.parse(stdout)?.data?.search?.nodes ?? []
  return nodes
    .filter(x => x && typeof x.number === 'number')
    .map(x => ({
      n: x.number,
      repo: String(x.repository?.nameWithOwner ?? ''),
      title: oneLine(String(x.title ?? '')),
      url: String(x.url ?? ''),
      draft: x.isDraft === true,
      decision: String(x.reviewDecision ?? ''),
      author: String(x.author?.login ?? ''),
      reviews: ((x.latestReviews?.nodes ?? []) as Node[])
        .filter(r => r?.author?.login && r.author.__typename !== 'Bot' && !IGNORED.has(r.author.login) && SHOWN.includes(r.state))
        .map(r => ({ login: String(r.author.login), state: String(r.state), at: String(r.submittedAt ?? '') })),
      waiting: ((x.reviewRequests?.nodes ?? []) as Node[])
        .map(r => String(r?.requestedReviewer?.login ?? r?.requestedReviewer?.name ?? ''))
        .filter(w => w && !IGNORED.has(w)),
      lastCommit: String(x.commits?.nodes?.[0]?.commit?.committedDate ?? ''),
      updated: String(x.updatedAt ?? ''),
    }))
}

/** Same PR twice (requested of me and reviewed by me) counts once. */
export function dedupe(list: Pr[]): Pr[] {
  const seen = new Set<string>()
  return list.filter(p => !seen.has(p.url) && !!seen.add(p.url))
}

export const byRepo = (a: Pr, b: Pr) => a.repo.localeCompare(b.repo) || a.n - b.n

/** My review of a PR: none yet (or asked again), or my last state and whether commits came after it. */
export function myReview(p: Pr, me: string): { pending: boolean; state: string; newCommits: boolean } {
  const r = p.reviews.find(x => x.login === me)
  const asked = p.waiting.includes(me)
  return { pending: !r || asked, state: r?.state ?? '', newCommits: !!r && !!p.lastCommit && p.lastCommit > r.at }
}

export const repoName = (p: Pr) => p.repo.split('/').pop() ?? p.repo

// shortcut: strips only the org's "upgrade" login suffix; make it a setting if the mod is shared outside Upgrade.
const SUFFIX = 'upgrade'
/** `avdsouzaupgrade` reads as `avdsouza`: the shared suffix is noise in every name. */
export const short = (login: string) => (login.length > SUFFIX.length && login.endsWith(SUFFIX) ? login.slice(0, -SUFFIX.length) : login)

export const mark = (state: string) => MARK[state] ?? '?'
export const stateWord = (state: string) => (state === 'APPROVED' ? 'approved' : state === 'CHANGES_REQUESTED' ? 'changes requested' : state === 'COMMENTED' ? 'commented' : '')

/** `5m`, `3h`, `2d`, `6w`: how long ago, for a column of ages. Empty when unknown. */
export function ago(iso: string | number, now: number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((now - t) / 60_000))
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 20_160 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 10_080)}w`
}

/** Who a review is still asked from, minus those who already answered. */
export function stillWaiting(p: Pr): string[] {
  const done = new Set(p.reviews.map(r => r.login))
  return p.waiting.filter(x => !done.has(x))
}

/** `avdsouza ✓ · rmathews ✗`: who reviewed and how. */
export const reviewedText = (p: Pr) => p.reviews.map(r => `${short(r.login)} ${mark(r.state)}`).join(' · ')

/** The first few people still asked, then how many more. */
export function waitingText(p: Pr): string {
  const w = stillWaiting(p).map(short)
  if (!w.length) return ''
  return w.length > WAIT_CAP ? `${w.slice(0, WAIT_CAP).join(', ')} +${w.length - WAIT_CAP}` : w.join(', ')
}

export const decisionText = (d: string) => (d === 'APPROVED' ? 'approved' : d === 'CHANGES_REQUESTED' ? 'changes requested' : d === 'REVIEW_REQUIRED' ? 'review required' : '')

export type GroupKey = 'changes' | 'approved' | 'inReview' | 'awaiting' | 'draft' | 'needsYou' | 'newCommits' | 'reviewed'
export type Group = { key: GroupKey; label: string; items: Pr[] }

export type SortField = 'repo' | 'title' | 'number'
export type SortDir = 'asc' | 'desc'
export type Sort = { field: SortField; dir: SortDir }
export const SORT_FIELDS: readonly SortField[] = ['repo', 'title', 'number']
export const DEFAULT_SORT: Sort = { field: 'repo', dir: 'asc' }

const KEY: Record<SortField, (a: Pr, b: Pr) => number> = {
  repo: (a, b) => repoName(a).localeCompare(repoName(b)) || a.n - b.n,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || a.n - b.n,
  number: (a, b) => a.n - b.n || repoName(a).localeCompare(repoName(b)),
}
/** A comparator for the chosen field and direction. */
export const sorter = (s: Sort) => (a: Pr, b: Pr) => (s.dir === 'asc' ? 1 : -1) * KEY[s.field](a, b)

const groups = (all: [GroupKey, string, Pr[]][], s: Sort): Group[] =>
  all.filter(g => g[2].length).map(([key, label, items]) => ({ key, label, items: [...items].sort(sorter(s)) }))
const open = (p: Pr) => p.decision !== 'APPROVED' && p.decision !== 'CHANGES_REQUESTED'

/** My PRs by what they need, most actionable first: fix, merge, wait, nudge, finish. */
export function mineGroups(prs: Pr[], s: Sort = DEFAULT_SORT): Group[] {
  const live = prs.filter(p => !p.draft)
  return groups([
    ['changes', 'Changes requested', live.filter(p => p.decision === 'CHANGES_REQUESTED')],
    ['approved', 'Approved', live.filter(p => p.decision === 'APPROVED')],
    ['inReview', 'In review', live.filter(p => open(p) && p.reviews.length > 0)],
    ['awaiting', 'Awaiting first review', live.filter(p => open(p) && !p.reviews.length)],
    ['draft', 'Drafts', prs.filter(p => p.draft)],
  ], s)
}

/** PRs I review: what waits on me, what changed since I looked, what is done. */
export function reviewGroups(prs: Pr[], me: string, s: Sort = DEFAULT_SORT): Group[] {
  const r = prs.map(p => [p, myReview(p, me)] as const)
  return groups([
    ['needsYou', 'Needs your review', r.filter(([, m]) => m.pending).map(([p]) => p)],
    ['newCommits', 'New commits since your review', r.filter(([, m]) => !m.pending && m.newCommits).map(([p]) => p)],
    ['reviewed', 'Reviewed', r.filter(([, m]) => !m.pending && !m.newCommits).map(([p]) => p)],
  ], s)
}

export function counts(d: Data) {
  const live = d.mine.filter(p => !p.draft)
  const pend = d.reviewing.filter(p => myReview(p, d.me).pending).length
  return {
    mine: d.mine.length,
    approved: live.filter(p => p.decision === 'APPROVED').length,
    changes: live.filter(p => p.decision === 'CHANGES_REQUESTED').length,
    unreviewed: live.filter(p => open(p) && !p.reviews.length).length,
    drafts: d.mine.length - live.length,
    pending: pend,
    done: d.reviewing.length - pend,
  }
}

/** HH:MM in the local zone. */
export const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** The whole report as text, for the terminal and for surfaces that draw nothing. */
export function report(d: Data): string {
  const out = [`PR Radar (updated ${clock(d.at)})${d.error ? ` — last refresh failed: ${d.error}` : ''}`]
  for (const g of mineGroups(d.mine)) {
    out.push('', `${g.label} (${g.items.length})`)
    for (const p of g.items) {
      out.push(`  ${repoName(p)} #${p.n} ${cut(p.title, 70)}`)
      const w = waitingText(p)
      out.push(`    reviewed: ${reviewedText(p) || 'nobody yet'}${w ? ` · waiting on ${w}` : ''}`)
    }
  }
  if (!d.mine.length) out.push('', 'No open PRs.')
  for (const g of reviewGroups(d.reviewing, d.me)) {
    out.push('', `${g.label} (${g.items.length})`)
    for (const p of g.items) {
      const m = myReview(p, d.me)
      out.push(`  ${repoName(p)} #${p.n} ${cut(p.title, 60)} by ${short(p.author)}${m.state ? ` · you ${stateWord(m.state)}` : ''}`)
    }
  }
  if (!d.reviewing.length) out.push('', 'Nothing waiting on your review.')
  return out.join('\n')
}

import { expect, test } from 'claude-code/testing'

import { ago, counts, dedupe, mineGroups, myReview, parsePrs, report, reviewGroups, short, validLogin, waitingText } from '../hooks/core'

const node = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  isDraft: false,
  reviewDecision: null,
  updatedAt: `2026-11-0${n % 9}T10:00:00Z`,
  repository: { nameWithOwner: 'o/r' },
  author: { login: 'rmendes' },
  reviewRequests: { nodes: [] },
  latestReviews: { nodes: [] },
  commits: { nodes: [{ commit: { committedDate: '2026-11-05T10:00:00Z' } }] },
  ...extra,
})
const reply = (...nodes: unknown[]) => JSON.stringify({ data: { search: { nodes } } })
const review = (login: string, state: string, at = '2026-11-05T09:00:00Z', typename = 'User') => ({ state, submittedAt: at, author: { login, __typename: typename } })
const asked = (...who: string[]) => ({ nodes: who.map(w => ({ requestedReviewer: w.startsWith('team:') ? { __typename: 'Team', name: w.slice(5) } : { __typename: 'User', login: w } })) })

test('parsePrs keeps reviewers and drops bots and dismissed reviews', () => {
  const [p] = parsePrs(
    reply(node(1, { latestReviews: { nodes: [review('ana', 'APPROVED'), review('cursor', 'COMMENTED'), review('x', 'COMMENTED', '', 'Bot'), review('bob', 'DISMISSED')] } })),
  )
  expect(p?.reviews.map(r => r.login)).toEqual(['ana'])
  expect(p?.updated).toBe('2026-11-01T10:00:00Z')
})

test('parsePrs reads users and teams that are still asked, minus bots', () => {
  const [p] = parsePrs(reply(node(1, { reviewRequests: asked('ana', 'team:core', 'upgrade-tekton-ci') })))
  expect(p?.waiting).toEqual(['ana', 'core'])
})

test('parsePrs rejects text that is not JSON', () => {
  expect(() => parsePrs('boom')).toThrow()
})

test('waitingText caps the list, shortens logins and skips people who already reviewed', () => {
  const [p] = parsePrs(reply(node(1, { reviewRequests: asked('a', 'bupgrade', 'c', 'd', 'e'), latestReviews: { nodes: [review('a', 'APPROVED')] } })))
  expect(waitingText(p!)).toBe('b, c, d +1')
})

test('short strips the org suffix but never a whole login', () => {
  expect(short('avdsouzaupgrade')).toBe('avdsouza')
  expect(short('upgrade')).toBe('upgrade')
  expect(short('core')).toBe('core')
})

test('ago reads as minutes, hours, days, weeks', () => {
  const now = Date.parse('2026-11-06T12:00:00Z')
  expect(ago('2026-11-06T12:00:20Z', now)).toBe('now')
  expect(ago('2026-11-06T11:55:00Z', now)).toBe('5m')
  expect(ago('2026-11-06T09:00:00Z', now)).toBe('3h')
  expect(ago('2026-11-04T12:00:00Z', now)).toBe('2d')
  expect(ago('2026-09-25T12:00:00Z', now)).toBe('6w')
  expect(ago('', now)).toBe('')
})

test('myReview: none is pending, re-requested is pending, later commits are flagged', () => {
  const [none, done, again, fresh] = parsePrs(
    reply(
      node(1),
      node(2, { latestReviews: { nodes: [review('me', 'APPROVED', '2026-11-05T11:00:00Z')] } }),
      node(3, { latestReviews: { nodes: [review('me', 'APPROVED')] }, reviewRequests: asked('me') }),
      node(4, { latestReviews: { nodes: [review('me', 'COMMENTED', '2026-11-05T09:00:00Z')] } }),
    ),
  )
  expect(myReview(none!, 'me').pending).toBe(true)
  expect(myReview(done!, 'me')).toEqual({ pending: false, state: 'APPROVED', newCommits: false })
  expect(myReview(again!, 'me').pending).toBe(true)
  expect(myReview(fresh!, 'me').newCommits).toBe(true)
})

test('mineGroups orders by what each PR needs and keeps drafts apart', () => {
  const prs = parsePrs(
    reply(
      node(1, { reviewDecision: 'APPROVED' }),
      node(2, { reviewDecision: 'CHANGES_REQUESTED' }),
      node(3, { latestReviews: { nodes: [review('ana', 'COMMENTED')] } }),
      node(4),
      node(5, { isDraft: true, reviewDecision: 'APPROVED' }),
    ),
  )
  expect(mineGroups(prs).map(g => [g.key, g.items.map(p => p.n)])).toEqual([
    ['changes', [2]],
    ['approved', [1]],
    ['inReview', [3]],
    ['awaiting', [4]],
    ['draft', [5]],
  ])
})

test('mineGroups drops empty groups and sorts each by the chosen field and direction', () => {
  const prs = parsePrs(
    reply(
      node(10, { title: 'INV-2: b', repository: { nameWithOwner: 'o/alpha' } }),
      node(2, { title: 'INV-10: a', repository: { nameWithOwner: 'o/zeta' } }),
      node(7, { title: 'inv-3: c', repository: { nameWithOwner: 'o/alpha' } }),
    ),
  )
  const order = (s: Parameters<typeof mineGroups>[1]) => mineGroups(prs, s).map(g => [g.key, g.items.map(p => p.n)])
  expect(order(undefined)).toEqual([['awaiting', [7, 10, 2]]])
  expect(order({ field: 'repo', dir: 'desc' })).toEqual([['awaiting', [2, 10, 7]]])
  // Numeric and case-blind: INV-2 < inv-3 < INV-10.
  expect(order({ field: 'title', dir: 'asc' })).toEqual([['awaiting', [10, 7, 2]]])
  expect(order({ field: 'number', dir: 'asc' })).toEqual([['awaiting', [2, 7, 10]]])
  expect(order({ field: 'number', dir: 'desc' })).toEqual([['awaiting', [10, 7, 2]]])
})

test('reviewGroups splits pending, new commits since my review, and reviewed', () => {
  const prs = parsePrs(
    reply(
      node(1),
      node(2, { latestReviews: { nodes: [review('me', 'COMMENTED', '2026-11-05T09:00:00Z')] } }),
      node(3, { latestReviews: { nodes: [review('me', 'APPROVED', '2026-11-05T11:00:00Z')] } }),
    ),
  )
  expect(reviewGroups(prs, 'me').map(g => [g.key, g.items.map(p => p.n)])).toEqual([
    ['needsYou', [1]],
    ['newCommits', [2]],
    ['reviewed', [3]],
  ])
})

test('dedupe counts a PR requested of me and reviewed by me once', () => {
  const list = parsePrs(reply(node(1), node(1), node(2)))
  expect(dedupe(list).length).toBe(2)
})

test('counts and report summarise both lists', () => {
  const mine = parsePrs(reply(node(1, { reviewDecision: 'APPROVED', latestReviews: { nodes: [review('anaupgrade', 'APPROVED')] } }), node(2), node(4, { isDraft: true })))
  const reviewing = parsePrs(reply(node(3, { author: { login: 'zedupgrade' } })))
  const d = { me: 'me', mine, reviewing, at: 0, error: '' }
  expect(counts(d)).toEqual({ mine: 3, approved: 1, changes: 0, unreviewed: 1, drafts: 1, pending: 1, done: 0 })
  const text = report(d)
  expect(text).toContain('Approved (1)')
  expect(text).toContain('r #1 PR 1')
  expect(text).toContain('reviewed: ana ✓')
  expect(text).toContain('Needs your review (1)')
  expect(text).toContain('r #3 PR 3 by zed')
})

test('validLogin only lets GitHub logins into a search', () => {
  expect(validLogin('rmendesupgrade')).toBe(true)
  expect(validLogin('a b')).toBe(false)
  expect(validLogin('a" author:x')).toBe(false)
})

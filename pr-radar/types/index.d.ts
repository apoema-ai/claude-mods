/** Mirrors Review, Pr and Data in hooks/core.ts: a contract file cannot import. */
export type RadarReview = { login: string; state: string; at: string }
export type RadarPr = {
  n: number
  repo: string
  title: string
  url: string
  draft: boolean
  decision: string
  author: string
  reviews: RadarReview[]
  waiting: string[]
  lastCommit: string
  updated: string
}
export type RadarData = { me: string; mine: RadarPr[]; reviewing: RadarPr[]; at: number; error: string }

declare module 'claude-code' {
  interface PluginState {
    'pr-radar': {
      /** The last fetch; null before the first one finishes. */
      data: RadarData | null
      /** A fetch is running. */
      busy: boolean
      /** The pane's tab; null until the person picks one. */
      tab: 'mine' | 'review' | null
      /** The pane's sort; null until the person picks one (repository, ascending). */
      sort: { field: 'repo' | 'title' | 'number'; dir: 'asc' | 'desc' } | null
      /** The bar above the prompt is hidden for this session. */
      hidden: boolean
    }
  }
}

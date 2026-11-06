/** The countdown. `ttlMs` is the cache length; `known` says whether a reply of this chat set it. */
export type Clock = {
  lastEnd: number
  ttlMs: number
  known: boolean
  tokens: number
  now: number
  /** Tokens the last turn's first request wrote because it found the cache reset while the band said warm; 0 or absent when it did not. Optional: a value saved by 0.4.0 has none. */
  rewrote?: number
}

/** Keep warm: one small background ping shortly before the cache would go cold. */
export type Warm = {
  startedAt: number
  /** Pings that reached the API and read (or rewrote) the cache. Failed ones are not counted. */
  pings: number
  read: number
  write: number
  cold: boolean
  error: string
  sending: boolean
  failures: number
  retryAt: number
  /** Running totals over every successful ping. Optional: a value saved by 0.1.x has none. */
  totalRead?: number
  totalWrite?: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      clock: Clock | null
      warm: Warm | null
      isHidden: boolean
      /** Until when the cold band's "Rewarm now" waits for its confirming second press; null when not armed. */
      armed: number | null
      /** Set when something reset the cache before its time ran out (a model switch, a compaction): `why` finishes "Cache reset by ...", `tokens` is what the next message writes, null when not known. Cleared when a main-chat turn completes. */
      invalid: { why: string; tokens: number | null } | null
    }
  }
}

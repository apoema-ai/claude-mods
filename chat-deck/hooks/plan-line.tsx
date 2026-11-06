// The line under the plan bar, ticking on the surface's frame clock so the pane need not redraw each second.
// The same text as planLine in plan.ts (which draws it where a surface has no client modules); keep the two in step.
import type { ClientModule } from 'claude-code'

type Act = { text: string; at: number; running: boolean; failed: boolean }
type Props = {
  cur: { startedAt: number | null } | null
  head: string
  act: Act | null
  agents: string
  /** The hooks module's clock when it drew: the local count restarts from each fresh reading. */
  now: number
  width: number
}
type Ref = { base: number; ticks: number; lastNow: number; isLive: boolean }
type State = { ref: Ref }

const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const pad = (x: number) => String(x).padStart(2, '0')
  return m < 60 ? `${m}m${pad(s % 60)}s` : `${Math.floor(m / 60)}h${pad(m % 60)}m`
}
const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)

/** planLines in plan.ts: how long this step has run, then what is running, as one row. */
function text(x: Props, nowMs: number): string[] {
  if (!x.cur) return [[x.head, x.agents].filter(Boolean).join(' · ')].filter(Boolean)
  const ran = x.cur.startedAt ? nowMs - x.cur.startedAt : 0
  const a = x.act ? (x.act.running ? (nowMs - x.act.at >= 1000 ? `${x.act.text} · running ${dur(nowMs - x.act.at)}` : x.act.text) : x.act.failed ? `${x.act.text} · failed` : x.act.text) : ''
  const row = [ran >= 1000 ? `this step ${dur(ran)}` : '', a, x.agents].filter(Boolean).join(' · ')
  return [row].filter(Boolean)
}

const PlanLine: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { base: props.now, ticks: 0, lastNow: -1, isLive: false }
  // Read by the tick below, which keeps the first call's props: only a step in progress has a clock to move.
  ref.isLive = props.cur !== null
  if (props.now !== ref.lastNow) {
    ref.lastNow = props.now
    ref.base = props.now
    ref.ticks = 0
  }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(1000, () => {
      if (ref.isLive) {
        ref.ticks += 1
        surface.setState({ ref })
      }
    })
  }
  const w = Math.max(1, surface.columns || props.width)
  const rows = text(props, ref.base + ref.ticks * 1000)
  return (
    <Box flexDirection="column">
      {rows.map(r => (
        <Text dimColor wrap="truncate-end">
          {cut(r, w)}
        </Text>
      ))}
    </Box>
  )
}

export default PlanLine

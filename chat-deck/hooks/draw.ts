// SVG drawing for the graphical surfaces (desktop, editor, mobile). The terminal keeps its glyphs.
// The meter follows plan-bar's emerald-to-teal bar; the crab follows agents-deck's pets.

const GOOD = ['#34d399', '#0f766e']
const WARN = ['#fbbf24', '#b45309']
const TRACK = '#9ca3af33'

export const METER_H = 8
export const PET_PX_W = 27
export const PET_PX_H = 20

/** A rounded track with a gradient fill up to `pct`; amber from `warnAt`. */
export function meterSvg(pct: number, w: number, warnAt = 80): string {
  const p = Math.max(0, Math.min(100, pct))
  const [from, to] = p >= warnAt ? WARN : GOOD
  const fill = Math.max(p > 0 ? METER_H : 0, Math.round((w * p) / 100))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${METER_H}" viewBox="0 0 ${w} ${METER_H}">
<defs><linearGradient id="cd-meter-fill" x1="0" x2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
<linearGradient id="cd-meter-gloss" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect width="${w}" height="${METER_H}" rx="${METER_H / 2}" fill="${TRACK}"/>
${fill > 0 ? `<rect width="${fill}" height="${METER_H}" rx="${METER_H / 2}" fill="url(#cd-meter-fill)"/><rect width="${fill}" height="${METER_H / 2}" rx="${METER_H / 4}" fill="url(#cd-meter-gloss)"/>` : ''}
</svg>`
}

/** Five rounded segments, the first `level` filled with the emerald-to-teal gradient: the effort gauge. */
export function effortSvg(level: number, w: number): string {
  const gap = 2
  const seg = (w - gap * 4) / 5
  const rects = Array.from({ length: 5 }, (_, i) => {
    const x = Math.round(i * (seg + gap) * 10) / 10
    return `<rect x="${x}" width="${Math.round(seg * 10) / 10}" height="${METER_H}" rx="${METER_H / 2}" fill="${i < level ? 'url(#cd-effort-fill)' : TRACK}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${METER_H}" viewBox="0 0 ${w} ${METER_H}">
<defs><linearGradient id="cd-effort-fill" gradientUnits="userSpaceOnUse" x1="0" x2="${w}"><stop offset="0" stop-color="${GOOD[0]}"/><stop offset="1" stop-color="${GOOD[1]}"/></linearGradient></defs>
${rects}
</svg>`
}

type Px = [x: number, y: number]

// Eight body colours that read on light and dark.
const HUES = ['#dc2626', '#ea580c', '#eab308', '#16a34a', '#0d9488', '#2563eb', '#9333ea', '#db2777']
const INK = '#2b1d16'

export const hueColor = (hue: number) => HUES[((hue % HUES.length) + HUES.length) % HUES.length]!

const span = (y: number, from: number, to: number): Px[] => Array.from({ length: to - from + 1 }, (_, i) => [from + i, y] as Px)

/** One frame on a 16 by 12 grid: 0 stands, 1 hops with its legs moved, 2 blinks, 3 raises both claws. */
function crab(frame: number): { body: Px[]; eyes: Px[] } {
  const dy = frame === 1 ? 0 : 1
  const up = frame === 3
  const body: Px[] = [...span(1, 3, 12), ...span(2, 3, 12), ...span(3, 3, 12), ...(up ? span(4, 3, 12) : span(4, 1, 14)), ...(up ? span(5, 3, 12) : span(5, 1, 14)), ...span(6, 3, 12), ...span(7, 3, 12)]
  if (up) body.push([1, 2], [2, 2], [1, 3], [2, 3], [13, 2], [14, 2], [13, 3], [14, 3])
  for (const x of frame % 2 === 1 ? [3, 5, 10, 12] : [4, 6, 9, 11]) body.push([x, 8], [x, 9])
  const eyes: Px[] = frame === 2 ? [[5, 4], [10, 4]] : [[5, 3], [5, 4], [10, 3], [10, 4]]
  const move = (p: Px): Px => [p[0], p[1] + dy]
  return { body: body.map(move), eyes: eyes.map(move) }
}

const cache = new Map<string, string>()

const frameRects = (hue: number, frame: number) => {
  const { body, eyes } = crab(frame)
  const has = new Set(body.map(([x, y]) => `${x},${y}`))
  const ring = new Set<string>()
  for (const [x, y] of body) {
    for (const [ax, ay] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Px[]) if (!has.has(`${ax},${ay}`)) ring.add(`${ax},${ay}`)
  }
  const rect = (x: number, y: number, c: string) => `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${c}"/>`
  return [
    ...[...ring].map(k => rect(Number(k.split(',')[0]), Number(k.split(',')[1]), INK)),
    ...body.map(([x, y]) => rect(x, y, hueColor(hue))),
    ...eyes.map(([x, y]) => rect(x, y, INK)),
  ].join('')
}

/**
 * A pixel crab in one of eight colours, outlined so every colour reads. Animated, its four frames
 * cycle in the SVG itself (SMIL), not on the pane's redraws; a surface without SMIL shows frame 0.
 */
export function crabSvg(hue: number, isAnimated: boolean): string {
  const key = `${((hue % HUES.length) + HUES.length) % HUES.length}:${isAnimated}`
  const hit = cache.get(key)
  if (hit) return hit
  const frames = isAnimated
    ? [0, 1, 2, 3]
        .map(f => {
          const values = [0, 1, 2, 3].map(i => (i === f ? 1 : 0)).join(';')
          return `<g opacity="${f === 0 ? 1 : 0}"><animate attributeName="opacity" values="${values}" keyTimes="0;0.25;0.5;0.75" calcMode="discrete" dur="1.6s" repeatCount="indefinite"/>${frameRects(hue, f)}</g>`
        })
        .join('')
    : frameRects(hue, 0)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 13" width="${PET_PX_W}" height="${PET_PX_H}" shape-rendering="crispEdges">${frames}</svg>`
  cache.set(key, svg)
  return svg
}

// ---------------------------------------------------------------- message flow

/** `chips`: the agent's busiest tools, like `bash ×5`, under its box. */
export type FlowNode = { id: string; label: string; hue: number; isLive: boolean; chips?: string }
/** `isLive`: a loop at either end is running; its arrow is dashed and, with `isAnimated`, the dashes move. */
export type FlowEdge = { from: string; to: string; count: number; isLive?: boolean }

// 4.8:1 on a light background and 3.5:1 on a dark one; #9ca3af was 2.5:1 on light.
const LINE = '#6b7280'
const clean = (s: string) => s.replace(/[<>&"]/g, '')

/**
 * The main loop on top, the agents in a row under it, and an arrow for each sender and recipient
 * with the number of messages on it. Agent-to-agent arrows loop under the row; a node that is
 * running is drawn solid, a finished one dimmed.
 */
export function flowSvg(nodes: readonly FlowNode[], edges: readonly FlowEdge[], w = 520, isAnimated = true): string {
  const NW = 78
  const NH = 22
  const ROW = 70
  const agents = nodes.filter(n => n.id !== 'main')
  const at = new Map<string, number>([['main', w / 2]])
  agents.forEach((n, i) => at.set(n.id, ((i + 0.5) * w) / agents.length))
  const topOf = (id: string) => (id === 'main' ? 4 : ROW)
  const drawn = edges.filter(e => at.has(e.from) && at.has(e.to) && e.from !== e.to)
  const hasSide = drawn.some(e => e.from !== 'main' && e.to !== 'main')
  const hasChips = agents.some(n => n.chips)
  const chipH = hasChips ? 14 : 0
  const h = ROW + NH + chipH + (hasSide ? 34 : 6)
  const arrows = drawn.map(e => {
    const x1 = at.get(e.from)!
    const x2 = at.get(e.to)!
    // Dashes mark a live link; moving ones (SMIL) mark the direction it flows.
    const dash = e.isLive ? ` stroke-dasharray="5 4"` : ''
    const flow = e.isLive && isAnimated ? '<animate attributeName="stroke-dashoffset" from="9" to="0" dur="0.7s" repeatCount="indefinite"/>' : ''
    const label = (x: number, y: number) => `<text x="${x}" y="${y}" font-size="10" text-anchor="middle" fill="${LINE}">${e.count}</text>`
    if (e.from === 'main' || e.to === 'main') {
      // Two arrows between the same pair would overlap: each leans to its own side.
      const lean = e.from === 'main' ? -3 : 3
      const [y1, y2] = e.from === 'main' ? [4 + NH, ROW] : [ROW, 4 + NH]
      return `<line x1="${x1 + lean}" y1="${y1}" x2="${x2 + lean}" y2="${y2}" stroke="${LINE}" stroke-width="1.5"${dash} marker-end="url(#cd-flow-arrow)">${flow}</line>${label((x1 + x2) / 2 + lean * 3, (y1 + y2) / 2 + 3)}`
    }
    const y = ROW + NH + chipH
    return `<path d="M${x1} ${y} Q${(x1 + x2) / 2} ${y + 36} ${x2} ${y}" fill="none" stroke="${LINE}" stroke-width="1.5"${dash} marker-end="url(#cd-flow-arrow)">${flow}</path>${label((x1 + x2) / 2, y + 26)}`
  })
  const boxes = nodes.map(n => {
    const cx = at.get(n.id)
    if (cx === undefined) return ''
    const isMain = n.id === 'main'
    const color = isMain ? GOOD[0] : hueColor(n.hue)
    return `<g opacity="${n.isLive || isMain ? 1 : 0.55}"><rect x="${cx - NW / 2}" y="${topOf(n.id)}" width="${NW}" height="${NH}" rx="6" fill="${TRACK}" stroke="${color}" stroke-width="1.5"/><text x="${cx}" y="${topOf(n.id) + 15}" font-size="11" text-anchor="middle" fill="${LINE}">${clean(n.label)}</text>${n.chips ? `<text x="${cx}" y="${ROW + NH + 11}" font-size="9" text-anchor="middle" fill="${LINE}">${clean(n.chips)}</text>` : ''}</g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><marker id="cd-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="${LINE}"/></marker></defs>${arrows.join('')}${boxes.join('')}</svg>`
}

// ---------------------------------------------------------------- the plan bar (0.7.0, from plan-bar)

export const PLAN_G_LIGHT = '#34d399'
export const PLAN_G_MID = '#10b981'
export const PLAN_G_DEEP = '#0f766e'
export const PLAN_WARN = '#eab308'
export const PLAN_FAIL = '#ef4444'
export const PLAN_H = 14
const CELL = 3
const SEG_GAP = 3

type PlanBarStep = { status: 'pending' | 'in_progress' | 'completed' | 'failed'; frac?: number; added?: boolean }

// Fixed noise, so the sparkles sit still between redraws and only their CSS twinkle moves.
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** Twinkle classes s0 to s3, out of phase; `slow` for a finished bar. */
const twinkleCss = (slow: boolean) =>
  `.s0,.s1,.s2,.s3{animation:tw ${slow ? 3.2 : 2.1}s ease-in-out infinite}` +
  `.s1{animation-duration:${slow ? 3.8 : 2.7}s;animation-delay:-.7s}.s2{animation-duration:${slow ? 4.4 : 1.8}s;animation-delay:-1.3s}` +
  `.s3{animation-duration:${slow ? 3.5 : 3.1}s;animation-delay:-.4s}` +
  `@keyframes tw{0%,100%{opacity:.95}50%{opacity:${slow ? 0.55 : 0.15}}}`

/** Dither squares over `w` by `h` pixels: sparse at the left, dense at the right. */
function sparkles(w: number, h: number, size: number, base: number, rise: number): string {
  const cols = Math.floor(w / CELL)
  const rows = Math.max(1, Math.floor(h / CELL))
  const out: string[] = []
  for (let c = 0; c < cols; c++) {
    const density = base + rise * Math.pow(c / Math.max(1, cols), 1.3)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) {
        out.push(`<rect class="s${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 0.5}" y="${r * CELL + (h - rows * CELL) / 2 + 0.5}" width="${size}" height="${size}"/>`)
      }
    }
  }
  return out.join('')
}

/**
 * The plan bar: one emerald-to-teal segment per step (red when failed, an amber foot when added late), the
 * step in progress glowing and filled as far as `frac`, sparkles and a sheen over the fill, and the
 * `label` pill riding at the head. Its title is the panel's header, not drawn here. 0.8.0: `hasPill` false
 * leaves the pill out (the pane draws the count in its header, where it overlaps no segment).
 */
export function planSvg(steps: readonly PlanBarStep[], label: string, w: number, hasPill = true): string {
  const n = steps.length
  const done = steps.filter(st => st.status === 'completed').length
  const cur = steps.find(st => st.status === 'in_progress')
  const fillW = n ? Math.round(w * Math.min(1, (done + (cur?.frac ?? 0)) / n)) : 0
  const gap = n > 1 ? SEG_GAP : 0
  const segW = n ? (w - gap * (n - 1)) / n : w
  const r10 = (x: number) => Math.round(x * 10) / 10
  const segs = steps
    .map((st, i) => {
      const x = r10(i * (segW + gap))
      const rect = (sw: number, extra: string) => `<rect x="${x}" width="${r10(sw)}" height="${PLAN_H}" rx="2.5" ${extra}/>`
      return [
        rect(segW, 'class="k"'),
        st.status === 'completed' ? rect(segW, 'fill="url(#cd-plan-g)"') : '',
        st.status === 'failed' ? rect(segW, `fill="${PLAN_FAIL}"`) : '',
        st.status === 'in_progress' ? rect(segW, `class="lv" fill="${PLAN_G_MID}"`) : '',
        st.status === 'in_progress' && st.frac ? rect(segW * st.frac, 'fill="url(#cd-plan-g)"') : '',
        st.added ? `<rect x="${x}" y="${PLAN_H - 3}" width="${r10(segW)}" height="3" fill="${PLAN_WARN}"/>` : '',
      ].join('')
    })
    .join('')
  const pillW = Math.round(18 + label.length * 6.4)
  const pillX = Math.max(0, Math.min(w - pillW, fillW - pillW))
  const finished = n > 0 && done === n
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${PLAN_H}" viewBox="0 0 ${w} ${PLAN_H}">
<style>
.k{fill:#ece9fb}
@media (prefers-color-scheme: dark){.k{fill:#2a2640}}
${twinkleCss(finished)}
.lv{animation:gl 1.6s ease-in-out infinite}@keyframes gl{0%,100%{opacity:.18}50%{opacity:.5}}
.sh{animation:sw 2.6s linear infinite}@keyframes sw{from{transform:translateX(-70px)}to{transform:translateX(${fillW + 70}px)}}
@media (prefers-reduced-motion: reduce){.s0,.s1,.s2,.s3,.lv,.sh{animation:none}}
</style>
<defs>
<linearGradient id="cd-plan-g" gradientUnits="userSpaceOnUse" x1="0" x2="${w}"><stop offset="0" stop-color="${PLAN_G_LIGHT}"/><stop offset=".55" stop-color="${PLAN_G_MID}"/><stop offset="1" stop-color="${PLAN_G_DEEP}"/></linearGradient>
<linearGradient id="cd-plan-s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="cd-plan-c"><rect width="${w}" height="${PLAN_H}" rx="${PLAN_H / 2}"/></clipPath>
<clipPath id="cd-plan-f"><rect width="${fillW}" height="${PLAN_H}"/></clipPath>
</defs>
<g clip-path="url(#cd-plan-c)">
${segs}
<g fill="#ffffff">${sparkles(fillW, PLAN_H, 1.6, 0.12, 0.4)}</g>
${fillW > 0 && !finished ? `<g clip-path="url(#cd-plan-f)"><rect class="sh" width="70" height="${PLAN_H}" fill="url(#cd-plan-s)"/></g>` : ''}
</g>
${
    hasPill
      ? `<rect x="${pillX}" width="${pillW}" height="${PLAN_H}" rx="${PLAN_H / 2}" fill="${PLAN_G_DEEP}"/>
<text x="${pillX + pillW / 2}" y="${PLAN_H / 2 + 4}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif" font-size="11" font-weight="600" fill="#ffffff">${label.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)}</text>`
      : ''
  }
</svg>`
}

export const LANE_H = 10

/**
 * One agent lane in the plan bar's look: a rounded track and, where the agent lived on the shared time axis,
 * an emerald bar (red when failed, dimmed once finished). `geo` is lanes()' cells; a running bar glows and shimmers.
 */
export function laneSvg(geo: { before: number; bar: number; after: number }, status: string, w: number): string {
  const total = Math.max(1, geo.before + geo.bar + geo.after)
  const bw = Math.max(LANE_H, Math.round((w * geo.bar) / total))
  const bx = Math.min(Math.round((w * geo.before) / total), w - bw)
  const running = status === 'running'
  const fill = status === 'failed' ? PLAN_FAIL : 'url(#cd-lane-g)'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LANE_H}" viewBox="0 0 ${w} ${LANE_H}">
<style>
.k{fill:#ece9fb}
@media (prefers-color-scheme: dark){.k{fill:#2a2640}}
.lv{animation:gl 1.6s ease-in-out infinite}@keyframes gl{0%,100%{opacity:.15}50%{opacity:.45}}
.sh{animation:sw 2.2s linear infinite}@keyframes sw{from{transform:translateX(-40px)}to{transform:translateX(${w + 40}px)}}
@media (prefers-reduced-motion: reduce){.lv,.sh{animation:none}}
</style>
<defs>
<linearGradient id="cd-lane-g" gradientUnits="userSpaceOnUse" x1="0" x2="${w}"><stop offset="0" stop-color="${PLAN_G_LIGHT}"/><stop offset=".55" stop-color="${PLAN_G_MID}"/><stop offset="1" stop-color="${PLAN_G_DEEP}"/></linearGradient>
<linearGradient id="cd-lane-s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="cd-lane-c"><rect width="${w}" height="${LANE_H}" rx="${LANE_H / 2}"/></clipPath>
<clipPath id="cd-lane-b-${bx}-${bw}"><rect x="${bx}" width="${bw}" height="${LANE_H}" rx="${LANE_H / 2}"/></clipPath>
</defs>
<g clip-path="url(#cd-lane-c)"><rect class="k" width="${w}" height="${LANE_H}"/>
<g opacity="${status === 'done' ? 0.7 : 1}"><rect x="${bx}" width="${bw}" height="${LANE_H}" rx="${LANE_H / 2}" fill="${fill}"/>
<rect x="${bx}" width="${bw}" height="${LANE_H / 2}" rx="${LANE_H / 4}" fill="#fff" opacity=".25"/></g>
${running ? `<g clip-path="url(#cd-lane-b-${bx}-${bw})"><rect class="lv" x="${bx}" width="${bw}" height="${LANE_H}" fill="${PLAN_G_MID}"/><rect class="sh" width="40" height="${LANE_H}" fill="url(#cd-lane-s)"/></g>` : ''}
</g>
</svg>`
}

/** A colour between `a` and `b`, both #rrggbb; `t` from 0 to 1: the terminal bar's gradient. */
export function mixHex(a: string, b: string, t: number): string {
  const at = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(at(a, i) + (at(b, i) - at(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

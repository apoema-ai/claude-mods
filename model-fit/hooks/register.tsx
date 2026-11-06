import type { EngineInterface, Register } from 'claude-code'

import {
  DEFAULTS,
  DEFAULT_RUBRIC,
  EFFORTS,
  MODELS,
  aliasOf,
  cacheNote,
  cut,
  decide,
  direction,
  drifted,
  fixedFor,
  guard,
  judgePrompt,
  label,
  oneLine,
  parseJudge,
  parseList,
  parseTrigger,
  type Alias,
  type Effort,
  type Rec,
  type Setting,
  type Trigger,
} from './core'

const NAME = 'model-fit'
const OFFER = { plugin: 'model-fit', key: 'offer' } as const
const TRIG = { plugin: 'model-fit', key: 'trigger' } as const
const AUTO = { plugin: 'model-fit', key: 'auto' } as const
const PAUSED = { plugin: 'model-fit', key: 'paused' } as const

// How long an Auto prompt waits for the Judge before the turn starts without a Recommendation.
const WAIT_MS = 3000
const JUDGE_TIMEOUT_MS = 8000
const GREEN = '#10b981'
const AMBER = '#eab308'

// `switched`: the shared switch is off, so the mod does nothing whatever the trigger says.
type Cfg = { trigger: Trigger; auto: boolean; guardTokens: number; models: Alias[]; efforts: Effort[]; rubricFile: string; switched: boolean }

let home = ''
// The Setting the engine last reported, or the one the mod set itself. A different report is the person's change.
let last: Setting | undefined
let paused = false
// A downgrade waits here for a second Recommendation that agrees.
let pending: Rec | undefined
let lastRec: Rec | undefined
// Applied on every main-chat request until the engine's own Setting matches: the current turn, and a fallback when a command is refused.
let hold: { model: Alias; effort: string } | undefined
// Auto's Switch, run after the turn ends.
let queued: Rec | undefined
// A main-chat turn is running, so a pressed Switch waits for it; the press is kept here.
let working = false
let pressed: { rec: Rec; go: boolean } | undefined
// The person's last prompt, never one of the mod's own continue notes. "Switch and go" needs one to exist.
let lastPrompt = ''
// The next submission is the mod's own continue note: no look, and it is not the last prompt.
let resending = false
// The context size at the last look, for the cache warning on the card.
let ctxTokens: number | undefined
// A newer prompt makes an older Judge answer stale.
let seq = 0

async function log($: EngineInterface, line: string) {
  try {
    const dir = `${home}/.claude/mods-logs`
    const path = `${dir}/${NAME}.log`
    let old = ''
    if (await $.fs.exists(path).catch(() => false)) old = String(await $.fs.read(path))
    else await $.process.run(['mkdir', '-p', dir])
    await $.fs.write(path, `${old}${new Date().toISOString()} ${line}\n`)
  } catch {
    // Logging must never break the session.
  }
}

function say($: EngineInterface, text: string) {
  try {
    $.ui.toast(cut(text, 140))
  } catch {
    // A toast is only a hint.
  }
}

// The settings live in the mod's own file: the host lists no /config rows for a plugin loaded from a folder.
const cfgDir = () => `${home}/.claude/mods`
const cfgPath = () => `${cfgDir()}/${NAME}.json`
// What the plugin's userConfig held when it loaded (an installed plugin); the file wins over it.
let base: Readonly<Record<string, unknown>> = {}

async function readStore($: EngineInterface): Promise<Record<string, unknown>> {
  try {
    if (!(await $.fs.exists(cfgPath()))) return {}
    const json = JSON.parse(String(await $.fs.read(cfgPath()))) as unknown
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
  } catch {
    // A broken file means the defaults, never a crash.
    return {}
  }
}

// The shared switches file: "model-fit": false turns the mod off in every chat, which /model-fit on|off writes.
const switchesPath = () => `${home}/.claude/mods/switches.json`

async function readSwitches($: EngineInterface): Promise<Record<string, unknown>> {
  try {
    if (!(await $.fs.exists(switchesPath()))) return {}
    const json = JSON.parse(String(await $.fs.read(switchesPath()))) as unknown
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
  } catch {
    // A broken file switches nothing off.
    return {}
  }
}

// On removes the key. False (and a log line) when the file cannot be written.
async function writeSwitch($: EngineInterface, on: boolean): Promise<boolean> {
  try {
    const json = await readSwitches($)
    if (on) delete json[NAME]
    else json[NAME] = false
    await $.process.run(['mkdir', '-p', cfgDir()])
    await $.fs.write(switchesPath(), `${JSON.stringify(json, null, 2)}\n`)
    return true
  } catch (err) {
    await log($, `write switches: ${String(err)}`)
    return false
  }
}

/** The settings now: the file over the plugin's options over the defaults. A switched-off mod reads as trigger off and Auto off. */
async function readCfg($: EngineInterface): Promise<Cfg> {
  const all = { ...base, ...(await readStore($)) }
  const switched = (await readSwitches($))[NAME] === false
  const v = (k: string): unknown => all[k]
  const models = parseList(String(v('models') ?? DEFAULTS.models), MODELS)
  const efforts = parseList(String(v('efforts') ?? DEFAULTS.efforts), EFFORTS)
  const guardTokens = Number(v('guardTokens') ?? DEFAULTS.guardTokens)
  return {
    trigger: switched ? 'off' : parseTrigger(v('trigger')),
    auto: !switched && v('auto') === true,
    switched,
    guardTokens: Number.isFinite(guardTokens) ? guardTokens : DEFAULTS.guardTokens,
    models: models.length ? models : [...MODELS],
    efforts: efforts.length ? efforts : [...EFFORTS],
    rubricFile: String(v('rubricFile') ?? ''),
  }
}

const isEffort = (e: string): e is Effort => (EFFORTS as readonly string[]).includes(e)

async function setting($: EngineInterface): Promise<Setting> {
  return { model: await $.session.model().catch(() => ''), effort: last?.effort ?? '' }
}

async function syncState($: EngineInterface, cfg: Cfg) {
  await $.state.set(TRIG, cfg.trigger)
  await $.state.set(AUTO, cfg.auto)
  await $.state.set(PAUSED, paused)
}

async function drawOffer($: EngineInterface, from: Setting | null, to: Rec | null, cfg?: Cfg, queuedBy?: 'switch' | 'go') {
  if (!queuedBy) pressed = undefined
  await $.state.set(OFFER, from && to ? { from, to, shown: true, ...(queuedBy ? { queued: queuedBy } : {}), ...(ctxTokens !== undefined ? { tokens: ctxTokens } : {}) } : null)
  if (cfg) await syncState($, cfg)
}

/** A Setting the mod did not set: the person changed it, so Auto stops until it is turned on again. */
async function checkDrift($: EngineInterface, now: Setting) {
  // The model the mod is still carrying: its own switch landing after the read-back gave up.
  const own = !!hold && aliasOf(now.model) === hold.model
  if (own && drifted(last, now)) {
    await log($, `/model ${hold?.model} landed late`)
    say($, `Model Fit: now ${label(now.model, now.effort)}.`)
  }
  if (own || !drifted(last, now)) {
    last = { model: now.model, effort: now.effort || last?.effort || '' }
    return
  }
  last = { model: now.model, effort: now.effort || last?.effort || '' }
  hold = undefined
  queued = undefined
  const cfg = await readCfg($)
  if (cfg.auto && !paused) {
    paused = true
    say($, 'Model Fit: Auto paused, you changed the model or effort. /model-fit auto on resumes it.')
  }
  await drawOffer($, null, null, cfg)
}

/** The Rubric the Judge follows: the file the option names, else the built-in copy. */
async function rubric($: EngineInterface, cfg: Cfg): Promise<string> {
  if (!cfg.rubricFile) return DEFAULT_RUBRIC
  try {
    return String(await $.fs.read(cfg.rubricFile)) || DEFAULT_RUBRIC
  } catch (err) {
    await log($, `rubric file: ${String(err)}`)
    return DEFAULT_RUBRIC
  }
}

/** A Recommendation for the new work: the skill table first, else one Haiku call. Null when there is none. */
async function recommend($: EngineInterface, cfg: Cfg, cur: Setting, subject: string, skill?: string): Promise<Rec | null> {
  const fixed = skill ? fixedFor(skill) : undefined
  if (fixed && cfg.models.includes(fixed)) {
    return { model: fixed, effort: isEffort(cur.effort) ? cur.effort : 'medium', keepEffort: true, reason: `${skill} is mapped to ${fixed}` }
  }
  const usage = await $.session.usage().catch(() => null)
  const turns = await $.session.turns().catch(() => undefined)
  const prompt = judgePrompt(await rubric($, cfg), cur, { subject, tokens: usage?.context.tokens, window: usage?.context.window, turns }, cfg.models, cfg.efforts)
  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 200, effort: 'low', timeoutMs: JUDGE_TIMEOUT_MS })
  if (!r.isAnswered) {
    await log($, `judge: ${r.reason}`)
    return null
  }
  const rec = parseJudge(r.text, cfg.models, cfg.efforts)
  if (!rec) await log($, `judge: unreadable reply: ${cut(r.text, 200)}`)
  return rec
}

/** Runs /model, and /effort when the session has it, then records the new Setting. A refusal leaves `hold` to carry the change. */
async function applySwitch($: EngineInterface, rec: Rec): Promise<boolean> {
  try {
    const ran = await $.command.run({ command: 'model', args: rec.model })
    // A command can answer without changing anything (a dialog-only command in the desktop app): read the model back.
    // On the queued path the switch lands a moment after the command answers, so keep reading for about a second.
    let now = await $.session.model().catch(() => '')
    for (let i = 0; i < 5 && aliasOf(now) !== rec.model; i++) {
      await $.clock.sleep(200)
      now = await $.session.model().catch(() => '')
    }
    if (aliasOf(now) !== rec.model) {
      hold = { model: rec.model, effort: rec.keepEffort ? '' : rec.effort }
      await log($, `/model ${rec.model} left the model at ${now || 'unknown'}: ${cut(oneLine(String((ran as { text?: unknown } | undefined)?.text ?? '')), 160)}`)
      return false
    }
    last = { model: rec.model, effort: last?.effort ?? '' }
    if (!rec.keepEffort) {
      const hasEffort = (await $.command.list().catch(() => [])).some(c => c.name === 'effort')
      if (hasEffort) {
        await $.command.run({ command: 'effort', args: rec.effort })
        last = { model: rec.model, effort: rec.effort }
        hold = undefined
      } else hold = { model: rec.model, effort: rec.effort }
    } else hold = undefined
    return true
  } catch (err) {
    // Refused (no idle moment, a limit): the turn hook keeps rewriting requests until the engine matches.
    hold = { model: rec.model, effort: rec.keepEffort ? '' : rec.effort }
    await log($, `switch: ${String(err)}`)
    return false
  }
}

async function runSwitch($: EngineInterface, rec: Rec) {
  const target = label(rec.model, rec.keepEffort ? '' : rec.effort)
  const ok = await applySwitch($, rec)
  await drawOffer($, null, null)
  // A refused /model and a slow one look the same here, so the toast says pending, not failed.
  say($, ok ? `Model Fit: now ${target}.` : `Model Fit: ${target} is pending. The model has not changed yet, so the requests are sent on ${target} until it does.`)
}

/** Switch and go: switch, then send a short note so the agent continues from its last reply on the new model. */
async function runGo($: EngineInterface, rec: Rec) {
  await runSwitch($, rec)
  if (!lastPrompt) {
    say($, 'Model Fit: switched, but there is no earlier reply to continue from.')
    return
  }
  resending = true
  const note = `[Model Fit] The model is now ${label(rec.model, rec.keepEffort ? '' : rec.effort)}. Continue from your last reply; do not repeat it.`
  await $.prompt.submit({ text: note }).catch(async err => {
    resending = false
    await log($, `continue note: ${String(err)}`)
  })
}

/** One look at the new work. Never changes the Setting unless Auto is on and not paused. */
async function look($: EngineInterface, cfg: Cfg, subject: string, skill?: string) {
  const mine = ++seq
  const cur = await setting($)
  let rec = await recommend($, cfg, cur, subject, skill).catch(async err => {
    await log($, `recommend: ${String(err)}`)
    return null
  })
  if (!rec || mine !== seq) return
  const usage = await $.session.usage().catch(() => null)
  ctxTokens = usage?.context.tokens
  rec = guard(cur, rec, usage?.context.tokens, cfg.guardTokens)
  lastRec = rec
  // A pressed Switch is waiting for the turn to end: a newer offer must not replace it.
  if (pressed) return
  const verdict = rec.keepEffort ? (direction(cur, rec) === 'same' ? {} : { act: rec }) : decide(cur, rec, pending)
  pending = verdict.pending
  if (!verdict.act) {
    await drawOffer($, null, null, cfg)
    return
  }
  if (cfg.auto && !paused) {
    // This turn's requests go out on the Recommendation; /model follows once the turn ends. The band shows the switch.
    hold = { model: verdict.act.model, effort: verdict.act.keepEffort ? '' : verdict.act.effort }
    queued = verdict.act
  }
  await drawOffer($, cur, verdict.act, cfg)
}

/**
 * After Auto is turned on or off. On: an open card is cleared, since Auto judges the next prompt itself.
 * Off: Auto's queued switch is cancelled, and a recommendation not yet applied stays up as a card to press.
 */
async function modeChanged($: EngineInterface) {
  const cfg = await readCfg($)
  const { value: offer = null } = await $.state.get(OFFER)
  if (cfg.auto || !offer) return drawOffer($, null, null, cfg)
  if (queued) {
    queued = undefined
    hold = undefined
  }
  const cur = await setting($)
  if (direction(cur, offer.to) === 'same') return drawOffer($, null, null, cfg)
  await drawOffer($, cur, offer.to, cfg)
}

/** Writes one setting to the file; false (and a log line) when it cannot be written. */
async function setCfg($: EngineInterface, field: string, value: string | boolean) {
  try {
    const store = await readStore($)
    store[field] = value
    await $.process.run(['mkdir', '-p', cfgDir()])
    await $.fs.write(cfgPath(), `${JSON.stringify(store, null, 2)}\n`)
    return true
  } catch (err) {
    await log($, `write settings: ${String(err)}`)
    return false
  }
}

const TRIGGER_WORDS: Record<string, Trigger> = { off: 'off', prompt: 'prompt', skill: 'skill' }
const NEXT_TRIGGER: Record<Trigger, Trigger> = { prompt: 'skill', skill: 'off', off: 'prompt' }

export const register: Register = (on, options) => {
  base = options
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME').catch(() => undefined)) || ($.plugin.root.split('/.claude/')[0] ?? '')
    await $.command.register({
      name: 'model-fit',
      description: 'Model Fit: show the check, turn the mod on or off in every chat, or set the trigger (off|prompt|skill) and Auto (on|off)',
      argumentHint: '[status|on|off|trigger off|trigger prompt|trigger skill|auto on|auto off]',
    })
    const cfg = await readCfg($)
    await syncState($, cfg)
    return next(e)
  })

  // Main-chat requests: watch for a Setting the person changed, and carry a held Setting until the engine matches it.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const seen: Setting = { model: e.model, effort: e.effort === undefined ? '' : String(e.effort) }
    if (last === undefined) last = seen
    else await checkDrift($, seen)
    if (!hold) return yield* next(e)
    const needModel = aliasOf(e.model) !== hold.model
    const needEffort = !!hold.effort && e.effort !== undefined && String(e.effort) !== hold.effort && isEffort(hold.effort)
    if (!needModel && !needEffort) {
      hold = undefined
      return yield* next(e)
    }
    return yield* next({ ...e, ...(needModel ? { model: hold.model } : {}), ...(needEffort ? { effort: hold.effort as Effort } : {}) })
  })

  // After the turn: Auto's queued Switch runs from a timer, outside the hook the turn waits on.
  on('turn.start', async (_, e, next) => {
    if (!e.agentId) working = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) working = false
    if (!e.agentId && pressed) {
      const { rec, go } = pressed
      pressed = undefined
      $.clock.after(0, () => {
        void (go ? runGo($, rec) : runSwitch($, rec)).catch(err => log($, `queued press: ${String(err)}`))
      })
    } else if (!e.agentId && queued) {
      const rec = queued
      queued = undefined
      $.clock.after(0, () => {
        void applySwitch($, rec).catch(err => log($, `queued switch: ${String(err)}`))
      })
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta) return next(e)
    if (resending) {
      resending = false
      return next(e)
    }
    const cfg = await readCfg($)
    await checkDrift($, await setting($))
    if (cfg.trigger === 'off') {
      await drawOffer($, null, null, cfg)
      return next(e)
    }
    let subject = e.text
    let skill: string | undefined
    if (e.command) {
      const name = e.command.name
      const info = (await $.command.list().catch(() => [])).find(c => c.name === name)
      // Built-in commands (/model, /clear) and this mod's own are not skills.
      if (name === 'model-fit' || !info || info.source === 'builtin') return next(e)
      skill = name
      subject = `/${name} ${e.command.args}`
      lastPrompt = e.text
    } else {
      lastPrompt = e.text
      if (cfg.trigger === 'skill') return next(e)
    }
    const run = look($, cfg, subject, skill).catch(err => log($, `look: ${String(err)}`))
    // Auto holds the prompt a moment so the turn can start on the Recommendation; otherwise nothing waits.
    if (cfg.auto && !paused) await Promise.race([run, $.clock.sleep(WAIT_MS)])
    return next(e)
  }).catch(async ($, e, next) => next(e)) // only advises: if it fails, the prompt still goes through

  // The model calling the Skill tool: the work changes mid-turn, so Auto's hold applies from the next request.
  on('tool.call', async ($, e, next) => {
    const args = e as unknown as { skill?: unknown; args?: unknown }
    if ((e.tool as string) === 'Skill' && !e.agentId && typeof args.skill === 'string') {
      const cfg = await readCfg($)
      if (cfg.trigger !== 'off') void look($, cfg, `skill ${args.skill} ${typeof args.args === 'string' ? args.args : ''}`, args.skill).catch(err => log($, `skill look: ${String(err)}`))
    }
    return next(e)
  }).catch(async ($, e, next) => next(e)) // only advises: if it fails, the tool call still goes ahead

  // One command: on and off switch the mod in every chat; trigger and auto change its settings.
  on('command.run', { command: 'model-fit' }, async ($, e) => {
    const [verb = '', arg = ''] = (e.args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!verb || verb === 'status') return { text: await statusText($) }
    if (verb === 'on' || verb === 'off') {
      if (!(await writeSwitch($, verb === 'on'))) return { text: 'Model Fit: could not write ~/.claude/mods/switches.json; see ~/.claude/mods-logs/model-fit.log.' }
      const cfg = await readCfg($)
      if (cfg.switched) {
        hold = undefined
        queued = undefined
        pressed = undefined
      }
      await drawOffer($, null, null, cfg)
      return { text: verb === 'on' ? 'Model Fit is on.' : 'Model Fit is off in every chat. Type /model-fit on to turn it on again.' }
    }
    if (verb === 'auto') {
      if (arg !== 'on' && arg !== 'off') return { text: 'Usage: /model-fit auto on|off' }
      if (!(await setCfg($, 'auto', arg === 'on'))) return { text: 'Model Fit: could not change Auto; see ~/.claude/mods-logs/model-fit.log.' }
      if (arg === 'on') paused = false
      await modeChanged($)
      return { text: `Model Fit: Auto ${arg}.` }
    }
    const trigger = verb === 'trigger' ? TRIGGER_WORDS[arg] : undefined
    if (!trigger) return { text: 'Usage: /model-fit [status|on|off|trigger off|prompt|skill|auto on|off]' }
    if (!(await setCfg($, 'trigger', trigger))) return { text: 'Model Fit: could not change the trigger; see ~/.claude/mods-logs/model-fit.log.' }
    await syncState($, await readCfg($))
    return { text: `Model Fit: trigger ${trigger}.` }
  })

  for (const [element, go] of [['fit-switch', false], ['fit-go', true]] as const) {
    on('ui.press', { plugin: NAME, element }, async ($, e) => {
      const { value: offer = null } = await $.state.get(OFFER)
      if (!offer) await log($, `${element} pressed with no offer in state`)
      else if (offer.queued) return { element: e.element }
      else if (working) {
        // The agent is busy: keep the press, show Queued, and switch when the turn ends.
        pressed = { rec: offer.to, go }
        await drawOffer($, offer.from, offer.to, undefined, go ? 'go' : 'switch')
      } else await (go ? runGo($, offer.to) : runSwitch($, offer.to)).catch(err => log($, `${element} press: ${String(err)}`))
      return { element: e.element }
    })
  }
  on('ui.press', { plugin: NAME, element: 'fit-dismiss' }, async ($, e) => {
    await drawOffer($, null, null)
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'fit-trigger' }, async ($, e) => {
    const cfg = await readCfg($)
    await setCfg($, 'trigger', NEXT_TRIGGER[cfg.trigger])
    await syncState($, await readCfg($))
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'fit-auto' }, async ($, e) => {
    const cfg = await readCfg($)
    // "Auto: paused" resumes Auto; otherwise the press turns it on or off.
    if (!(cfg.auto && paused)) await setCfg($, 'auto', !cfg.auto)
    paused = false
    await modeChanged($)
    return { element: e.element }
  })

  // The band above the prompt: while a Mismatch is on offer, and all the time while Auto is on, so the trigger and Auto stay in reach.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: offer = null } = await $.state.get(OFFER)
    const { value: auto = false } = await $.state.get(AUTO)
    const o = offer?.shown ? offer : null
    if (!o && !auto) return next(e)
    const { value: trigger = DEFAULTS.trigger } = await $.state.get(TRIG)
    const { value: isPaused = false } = await $.state.get(PAUSED)
    // Auto makes the switch itself. Button has no disabled state, so its two are drawn as dim text.
    const autoActs = auto && !isPaused
    const now = o ? undefined : await setting($)
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const rest = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const { Box, Text, Button } = $.ui.resolve(e)
    // A cheaper pick is calm green; a stronger one is amber, because it costs more.
    const up = !!o && direction(o.from, o.to) === 'up'
    const accent = up ? AMBER : GREEN
    // The cache warning helps decide a press; Auto has already decided.
    const warn = o && !autoActs ? cacheNote(o.from, o.to, o.tokens) : null
    return (
      <Box flexDirection="column" rowGap="sm">
        {rest as never}
        <Box key="fit-band" flexDirection="column" rowGap="xs" borderStyle="round" borderColor={accent} paddingX={1} paddingY="xs">
          <Box key="fit-head" flexDirection="row" justifyContent="space-between">
            <Box key="fit-title" flexDirection="row" gap={1}>
              <Text color={accent} bold>
                ◆ Model Fit
              </Text>
              {o ? <Text color={accent}>{up ? '▲ stronger' : '▼ cheaper'}</Text> : null}
            </Box>
            {auto ? null : <Button key="fit-dismiss" label="✕" plain dimColor onPress={() => undefined} />}
          </Box>
          {o ? (
            <Box key="fit-move" flexDirection="row" gap={1}>
              <Text dimColor strikethrough>
                {label(o.from.model, o.from.effort)}
              </Text>
              <Text dimColor>→</Text>
              <Text bold color={accent}>
                {label(o.to.model, o.to.keepEffort ? '' : o.to.effort)}
              </Text>
            </Box>
          ) : (
            <Text key="fit-now" dimColor>
              {`Now: ${label(now?.model ?? '', now?.effort ?? '')}`}
            </Text>
          )}
          {o ? (
            <Text key="fit-why" dimColor italic wrap="wrap">
              {o.to.reason}
            </Text>
          ) : null}
          {warn ? (
            <Text key="fit-cache" color={AMBER} wrap="wrap">
              ⚠ {warn}
            </Text>
          ) : null}
          <Box key="fit-actions" flexDirection="row" gap={2}>
            {o?.queued ? (
              <Text key="fit-queued" dimColor>
                {o.queued === 'go' ? 'Queued: switches and continues from the last reply when the agent finishes' : 'Queued: switches when the agent finishes'}
              </Text>
            ) : autoActs ? (
              <Box key="fit-buttons-off" flexDirection="row" gap={2}>
                <Text key="fit-switch-off" dimColor>
                  Switch
                </Text>
                <Text key="fit-go-off" dimColor>
                  Switch and go
                </Text>
              </Box>
            ) : o ? (
              <Box key="fit-buttons" flexDirection="row" gap={2}>
                <Button key="fit-switch" label="Switch" onPress={() => undefined} />
                <Button key="fit-go" label="Switch and go" onPress={() => undefined} />
              </Box>
            ) : null}
            <Button key="fit-trigger" label={`Trigger: ${trigger}`} plain dimColor onPress={() => undefined} />
            <Button key="fit-auto" label={`Auto: ${auto ? (isPaused ? 'paused' : 'on') : 'off'}`} plain dimColor onPress={() => undefined} />
          </Box>
          {isPaused ? (
            <Text key="fit-paused" color={AMBER} wrap="wrap">
              Auto is paused because you changed the model or effort. Press Auto: paused, or run /model-fit auto on, to resume it.
            </Text>
          ) : null}
        </Box>
      </Box>
    )
  })
}

async function statusText($: EngineInterface): Promise<string> {
  const cfg = await readCfg($)
  const cur = await setting($)
  return [
    cfg.switched ? 'Model Fit is off in every chat. Type /model-fit on to turn it on again.' : 'Model Fit is on. Type /model-fit off to turn it off.',
    `Setting: ${label(cur.model, cur.effort)}`,
    `Trigger: ${cfg.trigger}`,
    `Auto: ${cfg.auto ? (paused ? 'on, paused (you changed the model or effort)' : 'on') : 'off'}`,
    lastRec ? `Last Recommendation: ${label(lastRec.model, lastRec.keepEffort ? '' : lastRec.effort)}. ${lastRec.reason}` : 'Last Recommendation: none yet',
  ].join('\n')
}

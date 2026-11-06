# model-fit: design spec

**Status:** design approved, not built. **Date:** 2026-11-05.
Terms in bold are defined in [GLOSSARY.md](../GLOSSARY.md).

## Goal

A Claude Code mod that checks whether the main chat's **Setting** (its model and effort) fits the task in front of it. When the **Recommendation** differs from the Setting (a **Mismatch**), it shows a **Switch** button. An **Auto** toggle lets the mod make the Switch itself.

## Packaging

- A plugin of its own, published through the `apoema-claude-mods` marketplace. It shares no code or state with chat-deck or any other mod.
- Built like the existing mods: `.claude-plugin/plugin.json` (with `userConfig`), `hooks/hooks.json`, `hooks/register.tsx`, `hooks/register.test.tsx`, `types/`, `tsconfig.json`, `README.md`.
- The README says what the mod sends: when the Trigger is not Off, it sends the new prompt and a short session digest to Haiku through the session's own API client, runs `/model` and `/effort`, and writes a log to `~/.claude/mods-logs/model-fit.log`.

## Scope

- Main chat only. Subagents are never judged or switched.
- Models it may recommend: Haiku 5.5 (clearly trivial work only), Sonnet 5.5, Opus 5.5. Fable is excluded.
- Effort levels it may recommend: `low`, `medium`, `high`, `xhigh`. Never `max`, never fast mode.
- No savings estimate is shown: the reason line only.

## Trigger

| Value | When the mod looks for a Mismatch |
|---|---|
| Off | Never. No Judge calls, no band, Auto idle, the Setting is never touched. |
| Each prompt (default) | On every `prompt.submit` of the main chat, and also whenever a skill starts (it includes On skill). |
| On skill | When the person types `/<skill>` (seen on `prompt.submit` as a command) or the model calls the Skill tool (seen on `tool.call`). |

## How a Recommendation is made

1. **Fixed skill** (when a skill starts, under On skill or Each prompt): if the skill is in the Rubric's skill-to-model table, the model comes straight from the table and effort stays as it is. No Judge call, no two-in-a-row wait; the cache guard still applies.
2. Otherwise the **Judge** runs: one `$.model.complete({ model: "haiku", ... })` call. Its input is the new prompt (or skill name and args), recent turn stats (tool calls, files touched, context size) and the current Setting. It returns a model, an effort and a one-line reason naming the signal that fired.
3. **Rubric**: the built-in default is a copy of the author's CLAUDE.md model policy as of 2026-11-05, stored in the plugin: the haiku / sonnet / opus table, the runtime escalation signals for opus, and the superpowers skill-to-model table. The mod never reads the installer's CLAUDE.md. When the `rubricFile` option names a Markdown file, its text replaces the built-in Rubric.

### Guards

- **Upgrades** (to a stronger model or higher effort) count at once.
- **Downgrades** count only when two Recommendations in a row agree.
- **Cache guard:** no Recommendation of a cheaper *model* while the context is over `guardTokens` (80,000 by default), because `/model` drops the prompt cache. It applies to Fixed skills too. Lowering effort alone is still allowed.
- **Failure:** if the Judge fails, times out or returns something unreadable, nothing is shown and the Setting is left alone; one line goes to the log.

## Switch

- **Button (Auto off):** runs `/model <model>` and `/effort <level>` through `$.command.run`. They are queued until the session is idle, so the Switch applies from the next prompt.
- **Auto on, Each prompt:** `prompt.submit` waits for the Judge for up to about 3 s. The current turn's requests are sent with the Recommendation through `turn.step` (`next({ ...e, model, effort })`), and `/model` and `/effort` are queued so the visible Setting matches once the turn ends. The band says what changes and why.
- **Auto on, On skill from the Skill tool:** the same, from that point in the turn: the turn's remaining requests go through `turn.step`, and `/model` is queued for after it.
- **Judge without Auto** is fire-and-forget from `prompt.submit`: the prompt is never held, and the band appears when the Judge returns.
- **Where the queued commands are issued:** `$.command.run` rejects calls made inside a hook the turn waits on, so `/model` and `/effort` are not issued from `prompt.submit` or `turn.step`. They are queued in `turn.complete` and issued from a `$.clock.after(0, ...)` timer, outside that hook. If the commands are refused, a `hold` keeps rewriting the main chat's requests through `turn.step` until the engine's Setting matches. Whether the timer escapes the refusal is untested; see the verify list.
- **Pause:** detected by state, not by command. On each `prompt.submit` the mod compares `$.session.model()` and the current effort with the last Setting it saw or set. A change the mod did not make (`/model`, the desktop app's model picker or effort control, anything else) pauses Auto for the rest of the session until it is turned back on.
- Auto may switch in both directions. The band shows each automatic Switch with the old and new Setting and the reason, until the next look.
- If `/effort` is not a slash command, effort is changed through `turn.step` on every request instead, and the band shows the effort actually used.

## User interface

- **Band above the prompt**, shown only on a Mismatch, styled like plan-bar: `Opus 5.5 · high → Sonnet 5.5 · medium   Reason: mechanical edits, no design work   [Switch] [Trigger: Each prompt ▾] [Auto ○] ✕`. ✕ hides it until the next Recommendation.
- **While Auto is on**, the band stays up all the time, so the Trigger and Auto stay in reach. With nothing to change it shows `Now: <Setting>`; after Auto acts it shows that switch and the reason. Switch and Switch and go are drawn as dim text that cannot be pressed (the mods `Button` has no disabled state), there is no ✕, and there is no cache warning, since Auto has already decided. While Auto is paused, a card's buttons work as with Auto off, and pressing `Auto: paused` resumes Auto. Otherwise the Auto button turns Auto on or off. Turning Auto on clears an open card, since Auto judges the next prompt itself. Turning Auto off cancels a switch Auto has queued for the turn's end, and a recommendation that differs from the Setting stays up as a card with live buttons; one Auto already applied clears.
- **`/model-fit`** shows whether the mod is on, the Setting, the Trigger, Auto (and whether it is paused) and the last Recommendation with its reason. `/model-fit on|off` switches the mod in every chat through `~/.claude/mods/switches.json`; `/model-fit trigger off|prompt|skill` sets the Trigger; `/model-fit auto on|off` sets Auto and clears a Pause.
- **Settings** in `~/.claude/mods/model-fit.json` (the plugin's `userConfig` supplies the defaults when it is installed), changed from the band and `/model-fit`. Built first on `$.config.set`, which found no row for the plugin when loaded from a folder:

| Key | Type | Default |
|---|---|---|
| `trigger` | `off` \| `prompt` \| `skill` | `prompt` |
| `auto` | boolean | `false` |
| `guardTokens` | number | `80000` |
| `models` | string | `haiku,sonnet,opus` |
| `efforts` | string | `low,medium,high,xhigh` |
| `rubricFile` | string | empty (built-in Rubric) |

- No status line entry.
- In the desktop app, `/config` opens a terminal dialog that the Code tab does not show, so there the band and `/model-fit` are the only controls. Both must cover every setting a person changes often (Trigger, Auto).

## Verification and release

1. `claude plugin validate`, the security scan, `tsc`, `claude plugin test` (with `register.test.tsx` covering the guards, the Fixed skill path, Pause and Judge failure).
2. A try-out with `claude --plugin-dir <path to model-fit>`. `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` is not edited.
3. Publishing to `apoema-claude-mods` only on the author's explicit go.

## Built 2026-11-05 (v0.1.0)

Checked in the API types: `turn.step` takes a rewritten `model` and `effort` on the main loop; a hook's own budget is 10 s and `$.model.complete` time does not count against it, so the 3 s Judge wait is safe; `$.config.set` changes a plugin's own rows. `claude plugin validate` and `tsc` pass. The suite has 29 tests: 11 of the pure logic in `tests/core.test.ts` and 18 of the hooks against a mocked engine in `tests/register.test.tsx`. The first live results are under "Live test 2026-11-05".

## To verify at build time

These come from the mods API types or are still assumptions, and are checked before code depends on them. Each item ends with its state after the first live test.

- Whether `/effort` exists as a slash command (`$.command.list()`). The CLI has `--effort`; the slash command was not found in the types. **Verified:** typing `/effort low` works, and a Switch ran `/effort medium` through `$.command.run` (the built-in printed "Set effort level to medium").
- That `turn.step` accepts a different `model` and `effort` on the main loop's requests. **Open:** only Auto and a refused `/model` use it, and neither has run live.
- Where the current effort is readable outside tool-use hooks (it is documented on tool-use contexts and the status line input), since Pause compares it on every prompt. **Open.**
- Which hook can issue `$.command.run` after a turn without being rejected as "inside a hook the turn waits on". **Partly verified:** a Switch and go press ran `/model opus`. Whether it ran from the `ui.press` hook or from the Queued path (`turn.complete` then `$.clock.after(0)`) is not known yet. Auto's queued switch is open.
- Whether `prompt.submit` has a time budget that a 3 s `await $.model.complete` would exceed (`turn.step` documents a hook budget). **Open:** only Auto waits on the Judge.
- That `/model <alias>` with an argument runs without a dialog in the desktop app, and that the app's model picker shows the change. The Switch depends on it. **Verified:** `/model opus` switched with no dialog, and `$.session.model()` read opus back (no log line). **Open:** the picker. Managed settings pin Sonnet 5.5, so a switch lasts for the session only and reverts on restart.

## Live test 2026-11-05

Desktop app, one session on Sonnet 5.5:

- A card showed from the Fixed-skill path. The agent called the Skill tool for `superpowers:systematic-debugging` mid-turn; `tool.call` then `fixedFor` gave opus with `keepEffort`, and no Judge call ran.
- Switch and go ran end to end. `/model opus` changed the model, and `$.prompt.submit` re-sent the last prompt with the `[Model Fit]` note, which started a new turn. The log stayed empty.
- model-fit's `prompt.submit` hook runs with `cc-plugin-sec-default` loaded. The re-send carried the person's prompt, and `lastPrompt` is set only in that hook. That rules the security plugin out as the cause of the missing card in the long chat on Opus. Every remaining explanation is designed behaviour, not a bug:
  - the cache guard: over `guardTokens`, a cheaper model is kept;
  - on Opus every cheaper pick is a downgrade, and a downgrade needs two matching Recommendations in a row.
- A second session (Sonnet, 149k tokens of context) showed a Judge-driven card: sonnet → opus · high, with the Judge's reason and the cache warning. The card's rows had no space between them, the header and buttons sat on the border, and ✕ hugged the chip. It now has `rowGap="xs"` and `paddingY="xs"`, and ✕ sits at the right edge; re-checked live after a reload.
- Switch and go from that card ran `/model opus`, which read back with no log line, and sent the 0.2.0 continue note, which started a turn there.
- A third session showed a Judge-driven downgrade card to sonnet · medium. Switch and go ran `/model sonnet` and `/effort medium`, both printed by the built-ins, with no log line, then sent the continue note.
- The author reported that Auto works live. The details (the turn-end `/model`, the Pause) were not checked one by one.
- The band stayed up while Auto was paused, and pressing `Auto: paused` resumed Auto (the author's check after a reload).
- Queued, seen live: a Switch pressed while the agent worked showed Queued, and `/model opus` ran at turn end (from `turn.complete` then `$.clock.after(0)`). The model did change, but the read-back right after `/model` still saw `claude-sonnet-5-5`, so the log says `/model opus left the model at claude-sonnet-5-5` and a carrying `hold` was set. A false failure: on this path the switch lands after `$.command.run` resolves. Fixed: `applySwitch` now reads the model back up to five more times, 200 ms apart, before it reports a failure. Re-checked live: a queued Switch changed the model, the toast showed no failure, and the log gained no new line. A later live run still logged `/model sonnet left the model at claude-haiku-5-5` (the switch landed after the second), and when it landed the mod took it for the person's change and paused Auto. Fixed: a change to the model the mod is still carrying in `hold` is its own switch landing, so it updates the last Setting and does not pause. A Switch whose model has not landed within the second now shows "<target> is pending" rather than a failure, since a refused `/model` and a slow one look the same at that point. When it lands, the log gets `/model <model> landed late` and a "now <model>" toast confirms it (not re-checked live).
- The desktop model picker did not show the model after a mod Switch (the author's check), although `$.session.model()` reads the new model. The mods API has no call that sets the picker; the model-change events name their source (`command`, `picker`, `sdk`, `auto`, `resume`), so the picker is app UI the mod cannot reach. The person's own typed `/model` does refresh it, and prints a different line (`Set model to opus (claude-opus-5-5)` against the mod's `Set model to Opus 5.5 for this session only`). A plugin's `$.command.run` always carries `origin: { kind: 'plugin' }` and has no option to run as the person, so the host takes another path for it. Treated as a host limit: the band and the toast say the real model.
- Not seen yet:
  - the band while Auto acts: the `Now:` line and the dim Switch labels.
- Resolved in 0.2.0: Switch and go used to re-send the whole last prompt, so the agent redid that request from the top. It now sends a short `[Model Fit]` note telling the agent to continue from its last reply.
- Open design question: in the third session the agent's last reply asked the person a question, and the continue note made it act without the answer (it retried an edit that was blocked). The note starts a turn in the person's place, so it should not read as a go-ahead.

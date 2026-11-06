# model-fit

**Version:** 0.10.0

A Claude Code mod (function hooks, Claude Code 2.1.287+) that checks whether the chat's model and effort fit the task in front of it. When they do not, a band above the prompt offers a Switch button. An Auto toggle lets the mod switch by itself.

## What it sends, and what it changes

Unlike a read-only mod, model-fit acts. When the trigger is not `off`:

- it sends your new prompt (or the skill name and arguments) and a short digest of the session (prompt count, context size) to **Haiku**, through your own session's client and credentials, to get a recommendation;
- it runs `/model` and `/effort` for you when you press Switch, or when Auto is on;
- it writes problems to `~/.claude/mods-logs/model-fit.log`.

Nothing goes anywhere else. With the trigger set to `off` it makes no calls and never touches your model or effort. Auto is off by default.

## How it decides

- **Trigger** `prompt` (default) looks at every prompt and every skill start; `skill` only when a skill starts (typed `/skill` or called by the model); `off` never.
- A skill in the built-in table (the `superpowers:*` skills, for example `brainstorming` to opus) gets its model straight from the table, with no Haiku call and no change of effort.
- Anything else goes to the Judge, one Haiku call that follows the Rubric: a copy of the author's model policy (haiku for bounded mechanical work, sonnet by default, opus only for open-ended reasoning). Set `rubricFile` to a Markdown file to use your own rules.
- **Upgrades** show at once. **Downgrades** show only when two recommendations in a row agree.
- **Cache guard:** above `guardTokens` (80,000) no cheaper model is recommended, because `/model` drops the prompt cache. Lowering effort alone is still allowed.
- If the Judge fails or answers something unreadable, nothing is shown and your setting is left alone.

## Auto

With Auto on, the prompt waits up to 3 seconds for the Judge, the current turn's requests go out on the recommendation, and `/model` follows once the turn ends. A toast shows the before and after. If you change the model or effort yourself, Auto pauses for the rest of the session until you run `/model-fit auto on`.

## Use it

```
/plugin install model-fit@apoema-claude-mods
/reload-plugins
/model-fit
```

| Command | Does |
|---|---|
| `/model-fit` | Shows whether the mod is on, the setting, trigger, Auto and the last recommendation |
| `/model-fit on`, `off` | Turns the whole mod on or off in every chat. Off writes `"model-fit": false` to `~/.claude/mods/switches.json`; the mod reads it on each prompt, shows no band and makes no Judge call, whatever the trigger says. The trigger and Auto settings are kept. |
| `/model-fit trigger off`, `trigger prompt`, `trigger skill` | Sets the trigger. `trigger off` stops the looks but keeps the mod on; `/model-fit off` switches the mod off |
| `/model-fit auto on`, `auto off` | Sets Auto (on also ends a pause) |

The band holds the same controls: Switch (named for its target, `s`) on the left, Trigger (`t`) and Auto (`a`) on the right, and Collapse (`c`) and Dismiss (`x`) in the header. With Auto on there is no Switch to press: the card says `Auto switches to ...` instead. The model and effort read `opus | medium` in both views. **Collapse** (`c`) in its header folds it to one line: the model and effort as `opus | medium` (the effort is a dash until the chat's first request reports it), or the move from one pair to the other while an offer is up, the Switch button while an offer is up, the Auto state, and **Expand** (`c`). The reason, the cache warning, Trigger and Auto wait behind the toggle. The choice is kept in the settings file, so the band starts collapsed in the next chat too. Settings are kept in `~/.claude/mods/model-fit.json` (`trigger`, `auto`, `collapsed`, `guardTokens`, `models`, `efforts`, `rubricFile`); `/model-fit` and the band write it, and you can edit it by hand. The host lists no `/config` rows for a plugin loaded from a folder, so the file is the one place they live.

## Known limits

- It only judges the main chat; subagents keep the model they were launched with.
- It never recommends `max` effort, fast mode or Fable.
- Effort is changed with `/effort` when the session has it; otherwise through the next requests, and the new effort does not show in `/effort`.
- The built-in Rubric is the author's policy as of 2026-11-05, not your CLAUDE.md.
- Behaviour in the desktop app (the `/model` argument form, the model picker) is not yet checked.

## Version History

- **0.10.0**: every button has the same design as cache-timer's Keep warm: a secondary button with its key badge.
- **0.9.0**: the band matches cache-timer and chat-handoff on desktop: quiet controls carry key badges (Collapse `c`, Trigger `t`, Auto `a`, Dismiss `x`), the settings sit on the right, Auto on says what it does instead of a dim Switch, and the pair reads `opus | medium` in both views.
- **0.8.0**: one button hierarchy: `Switch to <model · effort>` is the primary (`s`, focused), the dismiss reads `Dismiss` (`x`) and is the close control on desktop; collapsed, the band shows the model and effort as `opus | medium`.
- **0.7.0**: Switch and go is gone; the card has one action, Switch, and the mod never sends a prompt.
- **0.6.0**: `/model-fit status` is gone; plain `/model-fit` shows the status.
- **0.5.0**: the band collapses to one line with a `▾`/`▸` toggle; the choice is kept in `model-fit.json`.
- **0.1.0**: first release.

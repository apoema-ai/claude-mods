# model-fit

**Version:** 0.1.0

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

With Auto on, the prompt waits up to 3 seconds for the Judge, the current turn's requests go out on the recommendation, and `/model` follows once the turn ends. A toast shows the before and after. If you change the model or effort yourself, Auto pauses for the rest of the session until you run `/modelfit auto on`.

## Use it

```
/plugin install model-fit@upgrade-claude-code-plugins-marketplace
/reload-plugins
/modelfit
```

| Command | Does |
|---|---|
| `/modelfit` | Shows the setting, trigger, Auto and the last recommendation |
| `/modelfit off`, `prompt`, `skill` | Sets the trigger |
| `/modelfit auto on`, `auto off` | Sets Auto (on also ends a pause) |
| `/model-fit on`, `off`, `status` | Turns the whole mod on or off in every chat. Off writes `"model-fit": false` to `~/.claude/mods/switches.json`; the mod reads it on each prompt, shows no band and makes no Judge call, whatever the trigger says. The trigger and Auto settings are kept. |

The band holds the same controls: Switch, Trigger, Auto and a dismiss button. Settings are kept in `~/.claude/mods/model-fit.json` (`trigger`, `auto`, `guardTokens`, `models`, `efforts`, `rubricFile`); `/modelfit` and the band write it, and you can edit it by hand. The host lists no `/config` rows for a plugin loaded from a folder, so the file is the one place they live.

## Known limits

- It only judges the main chat; subagents keep the model they were launched with.
- It never recommends `max` effort, fast mode or Fable.
- Effort is changed with `/effort` when the session has it; otherwise through the next requests, and the new effort does not show in `/effort`.
- The built-in Rubric is the author's policy as of 2026-11-05, not your CLAUDE.md.
- Behaviour in the desktop app (the `/model` argument form, the model picker) is not yet checked.

## Version History

- **0.1.0**: first release.

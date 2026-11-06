# cache-timer

A Claude Code mod. Draws a band above the prompt that counts down until the chat's prompt cache goes cold, and can keep the cache warm with a small background ping.

Tested with Claude Code 2.1.318 (mods API, early access).

## Install

```
/plugin marketplace add <owner>/<repo>
/plugin install cache-timer@apoema-claude-mods
```

## What it does

- Warm: one line, `◷ Cache warm 3:42`, a bar drawn like plan-bar's, the cached token count and the cache length. The bar is split into three blocks (`█` cells with a blank between the blocks on the terminal, three rounded segments on desktop), the way plan-bar draws one block per step. Left to right they are the last third of the cache life, the middle third and the first third, filled from the left, so a draining bar loses its right side first. The palette is the third the countdown is in, drawn as one gradient across every block still filled, as if they were a single block: in the first third all three blocks are one green gradient (dark to light), in the middle third the first two are one orange-to-yellow gradient and the third is empty, in the last third the first block is dark red to orange. Used-up cells are dim `░`. The `Cache warm` label takes a strong colour for the third the countdown is in (green, orange, dark red). Buttons: Keep warm (`w`) and Hide (`h`); the letters are hotkeys while the band has focus. Cold, Rewarm now asks for a second press, `Confirm: write N tokens`. Every button in this mod, model-fit and chat-handoff has this same design, and each band sits in a rounded border, as model-fit's does, in the colour of its state (the countdown's third while warm, the cold colour when cold or reset).
- Cold: `❄ Cache cold · went cold 7 min ago`, with how many tokens your next message writes to the cache again. Button: `Rewarm now`, which asks for a second press (`Confirm: write 84k tokens`) within 8 s, because a rewarm writes the whole chat to the cache at the write price.
- Reset: `↻ Cache reset by switching to opus-5-5 · your next message writes 150k tokens to it again`. Each model has its own cache and a compaction replaces the history, so after a model switch (while the cache was still warm), a `/compact` or an auto-compaction the countdown would promise a discount the next request does not get. The band says so instead, stops keep warm (a ping on the old schedule would write the whole chat unasked), and goes back to the countdown when the next main-chat reply completes. A model restored on resume, a switch after the cache had already lapsed, and a subagent's own compaction change nothing. `/cache-timer warm` on a reset cache explains the write like on a cold one, and `/cache-timer warm now` rewarms it at once. The cache TTL rules this follows are on [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets).
- Reset, after the fact: the warning above needs the `classic.PostModelSwitch` and `classic.PostCompact` hook events, and a plugin earlier in the hook chain can keep those from reaching this mod (seen with `cc-plugin-sec-default`: Claude Code reports the hook as skipped). So after every main-chat reply the mod also reads the transcript: if the turn's first request was sent while the band said warm, yet wrote more to the cache than it read (at least 10k tokens, and under half of what was cached), a bottom line, under the countdown and the keep-warm line, says `↻ The cache had been reset (a model switch, a compaction or similar), so that reply wrote 104k tokens to it again` until the next reply. This only reports the write once it has happened; it cannot warn before it. A transcript over 20 MB is not read, so a very long chat gets no such line.
- Keep warm (`/cache-timer warm`, or the button): one tiny background ping about 45 s before the cache goes cold. Its line shows the ping count out of 30, what the last ping read, the total read so far, and when it stops by itself. It stops after 2 hours, 30 successful pings, 3 failed pings in a row, or when you send a message. Failed pings retry after 20 s and do not count toward the 30. `/cache-timer warm` again stops it.
- On a cold cache `/cache-timer warm` explains the write cost and does nothing; the band's Rewarm now button rewarms anyway, after a second press.
- The band's Hide button hides it in this chat; `/cache-timer on` brings it back. Hiding never hides keep warm: while it runs, a one-line chip (`◷ Keeping cache warm · ping 3/30 · next in 3:15`) with a Stop keeping warm button (`s`) stays.
- The keep-warm and cold lines follow your theme (`error`, `suggestion` theme colours), and the band fits its width: under 96 columns the bar shortens, under 84 the details go, under 56 the bar goes.

The cache length (5 min or 1 hour) is read by the mod itself, in TypeScript, from this chat's transcript (`~/.claude/projects/<project>/<session id>.jsonl`): the newest main-thread reply that wrote to the cache says which. Until a reply has set it, the band assumes 5 min. A transcript over 20 MB is not read, so a very long chat keeps the 5 min guess. There is no compiled helper, so it runs the same on macOS, Linux and Windows.

## Switchboard

The command has three actions:

| Command | Does |
|---|---|
| `/cache-timer on`, `/cache-timer off` | Turns the mod on or off in every chat. On also shows a band you hid in this chat |
| `/cache-timer` | Says whether the mod is on and whether keep warm is running |
| `/cache-timer warm` | Starts keep warm, or stops it when it runs |

`/cache-timer off` and `on` It writes `"cache-timer": false` to `~/.claude/mods/switches.json` (on removes the key) and reads that file every 3 seconds, so an open chat follows. Off stops keep warm too. You can hide just the band by hand with `"cache-timer:hidden": true` (the keep warm chip still shows while keep warm runs); the band's Hide button does the same for this chat only.

## Load it

```bash
claude --plugin-dir <path to cache-timer>
```

## Tests

```bash
claude plugin test <path to cache-timer>
```

## Not included (compared with the mod this is based on)

The Hand off button, the log file and the 60 s demo mode.

## Version History

- **0.13.0**: the band has the same padding as chat-handoff and model-fit (two columns each side, a little above and below).
- **0.12.0**: the band is framed in a rounded border, like model-fit's.
- **0.11.0**: every button has one design: a secondary button with its key badge.
- **0.10.0**: one button hierarchy; the stop button reads `Stop keeping warm` (`s`).
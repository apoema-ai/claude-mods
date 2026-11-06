# chat-handoff

A Claude Code mod. When a chat gets long, it writes a handoff of the whole chat so the work can continue in a fresh one. Based on the `handoff` mod in `benai-mods`.

Tested with Claude Code 2.1.314 (mods API, early access).

## Install

```
/plugin marketplace add <owner>/<repo>
/plugin install chat-handoff@apoema-claude-mods
```

## What it does

- At 250k tokens of context (you can change this, see below), a band above the prompt offers **Refresh** (or **Later**, which snoozes the offer for 40% of the threshold in more tokens: 100k at the default).
- Refresh runs three steps: gather the chat (messages, the files used that still exist, skills, and PR, ticket and artifact links), write the handoff, save and check. Only the running step shows a progress bar.
- The handoff is written by `$.model.fork`, which reuses the chat's prompt cache. The template keeps it under 900 words: one Status list (each goal done, in progress or not started), rules from this chat that are not in CLAUDE.md, at most 8 files, at most 5 solved errors, carried-over data and next steps.
- A plain draft is saved before the model step, so a failed model call still leaves something. The full handoff replaces the draft.
- Anything shaped like a key or token is removed before saving or copying: `sk-`, `ghp_`, `github_pat_`, Slack, Google, AWS (`AKIA`/`ASIA`) keys, JWTs and `Bearer` tokens.
- When it is ready, the steps collapse into one line (words, messages, files, time) with **Copy**, **New chat**, **Preview**, **Open file** and **Close**.
  - **Copy** uses the surface's clipboard, and falls back to `pbcopy` when that reports nothing was copied.
  - **Preview** opens a pane with the handoff drawn as markdown, with the same actions.
  - Confirmations (copied, new chat started) show as toasts.
  - When the model step took more than 15 s, a notification says the handoff is ready.
- The palette runs orange to yellow (`#ea580c`, `#f59e0b`, `#facc15`); failures use the theme's `error` color. The running step's bar is drawn as in Plan Bar: on the desktop app an SVG pill with an orange-to-yellow gradient and a moving shine, in the terminal gradient blocks with a blinking tip on a dim track. On the desktop app the title also uses heading size and the counters use fixed-width digits.
- Handoffs are saved in `~/.claude/handoffs/`. Every run adds a line to `~/.claude/handoffs/handoff.log`; a finished run also logs the fork's tokens (out, in, cache read, cache write). A large cache write means the cache had lapsed and the whole chat was billed afresh.

## Commands and tool

- `/chat-handoff`: write the handoff now.
- `/chat-refresh`: show the Refresh band now, whatever the token count.
- A `refresh` tool the model can call when you ask it to hand off. The band opens when its turn ends.

## Start new chat

- With Claude Pet running (`~/.claude/pet/pet.json` fresh), it leaves a request in `~/.claude/pet/requests/` and shows the pet's answer.
- Without it, it opens `claude://code/new?q=...`, which fills a new chat. Press Return there.

## Ask for a handoff from another mod

Another mod can ask for a handoff by leaving `~/.claude/handoffs/.request-<session id>`. This mod runs it and deletes the file.

## Switchboard

`/chat-handoff off` turns this mod off in every chat and `/chat-handoff on` turns it back on; `/chat-handoff status` says which, and `/chat-handoff` alone still writes a handoff now. It writes `"chat-handoff": false` to `~/.claude/mods/switches.json` (on removes the key) and reads that file every 3 seconds, so an open chat follows. To stop only the automatic offer, set `"chat-handoff:hidden": true` in that file by hand. `/chat-refresh` still works while hidden.

## Load it

```bash
claude --plugin-dir <path to chat-handoff>
```

## Change the threshold

`offerAtTokens` (default 250000, allowed 20000 to 1000000) is the context size at which the offer opens. Chats auto-compact near 300k to 324k, so a value above that never offers.

It is a `userConfig` field, so it can be set in the config menu, or in `~/.claude/settings.json`. For a plugin loaded with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` the key is `chat-handoff@inline`:

```json
"pluginConfigs": { "chat-handoff@inline": { "options": { "offerAtTokens": 150000 } } }
```

Later and Close wait for 40% of the threshold in more tokens (100k at the default, 60k at 150k). A change reloads the mod; the saved snooze of a chat that is already past the new threshold stays until its tokens drop.

## Tests

```bash
claude plugin test <path to chat-handoff>
```

## Differences from the original

- Commands are `/chat-handoff` and `/chat-refresh`, so both mods can be loaded.
- Home is read from `HOME`, not from the plugin path, so it works from any folder.
- Later on the offer snoozes it for this chat. The original wrote `handoff:hidden` into the shared file.
- No `mkdir` calls (`$.fs.write` creates folders) and no `.open-*` request file.

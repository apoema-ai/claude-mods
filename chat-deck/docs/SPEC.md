# chat-deck: spec (0.9.0)

0.9.0: config and panel toggles. `parseConfig` reads five options (`architectPattern`, `paneColumns`, `layout`, `palette`, `openOnStart`); `panels`, `maxCards`, `motion`, `moments`, `matchDescriptions`, `statusLine`, `architectLabel` and `gateLabel` are removed, `FIXED` in `core.ts` holds their old defaults (`ARCHITECT`, `GATE`, moments on, 3 cards, motion on, status line on, descriptions not matched), and a saved value is ignored. `View.hidden` and `View.panelsOpen` (both optional, read with `hiddenPanels`, which drops unknown names and repeats) hold the panels switched off and whether the row is open; `/chatdeck reset` and `/clear` keep both, as the person's choice and not session history. The drawn list is `PANELS` filtered by `hidden` and each panel's own empty rule, so header chips for a hidden panel are dropped too. The panels row (`panels-toggle` Button, hotkey `p`; `panel-<name>` Buttons, `● shown` or `○ hidden`, no hotkey) is a header-row button on every layout (the last child of the inline summary), with the list under the header while open; closed it is just `▸ panels` plus `· N hidden`; it is not a panel and has no button of its own; the footer lists `p panels`, the header's chips give up room to it, and the log's row estimate counts the open list. It is separate from `collapsed`, which folds a panel to its header. The plan tool and the git reads are no longer tied to a panel: `register` always starts both, and `refreshStatus` leaves the plan out of the status line while its panel is hidden.

0.8.0: the pane's chrome. Inside the `ui.render` Pane hook, `head(panel, w, name, detail, right, glyph)` draws every bordered card's header: a `fold-<panel>` Button (`▾`/`▸`), the name bold in `C.text` with ` · detail` dim as one Text (a single truncating Text of the same words when it does not fit), and a `Right` (`{ node, width }`, from `rightOf(pieces)` or built by hand for a clock or a Button) only where it fits; `card(panel, w, tone, header, body)` is the keyed Box (`panel-<panel>`) whose border is `toneColor(tone)` (`bad` warn, `attn` amber, `live` main, none faint) and whose body is left out while folded. `View` gains three optional fields: `collapsed` (panel names), `logErrors` and `planOpen`. `copyable(key, copyText, room, dim, display)` is a `tip-<key>` Box holding a `copy-<key>` Button labelled `midCut(display, room)` that runs `$.ui.copy` and a toast, and on a non-terminal surface a `position: absolute`, `display: none` Box revealed by `hover` with the whole text in rows of `room` cells. `midCut` (core) cuts in the middle in cells; `promptLine` adds an engine note's `<summary>` (or its text without tags) after its kind. Rows: `rowsOf` is the box rows plus one of air for every panel, 4 for a folded card; `column` puts one row of air before every panel but the one after `agents`. Wide: `leftCol` is main, plan, checks, git; `rightCol` agents, loops, receipt, files, comms; gate and architect go, in config order, to the shorter; `isLogRight` (the right column 10 or more rows shorter) draws the log at the foot of the right column with `min(20, spare - 4)` rows, else under both as before. The header's `chips` are Buttons (`attn-<key>`) that drop their panel from `collapsed`, run their `then` (the errors chip sets `logErrors`) and `$.ui.scroll({ to: { key: 'panel-<panel>' }, in: PANE })`; `CHAT DECK` is drawn on the terminal only. The receipt is empty while a turn runs unless it has slow calls or a review; the main card's right is `● working` with `clock('turn-clock')`. The gate is quiet (one `✓ N allowed by rule` row, no totals) while every recent check was a rule's and none asked or was denied. The plan header carries the count where `Svg` exists and it fits (`planSvg(…, hasPill = false)`), the line under the bar is `planLines`' one row (`this step · act · agents`; `PlanLineProps` loses `prev` and `totalSince`, in `plan.ts` and `plan-line.tsx` alike), and a `plan-steps` Button opens `plan-step-<i>` rows. A failed call without a reason is logged `✗ failed, no output · <call>`, which `splitFailure` reads. `PANELS` is reordered (main, plan, checks, git, agents, loops, receipt, files, comms, gate, architect, log) and the 0.7.0 default joins `OLD_DEFAULTS`.

0.7.0: the `plan` panel (from the plan-bar mod). `hooks/plan.ts` holds plan-bar's logic as `createPlanner(onChange)`, built in `register`: `start` (HOME, session id, registers the `plan` tool with `isDeferred: false` and takes the engine's name for it, loads a saved plan updated within 12 h), `call` (the plan tool, answered in `tool.call` before `next`; refused for subagents and once `mcp__ccd_turn__update_plan` has been seen), `around` (main-chat calls only: TodoWrite, TaskCreate, TaskUpdate and the app list are mirrored after `next`; any other call sets the activity before and after `next`, then `withNudge`), `promptSubmitted` and `reset` (`/clear`, `/chatdeck reset`). It writes two atoms, `plan: BandPlan | null` (no `frac`) and `planAct: Activity | null` (only while a plan shows), and the file `~/.claude/mods-state/plan-<session>.json` in plan-bar's shape. The pane computes `frac` with `withFrac(plan, now)`; the line under the bar is `plan-line.tsx` (a client module ticking once a second, the text of `planLine`) or `planLine` drawn at render where the surface has no client modules or it faulted. The panel takes 6 rows, sits in the left column after `main`, and is empty unless `shown`. The inline summary draws one plan row and one agent card fewer. `refreshStatus` adds `plan d/n`. `parseConfig` reads the 0.5.x and 0.6.x default `panels` strings as today's.

0.6.0: the `git` panel (from the git-info mod). State `git: GitInfo` (`folder`, `path`, `isRepo`, `branch`, `changes`, `pr`), read through `normalizeGit`. `refreshGit` (top level, one read at a time, writes only when `sameGit` says it changed) runs `git rev-parse --is-inside-work-tree`, `git branch --show-current` (or `rev-parse --short HEAD`), `git status --porcelain` (`changeCount`) and `gh pr view --json number -q .number` (`prOf`; undefined keeps the last answer for the same branch). It is called after `session.start`'s `next`, on a 15 s `$.clock.every`, and after each main `turn.complete` (both with gh asked); between those gh is asked at most once a minute or on a branch change. Nothing runs when `panels` leaves `git` out. The panel is hidden until the first read (empty `folder`), takes 5 rows, has no rail, and is in the left column. `parseConfig` reads the 0.5.x default `panels` string as the 0.6.0 default.

0.5.1: `commandHeads` splits a shell line into the commands it runs (at `&&`, `||`, `;`, `|`, new lines; `cd` steps dropped, `VAR=value` stripped). `parseTestRun` matches its runners at the start of one of them, and `allowRule` builds the rule from the first: the program (with `rtk`), its flags and values, through the first subcommand-like word, at most five words. `cardLabel` tells one type's twins apart by their titles past the shared words. `pushMsg` lowers `view.scrub` by the messages the cap drops.

0.5.0: `wrapLines(text, width, max)` breaks text at word boundaries into at most `max` rows, the last ending in an ellipsis; the comms list (3 rows), the log (2, a failure 3) and the receipt's slowest line (2) draw its rows, each row its own truncating Text, and `rowsOf` counts them. A column under 12 cells keeps one row. The log shows the newest lines whose rows fit `logRows`. Panels have a `C.faint` border; `effortSvg` draws the effort on graphical surfaces and `meterSvg` adds a gloss layer.

0.4.1: `cardLabel` names a card by its type's last segment (numbered on a tie) when another card's title starts with the same ten characters; `AskUserQuestion` is never recorded in `Turn.slow`.

0.4.0 adds, from data already kept: `hotspots`/`allowRule` over `gate.recent` (non-rule checks grouped by rule), `Turn.slow` (top 3 calls of 3 s or more, timed around `tool.call`'s `next`, copied to the receipt), `Usage.turnTokens` (context tokens at the last four main turn starts, cleared by a compaction and `/clear`) for `runway`, and `effortLevel` (five cells).

## Goal

A pane for a Claude Code chat that shows, beside the usual session vitals and subagent cards, the communication between the main chat and its subagents, and between subagents: a node per agent and an edge per link, which you can also look back through.

## Inspirations

- claude-flightdeck (Stephen Casella, MIT): the pane, its panels and its test rig. The source was the starting point, so its copyright notice stays in `LICENSE`.
- zoetrope (furkankly): the flow graph, animated edges, tool chips, the prompt that spawned an agent, the timeline. Ideas only; no code taken.
- `agents-deck` and `plan-bar` (Investor team): the pixel-crab cards and the meter.

## Events used

| Event | What it gives | Recorded as |
|---|---|---|
| `agent.spawn` | The prompt a subagent starts (or resumes) with, and its parent (`parentAgentId`) | A `prompt` message from the parent (or `main`) to the new agent, architect agents included; a card keeps the prompt whole (2000 characters, masked) |
| `session.send` | Each SendMessage the model sends: recipient (id or name), text, sender loop (`agentId`, absent for main) | A `message`, only after `next()` reports it delivered |
| `tool.call` (existing) | A subagent's tool call | `toolTally[tool] += 1` on its card, beside the last three notes |
| `tool.call` (0.3.0) | Every loop's Edit, Write, NotebookEdit, and Bash with its result text | `files: FileTouch[]` (path, edits, loops, first and last time, capped at 40); `runs: TestRun[]` from `parseTestRun` (capped at 20); a failed call's `failureLine` in the log |
| `turn.step` (0.3.0) | The main loop's `serverToolUses`, with their own start and end times | A consult, deduplicated with `session.append` through `architect.seen` |

## 0.3.0 drawing

- Header: one row, `CHAT DECK` (from 40 columns) and the attention pieces that apply; the legend is gone and the header keeps the legend's row of air on graphical surfaces.
- `checks` (left column in the wide layout): border green or red by the last run; the last three runs newest first as `✓/✗ counts · age · command`; `N files edited since the last run` in amber.
- `files` (right column): the six most recently edited, `●` for this turn, path's last two segments truncated from the start, `×N` and the agents that edited it.
- Footer while `isFocused`: `1-N cards`, `a f s o gate`, `b n l replay`, each only when it applies.
- The log's rows: per-panel estimates for the panels drawn, the taller column when wide.

## Data

- `comms: Msg[]`, newest last, capped at 80: `{ at, from, to, kind: 'prompt' | 'message', text }`. `from` and `to` are agent ids or `main`. Text is masked with `redact` and cut to 160 characters.
- `AgentCard.prompt` and `AgentCard.toolTally`, both optional so state saved by 0.1.0 still reads.
- `View.scrub`: how many comms messages the pane shows, or null for live. Reset by `/clear` and `/chatdeck reset`.

## Drawing

- Every surface: a bordered `comms` panel with a header (`comms · N messages · M routes`; while replaying `comms · replay · K of N messages`, a route being one sender and recipient pair) and the last four messages as `from → to` plus the text. Buttons `b` older, `n` newer, `l` live sit under the list once there are two messages, with a dim line `replay the chat message by message`.
- The receipt (0.5.2): `✓/✗ last turn <time>` with the cost on the right; a row of `agents N`, `edits N`, `errors N` (errors in amber when above zero); then `slowest calls`, one row per call with the command, a six-cell `slowBar` against the turn's duration (the slowest call's while it runs; left out under 40 columns) and its time. The log (0.5.2): a header with the event and error tally (`logTally`); each line is a time, a mark (`✗` error, `◆` consult, `✓` done, `●` other) with the sender named only when it changes, and the text; a failure (`splitFailure`) draws its reason in amber and its call dim beneath, and routine lines by main are dim.
- Graphical surfaces at 40 columns or more: an SVG above the list, `main` on top, up to six agents (the architect included) in a row, one arrow per sender and recipient with its count, agent-to-agent arrows looped under the row, finished agents dimmed. An arrow with a running agent at either end is dashed, and animated with SMIL when `motion` is on and the view is live. Tool chips sit under each agent; they are left out when looking back.
- `sceneAt` builds the past view from the message list and the cards: messages after the scrub position are dropped, agents spawned after its time are dropped, and an agent that had not finished by then is shown running.
- An expanded card shows its tool chips and its full prompt.
- The panel is hidden until there is a message. It sits between `files` and `gate`, and can be switched off in the panels row.

## Known limits

- Looking back covers the comms only, and chips cannot be known for a past moment.
- SendMessage to the architect is matched by id or by the label `architect`, not by the spawn type.
- The animation needs a surface that plays SVG animation; this has not been checked on the desktop app.
- Not built: edges resolving to a check or cross per tool call (zoetrope's chips), and scrubbing by time rather than by message.

## Verification

`verify_mod.py --strict`: layout, validate, security, typecheck and test. The tests cover recipient matching, edge folding and the cap, tool tallies and chips, the past view and scrub steps, the graph markup (dashes, animation, chips, the architect), the panels row (hide, show, count when closed, kept across a reset, the plan band hidden while its tool still works), lenient config and hidden-list reading, the panel on the terminal and desktop at 24, 40, 80 and 110 columns, the back, next and live buttons, the full prompt in a card, masking, undelivered messages and `/clear`.

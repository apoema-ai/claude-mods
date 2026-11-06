# chat-deck

**Version:** 0.11.0

A Claude Code mod (function hooks, Claude Code 2.1.287+) that keeps a live pane of the whole chat beside the transcript: the main model's vitals, every permission check, subagent cards, and the messages the main chat and its subagents send each other. Every number and line comes from a real session event, and nothing leaves your machine.

## Inspirations

chat-deck owes its ideas to others:

- [claude-flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella: the live pane of vitals, gate, architect, cards and swimlanes. chat-deck started from its source, which is MIT-licensed, so his copyright notice stays in `LICENSE`.
- [zoetrope](https://github.com/furkankly/zoetrope) by furkankly: drawing a session as a flow graph, with a node per agent, animated edges, tool chips, the prompt that spawned an agent, and a timeline to look back on. Only its ideas were used; no code was taken.
- The earlier `agents-deck` and `plan-bar` mods: the pixel-crab cards and the emerald-to-teal meter.

## Install

```
/plugin install chat-deck@apoema-claude-mods
/reload-plugins
/chat-deck
```

To try a clone for one session: `claude --plugin-dir <path to this folder>`.

## What you see

| Panel | Shows |
|---|---|
| main | Model, `● working` with the turn's clock (or `○ idle`), effort, the mode once it is known, a context meter, session cost, rate-limit windows, time to first token, and while a turn runs `this turn  N edits  N errors` |
| **plan** | The task plan (from the plan-bar mod): the step in progress on top (`▸ <step>`, or the plan's title when none is) with `Tasks 2/5 +1 · 1 failed` at its right on graphical surfaces (beside the bar in a terminal), one segment per step, and under them one line, `this step 3m19s · <the last tool call> · <subagents running>`. `steps ▸` lists every step with its mark (`✓ ▸ ✗ ○`) and its time. Fed by the desktop app's task list, TodoWrite, TaskCreate / TaskUpdate, or the `mcp__chat-deck__plan` tool; saved to `~/.claude/mods-state/plan-<session>.json`. Hidden 20 s after the last step is done |
| **checks** | The last build and test runs found in Bash output, with their counts, and `△ N files edited since the last test run` |
| **git** | The session folder's branch, its PR number (`gh`), its path (cut in the middle, copied when pressed) and `± N uncommitted` or `✓ clean`. Outside a repository, the folder path alone |
| agents | One card per subagent with a pixel crab and its latest call; swimlanes on a time axis past three agents |
| loops | Agent loops that are not subagents (workflow agents, forks) |
| receipt | The last turn (`✓ last turn · 1m35s`, its cost, agents, edits and errors), and its slowest calls (3 s or longer) one per row with a bar against the turn. While a turn runs it shows only for its slowest calls or a review |
| **files** | Every file edited this session: how many edits, by which loop; `●` marks this turn's. A path is cut in the middle and copied whole when pressed |
| **comms** | Who said what to whom: the prompt each subagent was spawned with and every SendMessage, as a list everywhere and as a graph on the desktop app, the editor and mobile |
| gate | Every permission check. While a rule allowed all of them, one line: `✓ 28 allowed by rule`. Once one asked or was denied: the strip of those checks, the rules the most frequent would need (`×3 Bash(mvn test:*)`) and the totals. `all`, `file`, `shell` and `other` (`a f s o`) open the last checks of everything or of one kind |
| architect | The on-call advisor or reviewer agent, when the session has one: `last 4m ago · took 46s · ◆ before a plan (inferred)`, its last advice, and the consult timeline once there are two or more |
| log | The session's events, newest last; every row names its sender. A failure shows its reason, and the call it came from dim beneath. `✗ N failed calls` in its header shows the failures alone, pressed again all of it |

### Reading the deck

- Every card has the same header: a fold chevron (`▾`, `▸` folded), the name in bold, its detail dim, its status on the right. Press the chevron to fold a card to that one row; the fold is kept while the pane is open.
- Colour is status only: a quiet border is all well, amber asks for a look (untested edits, uncommitted files, a replay), red says something failed, the accent marks work in flight (the main card while a turn runs, an architect advising). Every status also has a mark (`✓ ✗ △ ± ●`), so it reads without colour.
- Counts say what they count: `this turn`, `edited this session`, `uncommitted`, `since the last test run`, `failed calls`.
- Paths and commands are cut in the middle, so the folder and the file (the program and its target) stay. Pressed, they are copied whole; on a graphical surface the whole text shows while the pointer rests on it.

The header is one row: `CHAT DECK` (in a terminal; a graphical frame names the pane already) and only what needs attention: running agents, pending asks, denials, the last test run, untested edits, uncommitted files, the running turn's errors. Each is a button: it unfolds its panel and scrolls the pane to it. While the pane has the focus, a footer lists its keys.

Wide (110 columns and up), the left column holds what is happening now and what needs a look (main, plan, checks, git), the right the work under way (agents, loops, receipt, files, comms); the gate and the architect go to whichever is shorter, and where the right column ends well short of the left the log fills it instead of running under both.

### Checks

- A Bash call is read as a run when its command is a Maven build (`mvn`, `mvnw`, `mvnd`, with `rtk` in front or not, and a goal of `test`, `verify`, `install`, `package`, `compile` or `integration-test`), jest, vitest, `npm|pnpm|yarn test`, `bun test`, `claude plugin test` or `tsc`.
- Maven's `Tests run: …` summary lines are summed across modules; rtk's compact output keeps them. `BUILD FAILURE`, `COMPILATION ERROR` or a non-zero exit fail the run.
- A background command is not read: its output is not in its result.
- A failed call that is not a run gets its reason in the log: the located error line first (`Foo.java:[12,5] cannot find symbol`), paths cut to the file, credentials masked.

### Comms

- A line per message: `main → Map the call…  <first 160 characters>`. The colour tells a spawn prompt from a message.
- The graph puts `main` on top and the agents in a row under it, and the architect agent as a node of its own. An arrow carries the number of messages for that sender and recipient; agent-to-agent arrows loop under the row; finished agents are dimmed.
- An arrow into or out of a running agent is dashed, and its dashes move (SVG animation).
- Under each agent in the graph, its busiest tools as chips: `Bash ×5 · Edit ×2`.
- **Replaying:** `b` steps one message older, `n` one newer, `l` returns to live (they are also buttons under the list). The header then reads `comms · replay · 2 of 3 messages`. The list, the links and the graph show the chat as it stood after that message: later messages are gone, agents not yet spawned are gone, and an agent that had not finished is drawn running. Chips are the agent's tools now and are left out of a past view. New messages arrive without moving you off the moment you are looking at.
- Press an agent's card hotkey to expand it: the card now shows its tool chips, and the full prompt it was spawned with (masked, up to 2000 characters) and its answer, both drawn as markdown.
- When the pane is showing one agent's view, the list is limited to that agent's messages.
- Text is masked for credentials before it is stored, shortened, and kept in the pane's state (the last 80 messages). `/clear` forgets them.
- A recipient is matched by agent id, then by the name it was spawned under. A message nobody received is not recorded.

`/chat-deck` opens the pane, `/chat-deck close` closes it, `/chat-deck reset` clears it, and `/chat-deck layout auto|compact|wide|mini` sets the layout.

`/chat-deck off` turns the whole mod off in every chat and `/chat-deck on` turns it back on; `/chat-deck status` says which. It writes `"chat-deck": false` to `~/.claude/mods/switches.json` (on removes the key) and reads that file every 3 seconds, so an open chat follows. Off closes the pane and keeps it closed, clears the status line, stops the git reads, makes the plan tool answer that Chat Deck is off, and records nothing from the session's hooks. On opens the pane again when `openOnStart` is set. The plan, the log and the other panels are not kept while it is off.

## Configure

`/config` lists five options: `architectPattern` (which agent types count as the architect), `paneColumns`, `layout`, `palette` and `openOnStart`.

Which panels show is not a setting. The **panels** button sits in the header row, on every layout (the inline summary too), and `p` opens or closes the list under it: a button per panel, every one but itself. Closed, it is just `▸ panels` and says how many panels are hidden. The choice is kept across `/chat-deck reset` and between sessions. Hiding a panel only stops drawing it: the plan tool and the git reads keep working.

## What it reads

It reads session events, and sends nothing of its own. It makes no tool calls. It registers one tool, `plan`, adds a short plan section to the system prompt and a nudge to a tool result when work runs without a plan, and writes one file: the plan, `~/.claude/mods-state/plan-<session>.json` (plus `~/.claude/mods-logs/chat-deck.log` when the plan cannot be saved). Its one permission hook (`tool.check`) only records the decision it sees. For the git panel it runs read-only commands in the session folder: `git rev-parse`, `git branch --show-current` and `git status --porcelain` every 15 s and after each turn, and `gh pr view --json number` (which asks GitHub) at most once a minute, on a branch change and after each turn.

## Known limits

- The message text is what the sender wrote, cut to 160 characters; the full text is in the transcript. Only a spawn prompt is kept whole (2000 characters).
- A SendMessage to the architect is matched by its agent id or by the label `architect` (lower-cased), not by the agent type it was spawned as.
- Looking back covers the last 80 messages, and the message list only: the main panel, gate and cards always show the present.
- The moving dashes need a surface that plays SVG animation. Whether the desktop app's renderer plays it has not been checked; if the dashes stay still, the dashed style still marks the live links.
- Whether every event reaches the mod depends on the organization's managed settings. The server-side advisor is read from both `session.append` and each step's result, so it survives either being skipped. The permission mode comes only from `classic.UserPromptSubmit` and a subagent's spawn: without them an approved ask reads `cleared` and the main box leaves the mode out.
- A press can copy and scroll, nothing more: the mod API has no call that opens a file in the editor or shows a diff, so a path is copied rather than opened. Hover tips need a graphical surface; a terminal has the copy alone.
- A call's time runs from its `tool.call` to its result, so it includes any time a permission prompt waited for you.
- The turns-left estimate assumes the next turns grow like the last three; a big file read or a subagent's report moves it.
- A hotspot's rule runs from the command's program through its flags to its first subcommand-like word (`Bash(mvn test:*)`, `Bash(git -C /x status:*)`), so it is never broader than the call. It drops a leading `VAR=value`, and whether a rule without it matches such a call is not checked. Check a rule before adding it.
- Commands are split at `&&`, `||`, `;` and `|` without reading quotes: a separator inside a quoted string splits there.
- Files and untested edits count Edit, Write and NotebookEdit only: a file changed through Bash (`sed -i`, a heredoc, a formatter) is not seen.
- Only a run that reported test counts makes edits tested: a passing `mvn compile` or `tsc` shows `✓ build` / `✓ tsc` and leaves `untested` as it was.
- Checks read what the Bash result holds. If a long build's output was cut before its summary lines, the run shows without counts.
- The `panels`, `maxCards`, `motion`, `moments`, `matchDescriptions`, `statusLine`, `architectLabel` and `gateLabel` options of 0.8.0 and earlier are gone, and a saved value is ignored. The labels are `ARCHITECT` and `GATE`, three agent cards sit side by side, and the rest are on. A plan or git panel can no longer be switched off at the source: hide it in the panels row.
- The PR number needs `gh` on the app's PATH and signed in. Without it the panel shows `no PR`. The panel follows the session folder, not a folder a command `cd`s into.

## Version History

- **0.11.0** (2026-11-06): one command, `/chat-deck`, replaces `/chatdeck`, which is gone.
- **0.10.0** (2026-11-06): `/chat-deck on|off|status` turns the mod on or off in every chat; hooks that fail pass the event through.
- **0.9.0** (2026-11-06): config cut from 13 options to 5; a collapsible panels row turns each panel on or off from inside the pane.
- **0.8.0** (2026-11-06): one card header everywhere (fold chevron, plain title, dim detail, status on the right), colour for status only, counts that say their scope, the turn's clock on the main card, a one-line gate while all is allowed, a one-line architect, the plan's count off its bar and a step list, a log that names every sender with a failed-calls filter, middle-cut paths and commands that copy when pressed, header chips that jump to their panel, balanced wide columns, and a new default panel order.
- **0.7.0** (2026-11-05): a plan panel absorbed from the plan-bar mod, replacing its band above the prompt; one plan row in the inline summary; `plan n/m` on the status line.
- **0.6.0** (2026-11-05): a git panel (branch, PR, uncommitted files, folder) absorbed from the git-info mod, replacing its row above the prompt; the branch in the inline summary.
- **0.5.2** (2026-11-05): the comms controls say they replay (`◀ older`, `newer ▶`, `live ●`, `replay · K of N messages`, "routes" for "links"); the last-turn panel with a title row, a stat row and a bar per slow call; the session log with a tally, marks, the sender named once, and a failure's reason apart from its command.
- **0.5.1** (2026-11-05): runs read only from the command actually run (no more `grep "mvn test"` runs), hotspot rules never broader than the call, one type's parallel agents named by their own words, looking back keeps its moment past the message cap.
- **0.5.0** (2026-11-04): hairline panel borders with the colour in titles and marks, a gradient effort gauge and a glossy context meter on graphical surfaces, long comms, log and slowest-call text wrapped over a few rows.
- **0.4.1** (2026-11-04): agents with a shared description prefix are named by their type; `AskUserQuestion` no longer counts among the slowest calls.
- **0.4.0** (2026-11-04): permission hotspots with their allow rules, the gate strip without rule-allowed checks, each card's latest call, the turn's slowest calls, a turns-left estimate, a five-level effort gauge, plain wording, darker graph text.
- **0.3.0** (2026-11-04): checks and files panels, failure reasons in the log, the advisor read from step results, a neutral label when the mode is unknown, a one-row header, a hotkey footer, markdown in expanded cards, an animated crab, one time axis.
- **0.2.0** (2026-11-04): looking back through the comms (`b`, `n`, `l`), moving dashes on live links, tool chips under each agent, the full spawn prompt in an expanded card, the architect as a node. The author is rmendes; the inspirations are credited above.
- **0.1.0** (2026-11-04): first release. Flightdeck 0.5.1 as the base, with the crab cards and context meter, and the comms panel.

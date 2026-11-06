# Changelog

## 0.12.0

- **`/chat-deck open` is gone.** Plain `/chat-deck` opens the pane. A word the command does not know now shows the usage instead of opening the pane. `status` stays, since plain `/chat-deck` opens the pane and does not say whether the mod is on.

## 0.11.0

- **One command, `/chat-deck`.** It replaces `/chatdeck`, which is gone: `/chat-deck` opens the pane, and `close`, `reset` and `layout auto|compact|wide|mini` work as before, beside `on`, `off` and `status`.

## 0.10.0

- **An off switch in every chat.** `/chat-deck off` writes `"chat-deck": false` to `~/.claude/mods/switches.json` and `/chat-deck on` removes it; `/chat-deck status` says which. The file is read every 3 s. Off closes the pane and keeps it closed, clears the status line, stops the git reads, makes the plan tool answer that Chat Deck is off, and records nothing from the hooks.
- **Hooks that fail pass the event through**, so a fault in the dashboard never blocks a prompt, a permission check, a tool call or a subagent.

## 0.9.0

- **Config cut from 13 options to 5** (`architectPattern`, `paneColumns`, `layout`, `palette`, `openOnStart`). Removed: `panels`, `maxCards`, `motion`, `moments`, `matchDescriptions`, `statusLine`, `architectLabel`, `gateLabel`. They are fixed at their old defaults and a saved value is ignored.
- **A collapsible panels control** in the header row, on every layout including the inline summary, so it is always there and never scrolled away (`p` opens or closes the list under it): an on/off button for every panel but itself. The choice is kept in the pane's state, survives `/chatdeck reset`, and the closed row shows how many panels are hidden. It is separate from the fold chevron, which folds a panel to its header.
- The gate panel has an `all` button (`a`) beside `file`, `shell` and `other`: it lists the last five checks of every kind. `View.gateOpen` may be `'all'`.
- The plan tool and the git reads are always on: hiding their panels stops the drawing only. This replaces leaving `plan` or `git` out of `panels`.

## 0.8.0

- **One card header.** Every bordered panel opens on the same row: a fold chevron (`▾`; `▸` while folded), the name in bold with its detail dim (`checks · tests & builds`), and its status on the right. Pressing the chevron folds the card to that row; the fold is kept in the view (`View.collapsed`). Panels sit one row apart throughout.
- **Colour is for status.** Titles are plain text; the model name, the effort word and the branch lose their accent colour. A border is quiet when all is well, amber when something wants a look (untested edits, uncommitted files, a replay, a pending ask), red when something failed, the accent while work is in flight (the main card during a turn, an advising architect). The checks border is no longer green when fine. Faint grey is kept for borders and decoration; text that says something is dim at the least.
- **Counts say their scope.** The main card shows `this turn  N edits  N errors` while a turn runs; files read `N edited this session`; git reads `± N uncommitted`; the log header's errors are `N failed calls`.
- **The turn's clock is on the main card** (`● working 0:11`, `○ idle`). The receipt no longer draws `◐ turn running`: while a turn runs it shows only for its slowest calls (`◐ this turn`) or a review, and after it reads `✓ last turn · 1m35s` with the cost on the right.
- **Quieter when all is well.** While a rule allowed every check, the gate is `✓ N allowed by rule` and its `file shell other` buttons; the strip, hotspots and totals return with the first ask or denial. The architect is one line, `last 4m ago · took 46s · ◆ before a plan (inferred)`, the three-moment row is gone, and the consult timeline shows from the second consult. An unknown permission mode is no longer drawn as `mode —`.
- **Plan.** On graphical surfaces the `Tasks 2/5` count moves from the bar's pill to the header's right, so it covers no segment (`planSvg(…, hasPill)`). The line under the bar is one row: `this step 3m19s · <last call> · <subagents>`; `Previous:` and the plan total are gone. `steps ▸` at the end of that line lists every step with its mark and time (`View.planOpen`).
- **Session log.** Every row names its sender (bold where it changes, dim where it repeats). A failed call without output reads `✗ failed, no output · Bash → …`, drawn as a reason and a call with one mark, not `Bash → …  ✗`. `✗ N failed calls` in the header filters the log to its failures (`View.logErrors`). Engine notes say what they are about (`task notification: Agent "Explore" completed`), and an architect's answer without text says how long it took (`advice returned after 46s`).
- **Truncation.** Paths and commands are cut in the middle (`midCut`), since the desktop app ignores `truncate-start`: the folder and the file stay. The git path, the last run's command and each edited file are buttons that copy the whole text (with a toast); on a graphical surface the whole text also shows on hover.
- **Header chips act.** Each attention chip is a button that unfolds its panel and scrolls to it; `± N uncommitted` and the running turn's `✗ N errors` join them (the latter also filters the log). `CHAT DECK` heads the terminal only: a graphical frame already names the pane.
- **Layout.** The default `panels` order is now main, plan, checks, git, agents, loops, receipt, files, comms, gate, architect, log (now, what needs a look, the work, history); an install on the 0.5.x to 0.7.x default gets it. Wide, the left column holds main, plan, checks and git, the right the work; the gate and the architect go to the shorter column, and the log fills the right column when it ends ten or more rows short.
- Not done: a press cannot open a file in the editor or a diff (the mod API has no such call), so paths copy instead.

## 0.7.0

- A `plan` panel replaces the plan-bar mod's band above the prompt. It sits under `main` in the left column: `plan` and the step in progress, highlighted (`▸ Build the slides`, with the whole row for its text; the plan's title when no step is in progress); one emerald-to-teal segment per step (red when failed, an amber foot when added late) with the `Tasks 2/5 +1 · 1 failed` pill; and the line under it, `Previous: Draft the outline (1m05s) · this step 2m14s · 6m02s total · Bash: mvn verify · running 2m01s · 1 subagent running: Explore`. A finished plan reads `All 4 steps done in 6m12s · longest: …` and holds 20 s before the panel hides.
- The plan comes from the desktop app's task list (`mcp__ccd_turn__update_plan`), TodoWrite, TaskCreate / TaskUpdate, or Chat Deck's own `plan` tool (`mcp__chat-deck__plan`; it stands down once the app's list is in use). Toasts, nudges and the 12 h resume rule are plan-bar's. The plan file stays at `~/.claude/mods-state/plan-<session>.json`, same shape, for chat-inventory.
- The inline summary gains one plan row (title, step blocks, count, the step in progress); it shows one agent fewer while a plan shows, so it stays at 8 rows. The status line gains `plan 2/5`.
- No timer writes to state: the step fill is computed when the pane draws, the line under the bar ticks on its own clock (`plan-line.tsx`), and the desktop bar's twinkle, glow and sheen are CSS. The terminal bar no longer shimmers.
- `panels` gains `plan` (default `main,plan,git,…`); an install on the 0.5.x or 0.6.x default gets it. Leaving it out also removes the tool and the nudges. plan-bar's `switches.json` keys and its ✕ are gone.
- `/clear` and `/chatdeck reset` start the plan fresh (the saved file is left for chat-inventory).

## 0.6.0

- A `git` panel replaces the git-info mod's row above the prompt. It sits under `main` in the left column and shows `git`, `⎇ branch` and `PR #n` (or `no PR`) on the first row, then the folder path (`~`-shortened, cut from the start so the folder name stays) and `± N files changed` or `✓ clean`. The border turns amber while the tree has uncommitted files. Outside a work tree it says `not a repository` under the path.
- The inline summary adds `· ⎇ branch ±N #PR` at the end, the first piece dropped when the row is short.
- Polling as in git-info: local git every 15 s and after each main turn; `gh pr view` once a minute, on a branch change, and after each turn. The last PR answer is kept for the same branch when `gh` gives none. Leaving `git` out of `panels` stops all of it.
- `panels` gains `git` (default `main,git,architect,…`). An install still on the 0.5.x default string gets the git panel too; a list of your own is left alone.
- git-info's `~/.claude/mods/switches.json` keys (`git-info`, `git-info:hidden`) are not read: hide the panel through `panels` instead.

## 0.5.2

- Comms: the three controls say what they are. `◀ older`, `newer ▶` and `live ●` sit above a dim line, `replay the chat message by message`, and the header reads `comms · replay · 2 of 3 messages` while you look back (it was `· 1 back`). A sender and recipient pair is a route, not a link. The footer says `b n l replay`.
- Last turn: `✓ last turn 1m30s` with the cost on the right, a row of `agents`, `edits` and `errors` (errors amber when above zero), and the slowest calls one per row with their time and a bar against the turn. The time no longer wraps away from its command.
- Session log: a header tally (`12 events · 2 errors`); a mark per line (`✗ ◆ ✓ ●`), the sender named only when it changes; a failure draws its reason in amber with the call dim beneath, instead of one red line; routine lines by main are dim.

## 0.5.1

- A build or test run is read only from the command a shell line actually runs: `grep "mvn test"`, `rg vitest`, `git commit -m "...jest..."` and `tsc --version` are no longer runs (a failed grep showed as `✗ build failed`).
- A hotspot's rule is never broader than the call: it keeps the flags and their values up to the subcommand (`Bash(git -C /x status:*)`, not `Bash(git:*)`), keeps `rtk` (`Bash(rtk mvn test:*)`), and drops a leading `VAR=value`.
- Parallel agents of one type that share a description prefix keep their own words (`auth token refresh`, `payment retries`) instead of becoming `general-purpose 1`, `2`.
- Looking back through the comms keeps its moment once the list is full: a new message no longer moves it one forward.

## 0.5.0

- Calmer look: panels have a hairline border, and the colour sits in the title (the gate and architect titles lead with a dot), the marks and the numbers. A failed check and a running turn keep their coloured border.
- Graphical surfaces: the effort is a five-segment gradient gauge, and the context meter has a soft gloss, as in plan-bar. The terminal keeps its glyphs.
- Long text wraps at word boundaries instead of ending in an ellipsis: comms messages (3 rows), log lines (2 rows, a failure 3) and the receipt's slowest calls (2 rows). Names, marks and numbers still truncate, and a column under 12 cells keeps one row. The log keeps the newest lines whose rows fit its budget.

## 0.4.1

- Parallel agents that share a description prefix ("Wave 1: ...") are named by their agent type (`ac-reviewer`), numbered when the type matches too, in the agent rows, the comms graph and the log.
- The turn's slowest calls leave out `AskUserQuestion`: its time is your answer, not a slow call.

## 0.4.0

- Permission hotspots in the gate panel: the three rules the recent asked or denied checks would need (`×3 Bash(mvn test:*)`, with how many were denied). The mod only shows them; adding a rule is yours to do.
- The gate strip shows only checks a rule did not allow; with none, it says every check was allowed by a rule. The inline summary keeps all marks.
- Each agent card shows its latest call (`→ Bash → mvn verify`).
- The receipt names the turn's slowest calls, 3 s or longer: `slowest Bash → mvn verify 4m12s`.
- The main box estimates the turns left before the context fills (`~4 turns left`, amber at 3 or fewer), from the growth over the last three turns; shown from 20 turns left, forgotten at a compaction or `/clear`.
- The effort gauge has five cells, so `xhigh` and `max` differ.
- Wording: `turn running`, `N requests`, `N steps`.
- Graph text and lines are `#6b7280` (4.8:1 on light, 3.5:1 on dark), and the SVG ids are namespaced (`cd-meter-fill`, `cd-flow-arrow`).

## 0.3.0

- New `checks` panel: the last build and test runs read from Bash output (Maven, including rtk's compact form, jest, vitest, `bun test`/`claude plugin test`, tsc), with their counts, and how many files were edited since the last run. The header and status line show `✓ tests` / `✗ tests` and `N untested`.
- New `files` panel: every file edited this session, how many times, by which loop; `●` marks this turn's.
- A failed call's log line says why: its located error line, path cut to the file, secrets masked.
- A server-side advisor is read from each step's `serverToolUses` too, so the architect works where `session.append` is not delivered (some managed settings skip it). Either path counts a consult once.
- With the permission mode unknown (`classic.UserPromptSubmit` not delivered), an approved ask reads `cleared`, not `you`, and the main box shows `mode —` after a turn.
- One header row, `CHAT DECK` and only what needs attention (running agents, pending asks, denials, tests); the legend is gone. "SESSION DECK" no longer appears.
- A hotkey footer while the pane has the focus; `/chatdeck` names the `b`/`n`/`l` keys.
- An expanded card draws its prompt and answer as markdown, the answer whole (400 characters).
- A running crab animates in its own SVG instead of stepping on the pane's redraws; `motion: off` keeps it still.
- The second SVG time axis under the log is gone: the swimlanes are the time axis.
- The log's row budget counts only the panels drawn, and the taller column in the wide layout.

## 0.2.0

- Look back through the comms: `b` back, `n` next, `l` live. The list, links and graph show the chat as it stood after that message.
- Arrows into or out of a running agent are dashed, with moving dashes where the surface plays SVG animation.
- Tool chips (`Bash ×5 · Edit ×2`) under each agent in the graph and in its expanded card, which also shows the full spawn prompt.
- The architect agent is a node in the graph, and its prompt and messages are listed.
- flightdeck, zoetrope, agents-deck and plan-bar are credited as inspirations.

## 0.1.0

- Cloned from claude-flightdeck 0.5.1 (MIT, Stephen Casella); that project's own history is in its repository.
- Context meter and a pixel crab per agent card on the graphical surfaces; the terminal keeps its glyphs.
- New `comms` panel: the prompt each subagent was spawned with and every delivered SendMessage, as a list and (on graphical surfaces) a graph of loops and arrows. Cleared by `/clear` and `/chatdeck reset`.

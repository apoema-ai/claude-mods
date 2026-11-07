# pr-radar

**Version:** 0.5.0

A Claude Code mod (function hooks, Claude Code 2.1.287+) that shows the state of your open GitHub PRs in a band above the prompt, with a details pane and a Refresh button.

## What it shows

**The band** (one line; quiet when calm, framed when it needs you: a rounded border, amber when PRs wait on your review, red when changes were requested on yours, indigo when the last refresh failed, and no border otherwise): how many PRs you have open, then only the counts that are not zero: `changes` requested (red), `approved` (green), `awaiting` a first review, and `to review` by you (amber). The right side holds three small controls: `↻ 1m` which refreshes and shows how long ago it last did (`⚠ ↻ 1m` when the last refresh failed, `r`), `Open` (`o`) and `✕` to hide the bar (`x`). The hotkeys work while the band holds the focus; desktop leaves their badges off to save room. The refresh mode is a setting, so it lives in the pane (and `/pr-radar auto|manual`): Auto refreshes on the timer; Manual only when you press Refresh (it still fetches once when the session starts). Hide removes the bar for the rest of the session; `/pr-radar show`, or `Show bar` (`b`) in the pane, brings it back.

**The pane** (`Open`, or `/pr-radar`) has two tabs. It opens on **To review** when something waits on you, otherwise on **My PRs**.

- **My PRs** (`m`), grouped by what each needs, most actionable first: Changes requested, Approved, In review, Awaiting first review, Drafts.
- **To review** (`v`): Needs your review, New commits since your review, Reviewed.

The top right of the pane has the `Auto · 2h` / `Manual` button (`a`) and `Refresh` (`r`). Below the tabs, `Sort by` on the left and `Updated 4h ago` on the right.

**Sort by** sorts the PRs inside each group: `Repository` (`e`, the default), `Title` (`t`, numbers in ticket keys compare as numbers, so INV-2 comes before INV-10) or `Number` (`n`). The chosen field is marked by its direction (`↑` / `↓`), not by a filled pill, so only the active tab stands out; pressing it again flips it. The choice lasts for the session.

Each PR is two lines: the title and its age (`5m`, `3h`, `2d`), then `repo #123` as a link, who reviewed (`✓` approved in green, `✗` changes requested in red, `●` commented), and who you still wait on (three names, then `+N`). The org's `upgrade` login suffix is left off every name.

## What it sends, and what it changes

It runs `gh api graphql` (and `gh api user` once) with your own `gh` login, three searches per refresh, and keeps the answer in memory for the session. It writes nothing to disk and never touches a token. Review bots (`cursor`, `upgrade-tekton-ci`) are left out of the lists.

## Use it

```
/plugin install pr-radar@apoema-claude-mods
/reload-plugins
/pr-radar
```

| Command | Does |
|---|---|
| `/pr-radar` | Opens the pane (prints the report where nothing draws) |
| `/pr-radar text` | Prints the report in the chat |
| `/pr-radar refresh` | Asks GitHub again |
| `/pr-radar auto`, `manual` | Refreshes on the timer, or only when you press Refresh |
| `/pr-radar hide`, `show` | Hides or shows the bar above the prompt |

Plugin options: `refreshMode` (`auto` or `manual`, default `auto`) is the mode each session starts in, and `refreshMinutes` (default 120) is how often Auto refreshes. Switching the mode from the bar or the command lasts for the session.

## Known limits

- Needs `gh` signed in. A failure shows as `GitHub unreachable` in the band, and the pane keeps the last lists with the reason.
- Shows at most 50 PRs per list.
- The `upgrade` suffix is hard-coded for Upgrade logins.
- Tested on Claude Code 2.1.319 with `claude plugin test`, and the 0.1.0 pane in the desktop app.

## Version History

- **0.5.0**: Auto refreshes every 2 hours by default (`refreshMinutes` 120, was 5). The bar is quiet when calm: no border unless PRs wait on your review, changes were requested, or the refresh failed. Auto/Manual moves to the pane; `✕` hides the bar with `x`, as on every mod. In the pane, the update time sits beside Sort by, the `↑ Asc`/`↓ Desc` button is gone (the chosen field shows its arrow, and pressing it again flips it), and only the active tab is a filled pill.
- **0.4.1**: The pane's button rows wrap when the pane is narrow.
- **0.4.0**: Compact bar on one line (`Auto`, `↻ 1m`, `Open`, `✕`; no hotkey badges on desktop; shorter counts). Auto and Manual refresh modes on the bar and the pane, `/pr-radar auto|manual`, and the `refreshMode` option.
- **0.3.0**: Sort by repository, title or number, ascending or descending. A Hide button on the bar, and `/pr-radar hide|show`.
- **0.2.0**: redesign. Indigo band on one line with only the counts that matter. Pane with My PRs and To review tabs, PRs grouped by what they need, colored reviewer states, ages, links, short names, and empty, loading and error states.
- **0.1.0**: first release.

# pr-radar

**Version:** 0.3.0

A Claude Code mod (function hooks, Claude Code 2.1.287+) that shows the state of your open GitHub PRs in a band above the prompt, with a details pane and a Refresh button.

## What it shows

**The band** (one line, indigo border): how many PRs you have open, then only the counts that are not zero: changes requested (red), approved (green), awaiting review, and how many need your review (amber). The right side shows how long ago it refreshed, `Refresh` (`r`), `Open` (`o`) and `Hide` (`h`). Hide removes the bar for the rest of the session; `/pr-radar show`, or `Show bar` (`b`) in the pane, brings it back.

**The pane** (`Open`, or `/pr-radar`) has two tabs. It opens on **To review** when something waits on you, otherwise on **My PRs**.

- **My PRs** (`m`), grouped by what each needs, most actionable first: Changes requested, Approved, In review, Awaiting first review, Drafts.
- **To review** (`v`): Needs your review, New commits since your review, Reviewed.

**Sort by** sorts the PRs inside each group: `Repository` (`e`, the default), `Title` (`t`, numbers in ticket keys compare as numbers, so INV-2 comes before INV-10) or `Number` (`n`). `↑ Asc` / `↓ Desc` (`d`) flips the direction, and pressing the chosen field again does the same. The choice lasts for the session.

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
| `/pr-radar hide`, `show` | Hides or shows the bar above the prompt |

Setting `refreshMinutes` (plugin option, default 5) is how often it refreshes by itself.

## Known limits

- Needs `gh` signed in. A failure shows as `GitHub unreachable` in the band, and the pane keeps the last lists with the reason.
- Shows at most 50 PRs per list.
- The `upgrade` suffix is hard-coded for Upgrade logins.
- Tested on Claude Code 2.1.319 with `claude plugin test`, and the 0.1.0 pane in the desktop app.

## Version History

- **0.3.0**: Sort by repository, title or number, ascending or descending. A Hide button on the bar, and `/pr-radar hide|show`.
- **0.2.0**: redesign. Indigo band on one line with only the counts that matter. Pane with My PRs and To review tabs, PRs grouped by what they need, colored reviewer states, ages, links, short names, and empty, loading and error states.
- **0.1.0**: first release.

# claude-mods

**Make Claude Code show you what it is actually doing.**

Four small mods that put the things you usually have to guess, or dig for, right where you can see them: a live dashboard of the whole session, a countdown to your prompt cache going cold, a nudge when the model is wrong for the job, and a clean handoff when a chat gets too long.

Everything runs locally, every number comes from a real session event, and every mod has an off switch you can flip with one command.

| Mod | In one line | Version |
|---|---|---|
| [chat-deck](chat-deck) | A live pane beside the transcript: vitals, plan, git, permission checks, subagent cards | 0.12.0 |
| [cache-timer](cache-timer) | Counts down until the prompt cache goes cold, and can keep it warm | 0.10.0 |
| [model-fit](model-fit) | Checks whether the model and effort fit the task, with a Switch button | 0.8.0 |
| [chat-handoff](chat-handoff) | Writes a handoff of the whole chat so work continues in a fresh one | 0.5.0 |

Requires Claude Code 2.1.287 or later (mods are an early-access API, so details can move between releases).

## Get started

Add the marketplace once, then install what you want:

```
/plugin marketplace add apoema-ai/claude-mods
/plugin install chat-deck@apoema-claude-mods
/plugin install cache-timer@apoema-claude-mods
/plugin install model-fit@apoema-claude-mods
/plugin install chat-handoff@apoema-claude-mods
/reload-plugins
```

Want to kick the tyres first? Load a single mod for one session, straight from a clone:

```
claude --plugin-dir <path to claude-mods>/chat-deck
```

## Meet the mods

### chat-deck: the cockpit

You ask for a refactor. Three subagents spin up, a build fails, a permission prompt scrolls past, the context fills. Where did it all go?

chat-deck keeps a pane beside the transcript that shows:

- the main model's vitals, with a context gauge and an estimate of the turns you have left;
- the task plan as a progress bar, one segment per step, with the step in progress filling as its time runs;
- the session folder's git branch, PR and uncommitted files;
- every permission check and what decided it;
- subagent cards (with pixel crabs) and swimlanes, and the messages between the main chat and its subagents drawn as a graph you can replay;
- the last build and test runs, the files edited, a turn receipt and a session log.

It also registers a `plan` tool, so Claude can keep its task list where you can watch it.

### cache-timer: know before the cache goes cold

Prompt caching makes long chats cheap, until the cache expires and the next message pays to write the whole chat again. cache-timer draws a countdown above the prompt, reads the real cache length from the chat's transcript, and warns you when a model switch or a compaction has just reset it. `/cache-timer warm` sends a tiny ping shortly before the deadline if you want to keep the discount.

### model-fit: the right model for the job

Opus for a rename is a waste. Haiku for a design review is a gamble. model-fit has a cheap Haiku call judge each prompt (or each skill start) against a model-selection rubric and, when the model or effort does not fit, shows a Switch button above the prompt. Turn on Auto and it switches by itself, with a guard that will not drop to a cheaper model once the context is big enough that a switch would throw the cache away.

It acts on your behalf, so its README says exactly what it sends and what it changes.

### chat-handoff: a fresh chat without losing the thread

At a token threshold you choose (250k by default) it offers Refresh. It writes a handoff of the whole chat, shows the steps with progress bars, then either copies it or starts a new chat with it. A draft is saved first and every run is logged.

## One command per mod: on, off, status

Every mod can be switched off in every chat, and back on, without uninstalling anything:

| Command | Does |
|---|---|
| `/chat-deck on`, `off`, `status` | Off closes the pane, clears the status line and stops recording |
| `/cache-timer on`, `off`, and `/cache-timer` alone for the status | Off hides the band and stops keep warm |
| `/model-fit on`, `off` (plain `/model-fit` shows the status) | Off means no band and no Judge call |
| `/chat-handoff on`, `off`, `status` | Off stops the Refresh offer |

The command named after each mod also carries its other controls: `/chat-deck` opens the pane (with `close`, `reset` and `layout ...`), `/cache-timer warm` starts or stops keep warm, and `/model-fit trigger ...` and `auto ...` change its settings.

The state lives in one shared file, `~/.claude/mods/switches.json` (`"<mod>": false` means off), and each mod re-reads it every few seconds, so a chat that is already open follows along.

## How it is built

- Each mod is its own plugin with its own version and its own off switch, so a change to one never touches another. A plugin can hold only one hooks module, which is why this is a marketplace and not one big plugin.
- Every mod is TypeScript, with a test suite that runs without a session, a sign-in or a network: `claude plugin test <folder>`.
- Gating hooks pass the event through if they fail, so a bug in a dashboard never blocks your tools or your prompts.
- The mods do record and write files as you (state, logs, the switch file), and say so in their READMEs.

To check a mod yourself:

```
claude plugin validate --strict <folder>
claude plugin test <folder>
```

## Thank you

These mods stand on other people's work, and they deserve the credit.

- **Stephen Casella** and [claude-flightdeck](https://github.com/scasella/claude-flightdeck). chat-deck started from its source: the live pane of vitals, gate, architect, cards and swimlanes, and the test rig. It is MIT-licensed, and his copyright notice stays in [chat-deck/LICENSE](chat-deck/LICENSE). Without flightdeck there would be no chat-deck.
- **furkankly** and [zoetrope](https://github.com/furkankly/zoetrope). The idea of drawing a session as a flow graph, with a node per agent, animated edges, tool chips, the prompt that spawned an agent and a timeline to look back on. Only the ideas were used, no code, and they shaped the comms graph.
- **benai-mods** and its `handoff` mod, the starting point for chat-handoff.
- The earlier **agents-deck**, **plan-bar** and **git-info** mods. chat-deck took their pixel-crab cards, the emerald-to-teal progress meter, the plan tool and the git row, and folded them into one pane.

If you build on this, please do the same for them.

## License

chat-deck is MIT-licensed; see [chat-deck/LICENSE](chat-deck/LICENSE), which includes the original copyright notice. The other mods do not carry a license file yet.

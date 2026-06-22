# /impeccable

Frontend design skill — design, redesign, critique, polish, and iterate production-grade UIs.

## How to use

Read the full skill definition and follow its instructions exactly:

```
.agents/skills/impeccable/SKILL.md
```

The argument passed to `/impeccable` is available as `$ARGUMENTS`.

## Setup (always run first)

Load context before any design work:

```bash
node .agents/skills/impeccable/scripts/load-context.mjs
```

Consume the full JSON output. If PRODUCT.md is missing or empty (< 200 chars or has `[TODO]` markers), run `teach` first.

## Routing

- **No argument**: show the command table from SKILL.md grouped by category, ask what the user wants to do.
- **First word matches a sub-command** (`craft`, `shape`, `teach`, `document`, `extract`, `critique`, `audit`, `polish`, `bolder`, `quieter`, `distill`, `harden`, `onboard`, `live`, `animate`, `colorize`, `typeset`, `layout`, `delight`, `overdrive`, `clarify`, `adapt`, `optimize`): load `.agents/skills/impeccable/reference/<command>.md` and follow its instructions. Everything after the command name is the target.
- **First word doesn't match**: general design invocation using the full argument as context.

## Command prefix

When the SKILL.md says `{{command_prefix}}impeccable`, that means `/impeccable` in Claude Code.
When the SKILL.md says `{{scripts_path}}`, that means `.agents/skills/impeccable/scripts`.

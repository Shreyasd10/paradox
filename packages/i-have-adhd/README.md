# i-have-adhd (for pi)

ADHD-friendly output shaping for **stock pi**, ported from Atomic's
[`@bastani/i-have-adhd`](https://github.com/bastani-inc/atomic/tree/main/packages/i-have-adhd)
(which itself forks [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)).

When enabled, the extension injects a persistent ruleset into the session that
shapes every response for a reader with ADHD: lead with the next action, number
multi-step work, restate state across turns, suppress tangents, give specific
time estimates, and make wins visible.

## Install

```bash
pi install /path/to/paradox/packages/i-have-adhd   # local checkout
# or via paradox's installer (packages/i-have-adhd is a vendored package)
```

## Usage

| Action | How |
|---|---|
| Enable | `/i-have-adhd` (or `/i-have-adhd on`) |
| Disable | `/i-have-adhd off` (or `/i-have-adhd stop`) |
| Disable mid-conversation | type `stop adhd mode` or `normal mode` |
| Start disabled | launch pi with `--no-adhd` |
| Permanently off | create `~/.pi/agent/.i-have-adhd-off` |

The mode persists per session (survives resume), re-injects the ruleset after
compaction, and shows a `● ADHD Mode` badge in the status bar while active.

# mrrgong

Claude entry point. Start at [`.agents/memory/MEMORY.md`](.agents/memory/MEMORY.md).

## Testing

- Tests first (TDD). New features ship with tests.
- Aim for 80%+ coverage on new code.
- Server: `npm test`. Mac app: `cd apps/mac && swift test` (needs full Xcode; set `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`).

## Sessions

`.agents/sessions/YYYY-MM-DD.md` is local-only and gitignored. Decisions: `.agents/memory/decisions.md`. Delivery: the GitHub issue or PR. Never `git add -f` a session file.

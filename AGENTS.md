# mrrgong

This file is the agent entry point.

## Start here

Read [`.agents/memory/MEMORY.md`](.agents/memory/MEMORY.md), then only the topic file for the task.

## Commands

- Server tests: `npm test` (vitest, with coverage). Typecheck: `npm run typecheck`. Build: `npm run build`.
- Try it: `npm run dev`, then `npm run simulate 49`.
- Mac app: `cd apps/mac && ./scripts/build-app.sh` (full Xcode required).

## Sessions

`.agents/sessions/YYYY-MM-DD.md` is local-only and gitignored. This repo is public. Durable decisions go in `.agents/memory/decisions.md`. Delivery state goes on the GitHub issue or PR. Never `git add -f` a session file.

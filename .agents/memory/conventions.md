# Conventions

- TDD. Tests first. 80%+ coverage on new code. `npm test` and `npm run typecheck` must pass before a PR.
- Zero runtime dependencies in the server. Think hard before adding one.
- Never log or echo secrets (`STRIPE_WEBHOOK_SECRET`, `STRIPE_API_KEY`, webhook URLs, tokens). Customer-controlled text (names, emails) is untrusted: escape it per channel and never let it mention or ping anyone.
- Stripe keys for the MRR watcher must be restricted and read-only.
- Issues use EARS requirements: `THE SYSTEM SHALL ...`, `WHEN ... THE SYSTEM SHALL ...`, `IF ... THEN THE SYSTEM SHALL ...`. See `.github/ISSUE_TEMPLATE/task.yml`.
- Priorities: P1 broken for users, P2 needed for launch, P3 nice to have.
- PRs need a tracking issue (`Closes #n`). Merge when build, tests and lint are green; do not wait on review bots.
- Commit messages end with the Co-Authored-By trailer when an agent wrote them.

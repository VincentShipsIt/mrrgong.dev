---
status: active
---

# mrrgong: repo memory index

Link index plus hard facts. Open a topic file for detail.

## Read these

- [conventions.md](conventions.md): code, tests, git, issue and PR rules
- [decisions.md](decisions.md): live ADRs

## Hard facts

- Repo: `VincentShipsIt/mrrgong.dev`. Public, MIT. Default branch `main`.
- Product: a Stripe webhook receiver that celebrates sales ("gong") in Discord, Slack, a browser page and a macOS menu bar app, plus an MRR watcher with a day streak. Indie-hacker humour is part of the product, but numbers are never faked.
- Server: TypeScript, zero runtime dependencies, one `Request -> Response` handler. Runs on Node/Docker (adds the browser gong and the MRR watcher) and Cloudflare Workers (webhooks only).
- Mac app: `apps/mac`, SwiftUI + AppKit, no third-party dependencies, talks to the server over `GET /mrr` and `GET /events` (SSE).
- UI direction: MeterBar "Tiles" (Control Center style), dark, gold accent. No bottom pill buttons. Every number is labelled with its unit ("% left", "days up", "MRR").
- Delivery state lives on GitHub issues, not a local TASKS folder.
- Do not use film names, quotes or branding, or another company's brand, in the repo.

# Decisions

- **2026-11-01: Webhook-first server, apps are clients.** A laptop has no public address and sleeps, so the server receives Stripe events and the Mac app subscribes over SSE and polls `/mrr`.
- **2026-11-01: Web-standard handler, no Stripe SDK.** Signature verification uses Web Crypto so the same code runs on Node, Workers, Deno and Bun.
- **2026-11-01: MRR comes from polling Stripe with a restricted read-only key.** Local snapshots (one per UTC day) feed the streak. The streak is never faked: a dip or a missing day breaks it.
- **2026-11-01: Customer data is masked by default** (`GONG_CUSTOMER=masked`). Public channels (X) get amounts and milestones only.
- **2026-11-01: Mac app uses `NSStatusItem` + `NSPopover`** instead of `MenuBarExtra`, because `MenuBarExtra` cannot offer a separate right-click menu.

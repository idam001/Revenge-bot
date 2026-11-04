# REVENGE GPT — Advanced Upgrade Plan

**Requested scope:** user selected 1, 2, 3, 4, 5, 6, 7, 9, 10 and clarified “plugin” means **MCP connectors**.

**Product constraint:** keep the main chat composer uncluttered. Do not re-add the removed API-key shortcut or expose raw private model reasoning. Show concise progress, user-visible plans, tool actions, and final answers.

## Existing capabilities to preserve

Chat history/search, sharing, memory, web search, voice input, image/video generation, project instructions, model selection, artifacts/canvas, Agent Mode with an isolated sandbox, file browser, command execution, and ZIP export.

## Upgrade sequence

### Phase 1 — Safe agent changes (items 1 + 4)

- [x] Create an automatic before-run checkpoint and after-run archive in the isolated sandbox; archives stay outside the downloadable workspace and exclude `.env*`, dependency folders, and build output.
- [x] Show a post-run unified workspace diff and offer **Undo this run** to restore the before-run checkpoint.
- [ ] Add a true pre-apply approval gate so the agent can propose a patch before changing even its sandbox workspace.
- [ ] Persist checkpoint metadata across sandbox reconnects and show named checkpoint history.
- [ ] Add coverage for owner/session isolation and an end-to-end E2B run.
- Note: current implementation is a review-before-download/undo flow, not yet a strict “approve before sandbox mutation” flow.

### Phase 2 — Visual testing (item 2)

- Add an isolated browser test runner to the sandbox, not the user’s device.
- The agent can start a local preview, run a small Playwright smoke test, capture a screenshot, and inspect browser-console errors.
- Show screenshot, test result, and console errors in the run report; clean up the test browser/process after the run.
- Do not mark a UI task verified unless the preview actually loaded and the smoke test ran.

### Phase 3 — Durable background jobs (item 3)

- Persist jobs and state in Postgres: queued, running, needs-approval, completed, failed, cancelled.
- Add stop/retry, progress events, and reconnect/resume after refresh.
- Use a durable worker/queue rather than relying on a single browser SSE connection or a Vercel request staying alive.
- Show a notification only after a job is complete or needs user input.

### Phase 4 — Research workspace (recommended upgrade 4; selected scope item 5)

- [x] Add an in-chat research workspace with visible search → evidence review → synthesis progress.
- [x] Visually separate the assistant's synthesis from retrieved source previews; show source domains, links, and excerpts for inspection.
- [x] Let users manually flag sources for comparison and export the answer, sources, previews, and flags as a Markdown report.
- [ ] Add an editable query plan, source removal, and controls to redirect research.
- [ ] Add explicit claim-to-source attribution, stronger disagreement analysis, and multi-step iterative search/read; never present a heuristic as a verified contradiction.
- Keep ordinary web search as the fast path; research should be explicit and visibly take longer.

### Phase 5 — Model Council (item 6)

- Run the same prompt against 2–3 user-selected, configured models in parallel.
- Show each answer separately, then a synthesized comparison with disagreements and source distinctions.
- Enforce provider quotas/timeouts independently; show which model failed without losing the other answers.
- Never silently send user data to an unselected provider.

### Phase 6 — Better file understanding (item 7)

- Support PDF, DOCX, XLSX, CSV, text/code, and images with size/type validation.
- Extract text server-side in bounded chunks; preserve page/sheet references for citations.
- For large files, use chunked retrieval instead of attaching the entire document to every model prompt.
- Make attached-file visibility and removal clear in the composer.

### Phase 7 — MCP connectors / plugins (item 9 + plugin)

- Start with remote MCP over a supported transport; do not run arbitrary uploaded plugin code on the app server.
- Store per-user connector configuration and secrets encrypted at rest; never return secret values to the browser.
- Show requested tools/scopes, require explicit approval for write/destructive actions, and log every invocation.
- Add connect/test/disable/revoke controls; validate URLs and block localhost, link-local, private-network, and metadata-service destinations to prevent SSRF.
- Keep a curated connector catalog separate from the user’s personal MCP connections.

### Phase 8 — Project-scoped memory (item 10)

- Add project-only vs account-wide memory scopes.
- Provide view/edit/delete/disable controls and “why was this used?” source attribution.
- Never let one user or one project read another user’s memories; provide a temporary-chat option that saves nothing.
- Keep the existing memory feature working while new scope metadata is introduced.

## Release gates for every phase

- Typecheck and production build pass.
- API tests cover ownership, guest/account isolation, errors, limits, cancellation, and retry.
- Mobile layout and keyboard/screen-reader controls are checked.
- No secrets enter client bundles, logs, source snapshots, or generated artifacts.
- Verify the deployed build and its key user flows before calling the phase done.

## Status (2026-11-04)

- Scope and MCP plugin direction recorded.
- Current production deployment before this research-workspace change: `dpl_7973jGj2FAWe3FHLBrg68KhT77Ms` (READY/PROMOTED). Production `/`, `/chat`, and `/api/health` returned 200; unauthenticated provider and agent endpoints returned the expected 401. The authenticated E2B restore flow still needs an end-to-end test.
- Phase 1 review/undo is deployed, but remains post-run sandbox review rather than a pre-mutation approval gate; see the caveat above.
- Research workspace is implemented locally: real search/source/synthesis progress states, source inspection, clearly separated synthesis vs. evidence previews, manual comparison flags, and Markdown report export. The new component passes focused ESLint, TypeScript, and production-build checks. End-to-end interactive browser and production checks are pending. The source-snapshot upload attempt was denied by Supabase Storage RLS using the local anon key, so this change is not deployed.
- Existing feature audit: Arena mode already compares a second model (item 6); web grounding already searches multiple sources (item 5); memory exists at account scope, but not with project-only isolation and source controls (item 10).
- Remaining selected upgrades are staged in the phases above. No visual browser-test runner, durable-job service, document parser, MCP connector manager, or project-scoped memory has been shipped.

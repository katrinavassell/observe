# Observe First-Run UX Redesign — Spec

**Generated**: 2026-04-12 · **Target session**: tonight · **Target time-to-aha**: <10s signup → populated Insights

> **Source caveat**: Helicone, Langfuse, and Notion AI entries below are **verified live** against their docs on 2026-04-12 (see verified URLs in section 1). Linear, Vercel, and Supabase entries are training-data recall (cutoff May 2025) — verify before quoting publicly.

---

## 1. Benchmark — signup → aha

**Helicone** ✅ *verified [docs.helicone.ai/getting-started/quick-start](https://docs.helicone.ai/getting-started/quick-start)*
5 major steps across 2-3 interfaces: signup → API keys settings page → configure SDK → execute a real API call → check Requests tab. **Docs do not mention pre-loaded demo data or an initial empty state** — activation only happens through actual usage. Aha = "within seconds" of first real request, but gated on a code change first.

**Langfuse** ✅ *verified [langfuse.com/docs/get-started](https://langfuse.com/docs/get-started)*
~6 steps: signup → create project → generate API credentials → **pick from 8 framework tabs** (OpenAI SDK variants, Vercel AI SDK, LangChain versions, native SDKs) → install package + configure env → modify app code 3-10 lines → run app → return to view trace. Even MORE gated than Helicone. **No pre-loaded demo data or sandbox**. Public demo is a separate link, not seeded.

**Linear** ⚠️ *unverified* — signup → workspace name → invite (skippable) → template or blank → lands in workspace with example issues. ~3 screens to interactive. Needs live verification.

**Vercel** ⚠️ *unverified* — GitHub OAuth → import repo or template → deploy → live URL. Aha = deployed URL.

**Supabase** ⚠️ *unverified* — signup → project provisioning (~1min wait) → SQL editor with prepopulated `public` schema and first-query CTA.

**Notion** (the Doug reference) ⚠️ *flow unverified, AI triggers verified* — template-gallery-first approach unverified. AI triggers confirmed below.

**Takeaway (reinforced by verified Helicone/Langfuse data)**: both direct competitors gate the aha moment on a code change and offer **no seeded demo data at all**. That's a 5-6 step walk, likely minutes-to-hours before a first-time user sees anything. **Landing a new signup on a populated dashboard in under 10 seconds is a real, verifiable category differentiator.**

---

## 2. Always-present AI pattern

**Notion AI triggers** ✅ *verified [notion.com/help/notion-ai-faqs](https://www.notion.com/help/notion-ai-faqs)*:
- **Global keyboard shortcut**: `Shift+Cmd+J` (Mac) / `Shift+Ctrl+J` (Win) — NOT `Cmd+J` alone. Works even when not inside Notion. Customizable in Settings → Preferences.
- **Inline triggers inside pages**: press `Space` on an empty line, highlight text + AI option, or `/AI Block` slash command.
- **Context**: workspace + connected apps are available; `@`-mentions inside AI queries pull specific pages/people into context.
- **UI presentation** (modal vs slide-over vs command palette): NOT explicitly documented. Verify from the live app before copying exactly.

**Other reference points** ⚠️ *unverified*: Cursor (`Cmd+L`), Linear (`Cmd+K`), Raycast, Arc Max all use global shortcut + persistent surface. Slide-over from the right is the right pattern for Observe — answers are verbose (numbers, tables), user wants the dashboard visible beside.

**For Observe**:
- **Shortcut**: use `Cmd+K` or `Cmd+Shift+K` to avoid clashing with Chrome's `Cmd+Shift+J` devtools and Notion's `Shift+Cmd+J` if the user has Notion open in another tab.
- **Surface**: right-side slide-over. ~480px wide, backdrop-blurred, page stays clickable.
- **Context**: current route + visible record IDs injected client-side as hidden first message. Stateless across sessions is fine for v1.
- **Empty state**: 4–6 suggestion chips, route-adaptive.
- **Rich state**: same UI, suggestions shift toward visible data.

---

## 3. What IS Observe's aha moment?

**Options evaluated**:
- **(a) Sample-data-first** — land on Insights with pre-loaded demo account showing cost/revenue/margin, fully clickable. Ask AI "why is Acme unprofitable".
- **(b) Your-data-first** — paste OpenAI admin key, pull 7 days. Real but slow, and OpenAI admin keys are rare; Anthropic has no equivalent.
- **(c) SDK-first** — current Quick Start. Matches Helicone/Langfuse. We lose.

**Recommendation: (a), with a persistent "Connect your data" pill always visible.**

**Rationale**: ICP is sophisticated and burned — they trust clickable product, not screenshots. Competitors all fail this; landing on a populated dashboard in <10s is a real category differentiator. (b) fails in practice on key availability + 30s wait. (c) is the losing playbook.

**Tradeoffs**:
- (a) risks sample-data-leak bugs (see memory `bugs_test_data_leaks.md`). **Mitigate**: demo account is READ-ONLY, fixed `accountId`, tagged "Demo" in top bar until user connects real data.
- (a) doesn't get user to *their own* first event — that's fine, "Connect your data" is one click away.

**Key insight**: Guest mode *already* delivers this pre-signup. The redesign is simply: **preserve that exact state across the signup boundary.** Currently signup wipes it.

---

## 4. Screen flow

Target: **<10s from "Sign up" click → populated Insights.**

```
Landing (/) — guest mode, sample data visible
  │  user clicks "Sign up" top-right
  ▼
Signup modal (overlay, NOT route nav) — email+password OR Google OAuth
  │  ~3s type, ~1s submit
  ▼
Insights (/insights) — SAME sample data still there, plus:
  - toast: "Account created. You're looking at demo data."
  - top-bar pill: "Demo data · [Connect your data]"
  - floating AI button bottom-right (new)
  - first-visit only: tooltip "Ask anything — Cmd+J"
```

**2 screens total.** Signup is a modal, not a route. Sample data persists. Aha well under 10s.

**Connect-data flow (deferred, not forced)**: click pill → slide-over with 3 tabs (Stripe · CSV · SDK proxy).

**AI modal**: global shortcut + floating button opens right-side slide-over using existing `ChatPage.vue` logic repackaged. ~480px wide, backdrop-blurred, page stays clickable. Suggestion chips below header, route-adaptive. Context injected client-side as hidden first message: `"Current page: /insights. Visible customers: [top 5 by spend]"`. No backend change.

---

## 5. Implementation notes (Vue codebase)

### Files to touch

1. **`src/layouts/AppLayout.vue`** — add `<AiAssistantPanel />` child, floating trigger button, `Cmd+?` keydown at layout level.
2. **`src/pages/ChatPage.vue`** → extract to **`src/components/shared/AiAssistantPanel.vue`**. Strip the `h-[calc(100vh-...)]` wrapper, re-parent in a Sheet with `open`/`@close` props. All logic (`sendChatMessage`, `executeChatAction`, `SUGGESTIONS`) reused verbatim. `/chat` already redirects — deleting `ChatPage.vue` after extraction is safe.
3. **`src/pages/LoginPage.vue`** — keep `/signup` route but change post-signup redirect (line 139–140): if the pre-signup session was in sample mode, preserve the flag through `useDataMode` so Insights renders populated.
4. **`src/composables/useDataMode.ts`** + **`useAuth.ts`** — ensure `isSampleData` survives `signup()`. Currently unknown; **this is the load-bearing question**. If it resets, flip the default so any new account starts in sample mode until the user runs their first real connection. Add `hasRealData` derived flag for the Demo pill.
5. **`src/pages/OnboardingPage.vue`** — delete. Already unrouted. If the Quick Start code snippets are worth keeping, move into a `ConnectDataSlideOver.vue` reachable from the pill.
6. **`src/pages/InsightsPage.vue`** — add Demo pill when `isSampleData`; first-auth toast.
7. **`src/components/ui/`** — check for shadcn-vue `Sheet`. If missing, add it. That's the slide-over primitive.

### New components
- `shared/AiAssistantPanel.vue` (extracted from ChatPage, wrapped in Sheet)
- `shared/AiAssistantTrigger.vue` (floating button + shortcut listener)
- `shared/DemoDataPill.vue` (top-bar indicator + Connect action)

### Reused as-is
`sendChatMessage`, `executeChatAction`, `SUGGESTIONS`, `StripeApiKeyModal`, `uploadProviderCsv`, `createSdkKey`.

### Backend changes
**None.** Context injection is client-side prepend. No DB migrations. No `server/index.ts`.

### Risks
- Sample-data leak pattern — tag demo account ID in one constant, verify every `clearSampleData` copy.
- Whether demo is per-user or global read-only determines seeding need.
- **Shortcut collision watch**: Chrome uses `Cmd+Shift+J` for downloads/devtools; Notion uses `Shift+Cmd+J` globally for AI. Prefer `Cmd+K` or `Cmd+Shift+K` for Observe. Grep `AppLayout.vue` for existing keydown first.
- Sheet must not trap scroll of underlying page.

---

## 6. Out of scope (explicit punt list)

- No Insights rewrite. Stays as-is; just becomes the landing.
- No new AI capabilities. Page-context is a one-line client prepend.
- No onboarding checklist / progress bars / email drips. Dilutes aha.
- One tooltip only, first visit only.
- No Stripe OAuth improvements — keep existing modal behind the pill.
- No new pages or routes. Deleting, not adding.
- No mobile-specific panel — Sheet collapses to full-screen on mobile, good for v1.
- No analytics redesign. One new PostHog event (`demo_data_viewed_authed`).

---

## Repo findings (verified locally)

- `OnboardingPage.vue` and `ChatPage.vue` both exist but are **unrouted** — router.ts redirects `/onboarding` → `/data-sources` and `/chat` → `/insights`. Safe to delete/repurpose.
- Post-signup redirect is hardcoded in `LoginPage.vue:139-140` to `route.query.redirect || "/"`, and `/` → `/insights`.
- `src/composables/useDataMode.ts` exists — handles sample vs real mode. **Whether `signup()` preserves sample state is the critical unknown.**
- No chat modal infrastructure exists. Sparkles icon present in `AppLayout.vue:21,82` (existing nav entry).
- `src/components/onboarding/` already has `OnboardingChecklist`, `UploadWizard`, `ColumnMapper`, `ImportGuide` — reusable.

---

## Ready for tonight? — first 5 moves

1. **Verify sample-data persistence** — read `useDataMode.ts` + `useAuth.ts`, confirm whether `signup()` preserves `isSampleData`. **This single answer decides whether the rest is a 1-hour or 4-hour change.**
2. **Check shadcn-vue `Sheet`** in `src/components/ui/`. If present, slide-over is free.
3. **Grep for existing `keydown` handlers** in AppLayout + composables. Pick a non-colliding shortcut — `Cmd+K` or `Cmd+Shift+K`. Avoid `Shift+Cmd+J` (Notion global AI) and `Cmd+Shift+J` (Chrome devtools).
4. **PR #1: Extract ChatPage → AiAssistantPanel in a Sheet**, wire floating trigger in AppLayout. Independently valuable, doesn't touch auth. **Ship this first.**
5. **PR #2: Signup redirect + Demo pill + sample-data persistence.** Separate branch per Doug's feature-branch rule.

---

## Key file paths

- `src/pages/ChatPage.vue`
- `src/pages/OnboardingPage.vue`
- `src/pages/LoginPage.vue` (line 139–140 redirect)
- `src/pages/InsightsPage.vue`
- `src/layouts/AppLayout.vue`
- `src/composables/useDataMode.ts`
- `src/composables/useAuth.ts`
- `src/router.ts`

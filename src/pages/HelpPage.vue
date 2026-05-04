<script setup lang="ts">
import { ref } from "vue";

const openSection = ref<string | null>(null);

function toggle(id: string) {
  openSection.value = openSection.value === id ? null : id;
}

function openFeedback() {
  window.dispatchEvent(new Event("observe:open-feedback"));
}

const sections = [
  {
    id: "getting-started",
    title: "Getting Started",
    items: [
      {
        q: "How do I install Observe?",
        a: "Go to Data Sources, copy the install prompt, and paste it into your AI coding agent (Claude Code, Cursor, Copilot). It auto-detects your setup and adds a fire-and-forget POST after each LLM call. No SDK required.",
      },
      {
        q: "What do I need to start tracking?",
        a: "Just an API key from Data Sources and one line of code after each LLM call. Observe computes cost automatically from the model and token counts you send.",
      },
      {
        q: "Do I need to connect Stripe?",
        a: "No. Stripe is optional. Without it, Observe tracks cost only. With Stripe connected, it auto-attributes revenue from subscriptions so you can see margins per customer.",
      },
      {
        q: "Is there a walkthrough I can follow?",
        a: "Yes — we have an interactive walkthrough that covers connecting Stripe and setting up cost alerts.",
        link: {
          url: "https://app.arcade.software/share/zlgVxH8jCm5sGpfKh4MZ",
          label: "Watch the setup walkthrough",
        },
      },
    ],
  },
  {
    id: "cost",
    title: "Cost Tracking",
    items: [
      {
        q: "How is cost calculated?",
        a: "Observe looks up per-token pricing from OpenRouter pricing tables for the model you specify. Cost = inputTokens * inputPrice + outputTokens * outputPrice. If you send costAmount explicitly, that overrides auto-calculation.",
      },
      {
        q: "Which models are supported?",
        a: "All major models from OpenAI, Anthropic, Google, Mistral, Cohere, and others. Pricing is refreshed on every server boot from OpenRouter. Check the Models page to see your usage breakdown.",
      },
      {
        q: "What if my model isn't in the pricing table?",
        a: "Send costAmount explicitly in your event payload. Observe will use that instead of looking up the model price.",
      },
      {
        q: "Can I track non-AI costs like Pinecone, Supabase, or AWS?",
        a: "Yes. Send an event with costAmount (in USD) and costType set to any label like 'vector_db', 'database', 'compute', or 'storage'. No model or token fields needed. See the Infrastructure costs section under Manual Integration on the Data Sources page.",
      },
      {
        q: "What is costType?",
        a: "A label that categorizes costs. Defaults to 'llm' for AI calls. Use any string for non-AI costs: 'vector_db', 'database', 'compute', 'storage', 'search', etc. Shows up in cost breakdowns so you can see total spend by category.",
      },
    ],
  },
  {
    id: "revenue",
    title: "Revenue & Margins",
    items: [
      {
        q: "How does revenue attribution work?",
        a: "Three sources, in priority order: (1) Explicit revenueAmount in the event payload. (2) Feature Pricing rules you set in Data Sources (e.g. $0.05 per blog_post call). (3) Stripe subscription data joined at query time for customer-level margin views.",
      },
      {
        q: "How is Stripe MRR allocated?",
        a: "Flat subscriptions show MRR at the customer level only. Metered/usage-based: exact per-unit revenue stamped on each SDK event. Tiered: tier-based unit price from Stripe pricing tiers applied per event.",
      },
      {
        q: "How is margin calculated?",
        a: "Margin = (revenue - cost) / revenue * 100%. Shown per customer on the Customers page. If revenue is 0, margin shows as '—' since there's no revenue to measure against. Extreme negative margins are capped at < -999% for readability.",
      },
      {
        q: "Why don't I see a customer until they have events?",
        a: "Customers appear on the Customers page only after your app sends at least one SDK event with their customerReferenceId. Stripe-imported customers without usage data are hidden because margins would be meaningless without cost data. Connect Stripe, instrument your code, and customers appear automatically as events flow in.",
      },
      {
        q: "What are the cohort labels?",
        a: "Four cohorts with clear thresholds: Unprofitable (negative margin or zero revenue with cost), Rising Cost (cost trending up with margin under 30%), Inactive (fewer than 3 active days and low adoption), Champion (margin above 50% with strong engagement). Customers not matching any cohort have no label.",
      },
      {
        q: "Can I create custom cohorts?",
        a: "Yes. On the Customers page, click Create Cohort. Static cohorts let you pick customers manually. Dynamic cohorts use rules (margin %, total cost, revenue, active days) to auto-group customers that match your criteria.",
      },
    ],
  },
  {
    id: "stripe",
    title: "Stripe Integration",
    items: [
      {
        q: "Which Stripe key do I use?",
        a: "Use the same Stripe secret key (sk_test_... or sk_live_...) that your app uses. If using a restricted key, enable read-only access to: Customers, Subscriptions, Products, and Prices.",
      },
      {
        q: "Why does Stripe sync show 0 customers?",
        a: "You may have entered a key for a different Stripe account than the one your app uses. The key in Observe must connect to the same Stripe account where your customers and subscriptions live.",
      },
      {
        q: "How often does Stripe sync?",
        a: "Manually via the Sync button on Data Sources. Each sync pulls the latest customers, subscriptions, and prices from Stripe and replaces the local copy.",
      },
    ],
  },
  {
    id: "events",
    title: "Events & Ingest",
    items: [
      {
        q: "What is an event?",
        a: "One LLM API call = one event. Each event includes: who called it (customerReferenceId), what feature (featureKey), which model, token counts, and duration.",
      },
      {
        q: "What is customerReferenceId?",
        a: "Your end-user's stable ID. Use their Stripe customer ID if available, otherwise any unique user identifier. This links events to customers for margin analysis.",
      },
      {
        q: "What is featureKey?",
        a: 'A label for the AI feature in your product — e.g. "ai_chat", "summarize_email", "code_autocomplete". One per feature, not per model. Used for cost breakdown by feature.',
      },
      {
        q: "What is idempotencyKey?",
        a: "A unique ID for each event (use the provider's request ID). Makes retries safe — if you send the same event twice, Observe deduplicates it.",
      },
      {
        q: "What happens if ingest fails?",
        a: "Fire-and-forget is the recommended pattern. Catch errors and log them, but don't block your user's request on Observe. Events that fail to ingest can be retried.",
      },
    ],
  },
  {
    id: "team",
    title: "Team & Organizations",
    items: [
      {
        q: "What is an organization?",
        a: "An organization is a shared workspace. All data — events, customers, costs, SDK keys — belongs to an organization. Every user gets an organization when they sign up.",
      },
      {
        q: "How do I invite a team member?",
        a: "Click Team in the sidebar to open organization settings, then go to Members. You can invite people by email. They'll get an invite to join your organization.",
      },
      {
        q: "What's the difference between Admin and Member?",
        a: "Admins can invite/remove members, rename the organization, and manage settings. Members can access all the same data but can't manage people or settings. Both see the same events, costs, and customers.",
      },
      {
        q: "Can someone be in multiple organizations?",
        a: "Yes. Use the dropdown in the top-left of the sidebar to switch between organizations. Each organization has its own data, SDK keys, and team members.",
      },
      {
        q: "How do I create a new organization?",
        a: "Click the dropdown in the top-left of the sidebar and select Create Organization. Useful if you manage multiple products or clients that need separate data.",
      },
    ],
  },
  {
    id: "traces",
    title: "Traces",
    items: [
      {
        q: "What are traces?",
        a: "Traces group multi-step agent runs into a single view. Each trace contains spans — individual LLM calls, embeddings, vector DB lookups, or other steps — with cost attribution per span.",
      },
      {
        q: "How do I create a trace?",
        a: "Pass a traceId field in your SDK events. All events sharing the same traceId are grouped into one trace. Use any unique string — a UUID or your own request ID.",
      },
      {
        q: "What cost types show up in traces?",
        a: "Spans are color-coded by costType: LLM, embedding, vector_db, compute, and api. Each span shows its individual cost, tokens, and duration in a waterfall timeline.",
      },
    ],
  },
  {
    id: "plans",
    title: "Plans & Billing",
    items: [
      {
        q: "What plans are available?",
        a: "Free (10,000 events/month, 90-day retention, 3 alerts), Pro at $29/month (100,000 events, 365-day retention, unlimited alerts), and Team at $99/month (1,000,000 events, unlimited retention, priority support).",
      },
      {
        q: "How do I upgrade or downgrade?",
        a: "Go to Plans & Usage in the sidebar. Upgrades go through Stripe Checkout with prorated billing. To downgrade or cancel, use the Manage Subscription button which opens the Stripe Billing Portal.",
      },
      {
        q: "What happens when I hit my event limit?",
        a: "Events beyond your monthly limit are rejected. You'll see usage warnings on the Plans page as you approach the cap. Upgrade anytime to increase your limit.",
      },
    ],
  },
  {
    id: "alerts",
    title: "Alerts",
    items: [
      {
        q: "What can I set alerts on?",
        a: "Daily cost, margin percentage, lowest customer margin, and customer concentration (how much of your cost comes from one customer). Both aggregate and per-customer alerts.",
      },
      {
        q: "How are alerts delivered?",
        a: "Email (via Resend) and/or webhook (Slack-compatible JSON POST). Set either or both when creating an alert rule.",
      },
      {
        q: "What is cooldown?",
        a: "Minimum time between re-triggers of the same alert. Default is 60 minutes. Prevents alert spam when a metric stays above/below threshold.",
      },
    ],
  },
];
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <h1 class="text-2xl font-bold mb-2">FAQ</h1>
    <p class="text-muted-foreground mb-8">
      Common questions about Observe. Can't find what you need?
      <button
        class="text-primary underline underline-offset-2"
        @click="openFeedback"
      >
        Send us feedback
      </button>
    </p>

    <div class="space-y-3">
      <div
        v-for="section in sections"
        :key="section.id"
        class="border rounded-lg overflow-hidden"
      >
        <button
          class="w-full flex items-center justify-between px-5 py-4 text-left font-semibold text-sm hover:bg-muted/30 transition-colors"
          @click="toggle(section.id)"
        >
          {{ section.title }}
          <span class="text-muted-foreground text-xs">{{
            openSection === section.id ? "−" : "+"
          }}</span>
        </button>
        <div v-if="openSection === section.id" class="border-t">
          <div
            v-for="(item, i) in section.items"
            :key="i"
            class="px-5 py-4"
            :class="{ 'border-t': i > 0 }"
          >
            <h3 class="font-medium text-sm mb-2">{{ item.q }}</h3>
            <p class="text-sm text-muted-foreground leading-relaxed">
              {{ item.a }}
              <a
                v-if="item.link"
                :href="item.link.url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-block mt-1 text-primary underline underline-offset-2"
              >
                {{ item.link.label }} &rarr;
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

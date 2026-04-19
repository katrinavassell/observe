<script setup lang="ts">
import { ref } from "vue";

const openSection = ref<string | null>(null);

function toggle(id: string) {
  openSection.value = openSection.value === id ? null : id;
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
    ],
  },
  {
    id: "revenue",
    title: "Revenue & Margins",
    items: [
      {
        q: "How does revenue attribution work?",
        a: "Three sources, in priority order: (1) Explicit revenueAmount in the event payload. (2) Feature Pricing rules you set in Data Sources (e.g. $0.05 per blog_post call). (3) Stripe subscription MRR, allocated per customer.",
      },
      {
        q: "How is Stripe MRR allocated?",
        a: "Flat subscriptions: MRR / 30, allocated per day. Metered/usage-based: exact per-unit revenue. Tiered/graduated: tier lookup based on month-to-date usage.",
      },
      {
        q: "How is margin calculated?",
        a: "Margin = (revenue - cost) / revenue * 100%. Shown per customer on the Customers page. If revenue is 0 but cost > 0, margin is -100% (unprofitable).",
      },
      {
        q: "What is the health score?",
        a: "A 0-100 score combining margin (60% weight) and activity in the last 30 days (40% weight). Drives cohort assignment: Champion (high margin + active), At Risk, Unprofitable, Inactive, Rising Cost.",
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
    title: "Team & Accounts",
    items: [
      {
        q: "How do I invite a team member?",
        a: "Go to Team Settings, copy the invite link, and share it. They sign up (or log in) and click the link. They get added to your account as an admin and can see all your data.",
      },
      {
        q: "Can someone be on multiple accounts?",
        a: "Yes. Each person has their own account. When invited to another account, they get both — switchable via the account switcher in the top-left of the sidebar.",
      },
      {
        q: "What roles exist?",
        a: "Owner (full access, one per account), Admin (full access, added via invite), Viewer (read-only, not yet enforced).",
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
    <h1 class="text-2xl font-bold mb-2">Help Center</h1>
    <p class="text-muted-foreground mb-8">
      Common questions about Observe. Can't find what you need?
      <button
        class="text-primary underline underline-offset-2"
        @click="$emit('openFeedback')"
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
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

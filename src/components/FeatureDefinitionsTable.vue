<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import {
  Plus,
  Trash2,
  Loader2,
  Zap,
  DollarSign,
  Target,
  Sparkles,
} from "lucide-vue-next";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "radix-vue";
import { Card, CardContent, Button, Input, Label } from "@/components/ui";
import {
  listFeatureDefinitions,
  createFeatureDefinition,
  deleteFeatureDefinition,
  type FeatureDefinition,
  type FeatureDefinitionKind,
} from "@/lib/api";

defineProps<{ title?: string; showTestEventButton?: boolean }>();

const queryClient = useQueryClient();

const { data, isLoading } = useQuery({
  queryKey: ["feature-definitions"],
  queryFn: listFeatureDefinitions,
});

const definitions = computed<FeatureDefinition[]>(
  () => data.value?.definitions ?? [],
);

// ── status line ────────────────────────────────────────────────────────────
const totalEvents = computed(() =>
  definitions.value.reduce((sum, d) => sum + d.event_count, 0),
);
const hasAnyEvents = computed(() => totalEvents.value > 0);

// ── starter templates (shown when the list is empty) ──────────────────────
interface StarterTemplate {
  label: string;
  name: string;
  feature_key: string;
  kind: FeatureDefinitionKind;
  description: string;
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    label: "AI Chat",
    name: "AI Chat",
    feature_key: "ai_chat",
    kind: "cost",
    description: "User-facing chat assistant. Every message is one event.",
  },
  {
    label: "AI SDR",
    name: "AI SDR",
    feature_key: "ai_sdr",
    kind: "outcome",
    description: "Outbound prospecting agent. Measure meetings booked.",
  },
  {
    label: "AI Support",
    name: "AI Support",
    feature_key: "ai_support",
    kind: "value",
    description: "Deflects inbound tickets. Value = time saved.",
  },
  {
    label: "Coding Copilot",
    name: "Coding Copilot",
    feature_key: "code_autocomplete",
    kind: "cost",
    description: "IDE autocomplete. High-volume, cost-sensitive.",
  },
  {
    label: "Custom",
    name: "",
    feature_key: "",
    kind: "cost",
    description: "",
  },
];

// ── create dialog ──────────────────────────────────────────────────────────
const createOpen = ref(false);
const form = ref({
  name: "",
  feature_key: "",
  kind: "cost" as FeatureDefinitionKind,
  description: "",
  code_location: "",
});
const submitting = ref(false);

function resetForm() {
  form.value = {
    name: "",
    feature_key: "",
    kind: "cost",
    description: "",
    code_location: "",
  };
}

function openCreateDialog(template?: StarterTemplate) {
  if (template && template.label !== "Custom") {
    form.value = {
      name: template.name,
      feature_key: template.feature_key,
      kind: template.kind,
      description: template.description,
      code_location: "",
    };
  } else {
    resetForm();
  }
  createOpen.value = true;
}

async function handleCreate() {
  if (!form.value.name.trim()) {
    toast.error("Name is required");
    return;
  }
  submitting.value = true;
  try {
    await createFeatureDefinition({
      name: form.value.name.trim(),
      feature_key: form.value.feature_key.trim() || undefined,
      kind: form.value.kind,
      description: form.value.description.trim() || null,
      code_location: form.value.code_location.trim() || null,
    });
    queryClient.invalidateQueries({ queryKey: ["feature-definitions"] });
    toast.success("Feature added");
    createOpen.value = false;
    resetForm();
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to create feature",
    );
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(def: FeatureDefinition) {
  if (!window.confirm(`Delete "${def.name}"? This can't be undone.`)) return;
  try {
    await deleteFeatureDefinition(def.id);
    queryClient.invalidateQueries({ queryKey: ["feature-definitions"] });
    toast.success("Feature deleted");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to delete");
  }
}

// ── test event ─────────────────────────────────────────────────────────────
const sendingTestEvent = ref(false);

async function sendTestEvent() {
  if (definitions.value.length === 0) {
    toast.error("Declare a feature first");
    return;
  }
  const first = definitions.value[0];
  sendingTestEvent.value = true;
  try {
    const { supabase } = await import("@/lib/supabase");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/events/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify({
        events: [
          {
            eventName: "test_event",
            customerReferenceId: "test_customer",
            featureKey: first.feature_key,
            model: "gpt-4o-mini",
            modelProvider: "openai",
            inputTokens: 100,
            outputTokens: 50,
            durationMs: 500,
            idempotencyKey: `test-${Date.now()}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ingest failed (${res.status}): ${body}`);
    }
    toast.success(`Test event sent as "${first.feature_key}"`);
    queryClient.invalidateQueries({ queryKey: ["feature-definitions"] });
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to send test event",
    );
  } finally {
    sendingTestEvent.value = false;
  }
}

const KIND_META: Record<
  FeatureDefinitionKind,
  { label: string; icon: typeof Zap; class: string }
> = {
  cost: {
    label: "Cost",
    icon: DollarSign,
    class: "bg-amber-500/10 text-amber-600",
  },
  value: { label: "Value", icon: Zap, class: "bg-sky-500/10 text-sky-600" },
  outcome: {
    label: "Outcome",
    icon: Target,
    class: "bg-emerald-500/10 text-emerald-600",
  },
};
</script>

<template>
  <Card class="border-primary/20">
    <CardContent class="p-6 space-y-4">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold text-lg flex items-center gap-2">
            <Sparkles class="w-4 h-4 text-primary" />
            {{ title ?? "Define what you want to measure" }}
          </h2>
          <p class="text-sm text-muted-foreground">
            Declare your product's AI features up front. The install snippet
            sends events against these keys.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <Button
            v-if="showTestEventButton && definitions.length > 0"
            variant="outline"
            size="sm"
            :disabled="sendingTestEvent"
            @click="sendTestEvent"
          >
            <Loader2
              v-if="sendingTestEvent"
              class="w-3.5 h-3.5 mr-1.5 animate-spin"
            />
            <Zap v-else class="w-3.5 h-3.5 mr-1.5" />
            Send test event
          </Button>
          <Button size="sm" @click="openCreateDialog()">
            <Plus class="w-3.5 h-3.5 mr-1.5" />
            Add feature
          </Button>
        </div>
      </div>

      <!-- Status line -->
      <div
        v-if="definitions.length > 0"
        class="text-xs text-muted-foreground border-t border-border pt-3"
      >
        <span class="font-medium text-foreground">{{
          definitions.length
        }}</span>
        {{ definitions.length === 1 ? "feature" : "features" }} defined ·
        <span class="font-medium text-foreground">{{ totalEvents }}</span>
        events received
        <span v-if="!hasAnyEvents" class="text-amber-600">
          · waiting for first event
        </span>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="text-sm text-muted-foreground py-4">
        Loading…
      </div>

      <!-- Empty state: starter templates -->
      <div
        v-else-if="definitions.length === 0"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-2"
      >
        <button
          v-for="t in STARTER_TEMPLATES"
          :key="t.label"
          class="text-left rounded-lg border border-border hover:border-primary hover:bg-accent/50 px-3 py-2.5 transition-colors"
          @click="openCreateDialog(t)"
        >
          <div class="text-sm font-medium">{{ t.label }}</div>
          <div class="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
            {{ t.description || "Start from scratch" }}
          </div>
        </button>
      </div>

      <!-- Table -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border"
            >
              <th class="font-medium py-2 pr-3">Name</th>
              <th class="font-medium py-2 pr-3">Key</th>
              <th class="font-medium py-2 pr-3">Type</th>
              <th class="font-medium py-2 pr-3">Events</th>
              <th class="font-medium py-2 pr-3">Description</th>
              <th class="font-medium py-2 pr-3">Code</th>
              <th class="w-8"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="def in definitions"
              :key="def.id"
              class="border-b border-border/50 hover:bg-muted/30"
            >
              <td class="py-2 pr-3 font-medium">{{ def.name }}</td>
              <td class="py-2 pr-3">
                <code class="text-[11px] bg-muted px-1.5 py-0.5 rounded">{{
                  def.feature_key
                }}</code>
              </td>
              <td class="py-2 pr-3">
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  :class="KIND_META[def.kind].class"
                >
                  <component :is="KIND_META[def.kind].icon" class="w-3 h-3" />
                  {{ KIND_META[def.kind].label }}
                </span>
              </td>
              <td class="py-2 pr-3 tabular-nums">
                <span
                  v-if="def.event_count === 0"
                  class="text-[11px] text-amber-600"
                  >waiting</span
                >
                <span v-else>{{ def.event_count.toLocaleString() }}</span>
              </td>
              <td class="py-2 pr-3 text-muted-foreground max-w-xs truncate">
                {{ def.description || "—" }}
              </td>
              <td
                class="py-2 pr-3 text-muted-foreground text-[11px] max-w-[160px] truncate"
              >
                <a
                  v-if="
                    def.code_location && /^https?:\/\//.test(def.code_location)
                  "
                  :href="def.code_location"
                  target="_blank"
                  rel="noopener"
                  class="text-primary hover:underline"
                >
                  link
                </a>
                <span v-else-if="def.code_location">{{
                  def.code_location
                }}</span>
                <span v-else>—</span>
              </td>
              <td class="py-2">
                <button
                  class="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  @click="handleDelete(def)"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>

  <!-- Create dialog -->
  <DialogRoot v-model:open="createOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 bg-black/40 z-40" />
      <DialogContent
        class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background border rounded-lg shadow-xl p-6 w-full max-w-md z-50 space-y-4"
      >
        <DialogTitle class="text-lg font-semibold">
          Add feature to measure
        </DialogTitle>

        <div class="space-y-3">
          <div>
            <Label>Name</Label>
            <Input v-model="form.name" placeholder="Prompt evaluation" />
          </div>
          <div>
            <Label>Feature key</Label>
            <Input
              v-model="form.feature_key"
              placeholder="prompt_evaluation (auto from name if blank)"
            />
            <p class="text-[11px] text-muted-foreground mt-1">
              This is the <code>featureKey</code> your code will send.
              Lowercase, alphanumeric + underscores.
            </p>
          </div>
          <div>
            <Label>Type</Label>
            <div class="grid grid-cols-3 gap-2 mt-1">
              <button
                v-for="k in ['cost', 'value', 'outcome'] as const"
                :key="k"
                class="rounded border px-2 py-1.5 text-sm capitalize transition-colors"
                :class="
                  form.kind === k
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                "
                @click="form.kind = k"
              >
                {{ k }}
              </button>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input
              v-model="form.description"
              placeholder="Optional — what this measures"
            />
          </div>
          <div>
            <Label>Code location</Label>
            <Input
              v-model="form.code_location"
              placeholder="src/features/chat.ts or https://github.com/..."
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <DialogClose as-child>
            <Button variant="outline" :disabled="submitting">Cancel</Button>
          </DialogClose>
          <Button :disabled="submitting" @click="handleCreate">
            <Loader2
              v-if="submitting"
              class="w-3.5 h-3.5 mr-1.5 animate-spin"
            />
            Add feature
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

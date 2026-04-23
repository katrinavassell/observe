<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { Plus, Trash2, Loader2, Zap } from "lucide-vue-next";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "radix-vue";
import {
  Card,
  CardContent,
  Button,
  Input,
  Label,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import {
  listFeatureDefinitions,
  createFeatureDefinition,
  updateFeatureDefinition,
  deleteFeatureDefinition,
  sendTestEvent as apiSendTestEvent,
  type FeatureDefinition,
} from "@/lib/api";
import { formatCurrency as fmt } from "@/lib/format";

defineProps<{ title?: string; showTestEventButton?: boolean }>();

const queryClient = useQueryClient();

const { data, isLoading, isError, error, refetch } = useQuery({
  queryKey: ["feature-definitions"],
  queryFn: listFeatureDefinitions,
});

const definitions = computed<FeatureDefinition[]>(
  () => data.value?.definitions ?? [],
);

const totalEvents = computed(() =>
  definitions.value.reduce((sum, d) => sum + d.event_count, 0),
);
const hasAnyEvents = computed(() => totalEvents.value > 0);

// ── dialog (create + edit share the same form) ────────────────────────────
type Mode = "create" | "edit";
const dialogOpen = ref(false);
const mode = ref<Mode>("create");
const editingId = ref<number | null>(null);
const form = ref({
  name: "",
  feature_key: "",
  description: "",
});
const submitting = ref(false);

function resetForm() {
  form.value = {
    name: "",
    feature_key: "",
    description: "",
  };
  editingId.value = null;
}

function openCreate() {
  mode.value = "create";
  resetForm();
  dialogOpen.value = true;
}

function openEdit(def: FeatureDefinition) {
  mode.value = "edit";
  editingId.value = def.id;
  form.value = {
    name: def.name,
    feature_key: def.feature_key,
    description: def.description ?? "",
  };
  dialogOpen.value = true;
}

async function handleSubmit() {
  if (!form.value.name.trim()) {
    toast.error("Name is required");
    return;
  }

  submitting.value = true;
  try {
    if (mode.value === "edit" && editingId.value !== null) {
      await updateFeatureDefinition(editingId.value, {
        name: form.value.name.trim(),
        description: form.value.description.trim() || null,
      });
    } else {
      await createFeatureDefinition({
        name: form.value.name.trim(),
        feature_key: form.value.feature_key.trim() || undefined,
        description: form.value.description.trim() || null,
      });
    }

    queryClient.invalidateQueries({ queryKey: ["feature-definitions"] });
    toast.success(mode.value === "edit" ? "Feature updated" : "Feature added");
    dialogOpen.value = false;
    resetForm();
  } catch (err) {
    console.error("feature submit failed:", err);
    toast.error(err instanceof Error ? err.message : "Failed to save feature");
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(def: FeatureDefinition, event: Event) {
  event.stopPropagation();
  if (!window.confirm(`Delete "${def.name}"? This can't be undone.`)) return;
  try {
    await deleteFeatureDefinition(def.id);
    queryClient.invalidateQueries({ queryKey: ["feature-definitions"] });
    toast.success("Feature deleted");
  } catch (err) {
    console.error("deleteFeatureDefinition failed:", err);
    toast.error(err instanceof Error ? err.message : "Failed to delete");
  }
}

// ── test event ─────────────────────────────────────────────────────────────
const sendingTestEvent = ref(false);

async function sendTestEvent() {
  if (definitions.value.length === 0) {
    toast.error("No features yet — send any event and it'll appear here");
    return;
  }
  const first = definitions.value[0];
  sendingTestEvent.value = true;
  try {
    await apiSendTestEvent(first.feature_key);
    toast.success(`Test event sent as "${first.feature_key}"`);
    queryClient.invalidateQueries({ queryKey: ["feature-definitions"] });
  } catch (err) {
    console.error("sendTestEvent failed:", err);
    toast.error(
      err instanceof Error ? err.message : "Failed to send test event",
    );
  } finally {
    sendingTestEvent.value = false;
  }
}
</script>

<template>
  <Card class="border-primary/20">
    <CardContent class="p-6 space-y-4">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold text-lg">
            {{ title ?? "Your features" }}
          </h2>
          <p class="text-sm text-muted-foreground">
            New feature keys from your events show up here automatically. Add a
            revenue price to any feature to see margin.
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
          <Button size="sm" @click="openCreate">
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
        {{ definitions.length === 1 ? "feature" : "features" }} ·
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

      <!-- Error -->
      <div
        v-else-if="isError"
        class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-start justify-between gap-4"
      >
        <div class="text-sm">
          <p class="font-medium text-destructive">
            Couldn't load your features
          </p>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ error instanceof Error ? error.message : "Unknown error" }}
          </p>
        </div>
        <Button size="sm" variant="outline" @click="refetch()">Retry</Button>
      </div>

      <!-- Empty -->
      <div
        v-else-if="definitions.length === 0"
        class="rounded-lg border border-dashed border-border px-6 py-10 text-center"
      >
        <p class="text-sm text-muted-foreground">
          No features yet. They'll appear automatically when your app sends its
          first event with a <code class="font-mono">featureKey</code>.
        </p>
        <p class="text-xs text-muted-foreground mt-2">
          You can also add one manually.
        </p>
      </div>

      <!-- Cards -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="def in definitions"
          :key="def.id"
          class="group rounded-lg border border-border bg-card hover:border-primary hover:bg-accent/30 transition-colors cursor-pointer p-4 space-y-3"
          @click="openEdit(def)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-medium text-sm truncate">{{ def.name }}</div>
              <code
                class="text-[11px] text-muted-foreground font-mono truncate block"
                >{{ def.feature_key }}</code
              >
            </div>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                  @click="handleDelete(def, $event)"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div class="text-muted-foreground">Events</div>
              <div class="font-medium tabular-nums">
                <span
                  v-if="def.event_count === 0"
                  class="text-amber-600 text-[11px]"
                  >waiting</span
                >
                <span v-else>{{ def.event_count.toLocaleString() }}</span>
              </div>
            </div>
            <div>
              <div class="text-muted-foreground">Total cost</div>
              <div class="font-medium tabular-nums">
                {{ fmt(def.total_cost) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>

  <!-- Create / edit dialog -->
  <DialogRoot v-model:open="dialogOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 bg-black/40 z-40" />
      <DialogContent
        class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background border rounded-lg shadow-xl p-6 w-full max-w-md z-50 space-y-4"
      >
        <DialogTitle class="text-lg font-semibold">
          {{ mode === "edit" ? "Edit feature" : "Add feature" }}
        </DialogTitle>

        <div class="space-y-3">
          <div>
            <Label>Name</Label>
            <Input v-model="form.name" placeholder="AI Chat" />
          </div>
          <div>
            <Label>Feature key</Label>
            <Input
              v-model="form.feature_key"
              :disabled="mode === 'edit'"
              placeholder="ai_chat (auto from name if blank)"
            />
            <p class="text-[11px] text-muted-foreground mt-1">
              This is the <code>featureKey</code> your code sends. Lowercase,
              alphanumeric + underscores.<span v-if="mode === 'edit'">
                Immutable once created.</span
              >
            </p>
          </div>
          <div>
            <Label>Description</Label>
            <Input
              v-model="form.description"
              placeholder="Optional — what this measures"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <DialogClose as-child>
            <Button variant="outline" :disabled="submitting">Cancel</Button>
          </DialogClose>
          <Button :disabled="submitting" @click="handleSubmit">
            <Loader2
              v-if="submitting"
              class="w-3.5 h-3.5 mr-1.5 animate-spin"
            />
            {{ mode === "edit" ? "Save" : "Add feature" }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

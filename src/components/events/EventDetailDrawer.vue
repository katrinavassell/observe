<script setup lang="ts">
import { ref, watch } from "vue";
import { Sheet, Badge } from "@/components/ui";
import {
  Clock,
  DollarSign,
  Cpu,
  User,
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-vue-next";
import { getEventDetail } from "@/lib/api";
import type { EventDetail } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

const props = defineProps<{
  open: boolean;
  eventId: number | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const event = ref<EventDetail | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);
const showRequest = ref(false);
const showResponse = ref(false);

watch(
  () => props.eventId,
  async (id) => {
    if (!id) return;
    isLoading.value = true;
    error.value = null;
    showRequest.value = false;
    showResponse.value = false;
    try {
      event.value = await getEventDetail(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load event";
    } finally {
      isLoading.value = false;
    }
  },
);

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString();
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <div class="p-6 space-y-6">
      <!-- Loading -->
      <div v-if="isLoading" class="flex items-center justify-center py-12">
        <div class="text-sm text-muted-foreground">Loading event...</div>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>

      <!-- Event detail -->
      <template v-else-if="event">
        <!-- Header -->
        <div>
          <h2 class="text-lg font-semibold">{{ event.event_name }}</h2>
          <p class="text-sm text-muted-foreground">
            {{ formatDate(event.timestamp) }}
          </p>
        </div>

        <!-- Key metrics -->
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-lg border p-3">
            <div
              class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
            >
              <DollarSign class="h-3 w-3" />
              Cost
            </div>
            <div class="text-sm font-semibold">
              {{ formatCurrency(event.cost_amount) }}
            </div>
          </div>
          <div class="rounded-lg border p-3">
            <div
              class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
            >
              <DollarSign class="h-3 w-3" />
              Revenue
            </div>
            <div class="text-sm font-semibold">
              {{
                event.revenue_amount > 0
                  ? formatCurrency(event.revenue_amount)
                  : "---"
              }}
            </div>
            <div
              v-if="event.revenue_source && event.revenue_source !== 'none'"
              class="text-[10px] text-muted-foreground mt-0.5"
            >
              {{
                event.revenue_source === "feature_pricing"
                  ? "from feature pricing"
                  : event.revenue_source === "mrr_allocation"
                    ? "from MRR allocation"
                    : event.revenue_source
              }}
            </div>
          </div>
          <div v-if="event.latency_ms" class="rounded-lg border p-3">
            <div
              class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
            >
              <Clock class="h-3 w-3" />
              Latency
            </div>
            <div class="text-sm font-semibold">
              {{ event.latency_ms.toLocaleString() }}ms
            </div>
          </div>
          <div class="rounded-lg border p-3">
            <div
              class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
            >
              <Zap class="h-3 w-3" />
              Tokens
            </div>
            <div class="text-sm font-semibold">
              {{ Number(event.usage_units).toLocaleString() }}
            </div>
          </div>
        </div>

        <!-- Metadata -->
        <div class="space-y-2">
          <h3
            class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          >
            Details
          </h3>
          <div class="text-sm space-y-1.5">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Customer</span>
              <span class="font-mono text-xs">{{ event.customer_id }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Feature</span>
              <span class="font-mono text-xs">{{ event.feature_key }}</span>
            </div>
            <div v-if="event.model" class="flex justify-between">
              <span class="text-muted-foreground">Model</span>
              <span class="font-mono text-xs">{{ event.model }}</span>
            </div>
            <div v-if="event.model_provider" class="flex justify-between">
              <span class="text-muted-foreground">Provider</span>
              <span>{{ event.model_provider }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Source</span>
              <Badge variant="outline" class="text-[10px]">{{
                event.source
              }}</Badge>
            </div>
          </div>
        </div>

        <!-- Request body -->
        <div v-if="event.request_body">
          <button
            class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors w-full"
            @click="showRequest = !showRequest"
          >
            <component
              :is="showRequest ? ChevronDown : ChevronRight"
              class="h-3 w-3"
            />
            Request
          </button>
          <div
            v-if="showRequest"
            class="mt-2 rounded-md bg-zinc-950 border border-zinc-800 p-3 overflow-x-auto"
          >
            <pre
              class="text-xs text-zinc-300 whitespace-pre-wrap break-words"
              >{{ formatJson(event.request_body) }}</pre
            >
          </div>
        </div>

        <!-- Response body -->
        <div v-if="event.response_body">
          <button
            class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors w-full"
            @click="showResponse = !showResponse"
          >
            <component
              :is="showResponse ? ChevronDown : ChevronRight"
              class="h-3 w-3"
            />
            Response
          </button>
          <div
            v-if="showResponse"
            class="mt-2 rounded-md bg-zinc-950 border border-zinc-800 p-3 overflow-x-auto"
          >
            <pre
              class="text-xs text-zinc-300 whitespace-pre-wrap break-words"
              >{{ formatJson(event.response_body) }}</pre
            >
          </div>
        </div>

        <!-- Properties -->
        <div
          v-if="event.properties && Object.keys(event.properties).length > 0"
        >
          <h3
            class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
          >
            Properties
          </h3>
          <div class="text-sm space-y-1">
            <div
              v-for="(val, key) in event.properties"
              :key="key"
              class="flex justify-between"
            >
              <span class="text-muted-foreground font-mono text-xs">{{
                key
              }}</span>
              <span class="text-xs">{{ val }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </Sheet>
</template>

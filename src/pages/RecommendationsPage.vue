<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  listRecommendations,
  computeRecommendations,
  type Recommendation,
  type RecommendationStatus,
} from "@/lib/api/recommendations";
import { Lightbulb, RefreshCw, CheckCircle2 } from "lucide-vue-next";
import { Card, Button, Badge, Skeleton } from "@/components/ui";
import MarginRecommendation from "@/components/dashboard/MarginRecommendation.vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { useAuth } from "@/composables/useAuth";

const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

const activeTab = ref<RecommendationStatus>("pending");

const { data: pending, isLoading: loadingPending } = useQuery({
  queryKey: ["recommendations", "pending"],
  queryFn: () => listRecommendations("pending"),
  enabled: isLoggedIn,
});

const { data: applied, isLoading: loadingApplied } = useQuery({
  queryKey: ["recommendations", "applied"],
  queryFn: () => listRecommendations("applied"),
  enabled: isLoggedIn,
});

const { data: dismissed, isLoading: loadingDismissed } = useQuery({
  queryKey: ["recommendations", "dismissed"],
  queryFn: () => listRecommendations("dismissed"),
  enabled: isLoggedIn,
});

const currentList = computed<Recommendation[]>(() => {
  if (activeTab.value === "pending") return pending.value ?? [];
  if (activeTab.value === "applied") return applied.value ?? [];
  return dismissed.value ?? [];
});

const isLoading = computed(() => {
  if (activeTab.value === "pending") return loadingPending.value;
  if (activeTab.value === "applied") return loadingApplied.value;
  return loadingDismissed.value;
});

const recompute = useMutation({
  mutationFn: computeRecommendations,
  onSuccess: (res) => {
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    toast.success(`Recomputed: ${res.count} pending recommendations`);
  },
  onError: () => toast.error("Failed to recompute recommendations"),
});

const tabs: { key: RecommendationStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "applied", label: "Helpful" },
  { key: "dismissed", label: "Not useful" },
];
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Recommendations</h1>
        <p class="text-sm text-muted-foreground">
          Margin fixes surfaced by Observe's recommendation engine.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="recompute.isPending.value"
        @click="recompute.mutate()"
      >
        <RefreshCw
          class="mr-1.5 h-3.5 w-3.5"
          :class="{ 'animate-spin': recompute.isPending.value }"
        />
        Recompute
      </Button>
    </div>

    <div class="flex gap-1 border-b">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
        :class="
          activeTab === tab.key
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <Badge
          v-if="tab.key === 'pending' && (pending?.length ?? 0) > 0"
          variant="secondary"
          class="ml-1.5"
        >
          {{ pending?.length }}
        </Badge>
      </button>
    </div>

    <div v-if="isLoading" class="space-y-3">
      <Skeleton class="h-24 w-full rounded-md" />
      <Skeleton class="h-24 w-full rounded-md" />
    </div>

    <div v-else-if="currentList.length === 0" class="py-16">
      <template v-if="activeTab === 'pending'">
        <div class="mx-auto max-w-lg">
          <div class="text-center mb-8">
            <div
              class="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center"
            >
              <Lightbulb class="h-6 w-6 text-muted-foreground" />
            </div>
            <p class="mt-4 text-base font-medium">No pending recommendations</p>
            <p class="mt-1 text-sm text-muted-foreground">
              When Observe detects issues, actionable fixes appear here.
            </p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg border p-3 space-y-1">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-red-400" />
                <p class="text-xs font-medium">Negative margins</p>
              </div>
              <p class="text-xs text-muted-foreground">
                Customers costing more than they earn
              </p>
            </div>
            <div class="rounded-lg border p-3 space-y-1">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-amber-400" />
                <p class="text-xs font-medium">Model swaps</p>
              </div>
              <p class="text-xs text-muted-foreground">
                Cheaper models for similar quality
              </p>
            </div>
            <div class="rounded-lg border p-3 space-y-1">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-amber-400" />
                <p class="text-xs font-medium">Provider concentration</p>
              </div>
              <p class="text-xs text-muted-foreground">
                Over-reliance on a single AI vendor
              </p>
            </div>
            <div class="rounded-lg border p-3 space-y-1">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-amber-400" />
                <p class="text-xs font-medium">Underpriced features</p>
              </div>
              <p class="text-xs text-muted-foreground">
                Features priced below cost
              </p>
            </div>
            <div class="rounded-lg border p-3 space-y-1">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-blue-400" />
                <p class="text-xs font-medium">Revenue leakage</p>
              </div>
              <p class="text-xs text-muted-foreground">
                Cost with no revenue attribution
              </p>
            </div>
            <div class="rounded-lg border p-3 space-y-1">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-blue-400" />
                <p class="text-xs font-medium">Churn risk</p>
              </div>
              <p class="text-xs text-muted-foreground">
                Customers with declining usage
              </p>
            </div>
          </div>
          <p class="mt-6 text-center text-sm text-muted-foreground">
            Hit <strong class="text-foreground">Recompute</strong> to run the
            engine now.
          </p>
        </div>
      </template>
      <div v-else-if="activeTab === 'applied'" class="text-center">
        <CheckCircle2 class="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p class="mt-3 text-sm text-muted-foreground">
          No applied recommendations yet.
        </p>
      </div>
      <div v-else class="text-center">
        <CheckCircle2 class="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p class="mt-3 text-sm text-muted-foreground">
          No dismissed recommendations.
        </p>
      </div>
    </div>

    <div v-else class="space-y-3">
      <div v-for="rec in currentList" :key="rec.id">
        <MarginRecommendation :recommendation="rec" />
      </div>
    </div>
  </div>
</template>

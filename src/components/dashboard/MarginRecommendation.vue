<script setup lang="ts">
/**
 * Inline recommendation card. Surfaces a single Recommendation pulled
 * from GET /api/v1/recommendations and renders the action row.
 *
 * Use either:
 *   - With explicit `recommendation` prop (parent has it already)
 *   - With `customerKey` prop (auto-fetches the matching pending rec)
 *
 * Emits `talk-to-us` upward so the parent page can open the contact form.
 */
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { Lightbulb, TrendingDown, Sparkles } from "lucide-vue-next";
import {
  type Recommendation,
  type RecommendationSeverity,
  listRecommendations,
  recommendationCustomerKey,
  recommendationFeatureKey,
} from "@/lib/api/recommendations";
import Skeleton from "@/components/ui/skeleton.vue";
import Badge from "@/components/ui/badge.vue";
import RecommendationActions from "./RecommendationActions.vue";

const props = defineProps<{
  recommendation?: Recommendation;
  customerKey?: string;
  featureKey?: string;
}>();

const shouldFetch = computed(
  () => !props.recommendation && (!!props.customerKey || !!props.featureKey),
);

const { data: recommendations, isLoading } = useQuery({
  queryKey: ["recommendations", "pending"],
  queryFn: () => listRecommendations("pending"),
  enabled: shouldFetch,
  staleTime: 1000 * 60 * 5,
});

const matchedRec = computed<Recommendation | null>(() => {
  if (props.recommendation) return props.recommendation;
  const list = recommendations.value ?? [];
  if (props.customerKey) {
    return (
      list.find((r) => recommendationCustomerKey(r) === props.customerKey) ??
      null
    );
  }
  if (props.featureKey) {
    return (
      list.find((r) => recommendationFeatureKey(r) === props.featureKey) ?? null
    );
  }
  return null;
});

const severityStyles: Record<RecommendationSeverity, string> = {
  critical: "border-l-destructive bg-destructive/5 dark:bg-destructive/10",
  warning: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
  info: "border-l-border bg-muted/50 dark:bg-muted/30",
};

const severityIcon = computed(() => {
  const sev = matchedRec.value?.severity;
  if (sev === "critical") return TrendingDown;
  if (sev === "warning") return Lightbulb;
  return Sparkles;
});

const severityBadgeVariant = computed<
  "default" | "destructive" | "outline" | "secondary"
>(() => {
  const sev = matchedRec.value?.severity;
  if (sev === "critical") return "destructive";
  if (sev === "warning") return "secondary";
  return "outline";
});
</script>

<template>
  <div v-if="isLoading && shouldFetch" class="mt-2 px-3">
    <Skeleton class="h-20 w-full rounded-md" />
  </div>

  <div
    v-else-if="matchedRec"
    :class="[
      'mt-2 rounded-md border border-border border-l-4 p-4 shadow-sm transition-colors',
      severityStyles[matchedRec.severity],
    ]"
  >
    <div class="flex items-start gap-3">
      <div class="mt-0.5 shrink-0">
        <component :is="severityIcon" class="h-5 w-5 text-foreground/80" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h4 class="text-sm font-semibold leading-snug text-foreground">
              {{ matchedRec.customer_name || matchedRec.title }}
            </h4>
            <p
              v-if="matchedRec.customer_name"
              class="text-[11px] text-muted-foreground"
            >
              {{ matchedRec.title }}
            </p>
          </div>
          <Badge
            :variant="severityBadgeVariant"
            class="shrink-0 text-[10px] uppercase tracking-wide"
          >
            {{ matchedRec.severity }}
          </Badge>
        </div>
        <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
          {{ matchedRec.description }}
        </p>
        <div class="mt-3">
          <RecommendationActions :recommendation="matchedRec" />
        </div>
      </div>
    </div>
  </div>
</template>

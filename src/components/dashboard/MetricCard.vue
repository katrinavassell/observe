<script setup lang="ts">
/**
 * MetricCard - Reusable metric display card with value, trend, and subtitle
 */

import { computed } from "vue";
import {
  Card,
  CardContent,
  Badge,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-vue-next";

// =============================================================================
// PROPS
// =============================================================================

const props = withDefaults(
  defineProps<{
    title: string;
    value: number | string;
    trend?: number;
    subtitle?: string;
    format?: "currency" | "percent" | "number";
    currency?: string;
    highlight?: boolean;
    tooltip?: string;
  }>(),
  {
    currency: "$",
    format: "number",
    highlight: false,
  },
);

// =============================================================================
// COMPUTED
// =============================================================================

const formattedValue = computed(() => {
  if (typeof props.value === "string") return props.value;

  const amount = props.value;

  if (props.format === "currency") {
    if (amount >= 1000000)
      return `${props.currency}${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000)
      return `${props.currency}${(amount / 1000).toFixed(1)}k`;
    return `${props.currency}${amount.toFixed(0)}`;
  }

  if (props.format === "percent") {
    return `${amount.toFixed(1)}%`;
  }

  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return amount.toFixed(0);
});

const trendIcon = computed(() => {
  if (props.trend === undefined || props.trend === 0) return Minus;
  return props.trend > 0 ? TrendingUp : TrendingDown;
});

const trendColor = computed(() => {
  if (props.trend === undefined || props.trend === 0)
    return "text-muted-foreground";
  return props.trend > 0 ? "text-green-600" : "text-red-600";
});

const trendText = computed(() => {
  if (props.trend === undefined) return "";
  const sign = props.trend >= 0 ? "+" : "";
  return `${sign}${props.trend.toFixed(1)}%`;
});

const trendVariant = computed(() => {
  if (props.trend === undefined || props.trend === 0)
    return "secondary" as const;
  return props.trend > 0 ? ("outline" as const) : ("destructive" as const);
});
</script>

<template>
  <Card
    :class="`hover:shadow-md transition-shadow ${highlight ? 'bg-gradient-to-br from-primary/5 to-primary/10' : ''}`"
  >
    <CardContent class="p-4 sm:p-6">
      <div class="flex items-center justify-between mb-2">
        <span class="flex items-center gap-1 min-w-0">
          <span class="text-sm font-medium text-muted-foreground truncate">{{
            title
          }}</span>
          <Tooltip v-if="tooltip">
            <TooltipTrigger as-child>
              <Info
                class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 cursor-help"
              />
            </TooltipTrigger>
            <TooltipContent class="max-w-xs">{{ tooltip }}</TooltipContent>
          </Tooltip>
        </span>
        <component
          v-if="trend !== undefined"
          :is="trendIcon"
          class="h-4 w-4 flex-shrink-0"
          :class="trendColor"
        />
      </div>
      <p class="text-2xl font-bold">{{ formattedValue }}</p>
      <div class="flex items-center justify-between mt-1">
        <p v-if="subtitle" class="text-xs text-muted-foreground">
          {{ subtitle }}
        </p>
        <Badge
          v-if="trend !== undefined"
          :variant="trendVariant"
          class="text-xs"
        >
          {{ trendText }}
        </Badge>
      </div>
    </CardContent>
  </Card>
</template>

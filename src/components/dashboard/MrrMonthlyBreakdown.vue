<script setup lang="ts">
/**
 * MrrMonthlyBreakdown - ProfitWell-style monthly MRR movement table
 *
 * Shows New, Expansion, Contraction, Churn breakdown with visual bars
 */

import { computed } from "vue";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";

// =============================================================================
// TYPES
// =============================================================================

export interface MrrMonthData {
  month: string; // "Jan 2024"
  monthShort: string; // "Jan"
  new: number;
  expansion: number;
  contraction: number;
  churn: number;
  netNew: number;
  total: number;
  previousTotal?: number;
}

// =============================================================================
// PROPS
// =============================================================================

const props = withDefaults(
  defineProps<{
    data: MrrMonthData[];
    currency?: string;
    showGrowth?: boolean;
    compact?: boolean;
  }>(),
  {
    currency: "$",
    showGrowth: false,
    compact: false,
  },
);

// =============================================================================
// COMPUTED
// =============================================================================

// Calculate totals
const totals = computed(() => {
  return props.data.reduce(
    (acc, month) => ({
      new: acc.new + month.new,
      expansion: acc.expansion + month.expansion,
      contraction: acc.contraction + month.contraction,
      churn: acc.churn + month.churn,
      netNew: acc.netNew + month.netNew,
      total: acc.total + month.total,
    }),
    { new: 0, expansion: 0, contraction: 0, churn: 0, netNew: 0, total: 0 },
  );
});

// Calculate percentages
const percentages = computed(() => {
  const total = totals.value.total || 1;
  return {
    new: (totals.value.new / total) * 100,
    expansion: (totals.value.expansion / total) * 100,
    contraction: (totals.value.contraction / total) * 100,
    churn: (totals.value.churn / total) * 100,
    netNew: (totals.value.netNew / total) * 100,
  };
});

// =============================================================================
// HELPERS
// =============================================================================

function formatCurrency(amount: number, compact: boolean = true): string {
  if (compact && Math.abs(amount) >= 1000000) {
    return `${props.currency}${(amount / 1000000).toFixed(1)}M`;
  }
  if (compact && Math.abs(amount) >= 1000) {
    return `${props.currency}${(amount / 1000).toFixed(1)}k`;
  }
  return `${props.currency}${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function calculateGrowth(current: number, previous?: number): string {
  if (!previous || previous === 0) return "";
  const growth = ((current - previous) / previous) * 100;
  const sign = growth >= 0 ? "+" : "";
  return `${sign}${growth.toFixed(1)}%`;
}

function getGrowthColor(growth: string): string {
  if (!growth) return "text-muted-foreground";
  const value = parseFloat(growth);
  if (value > 0) return "text-green-600";
  if (value < 0) return "text-red-600";
  return "text-muted-foreground";
}
</script>

<template>
  <Card>
    <!-- Header -->
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <div>
          <CardTitle class="text-lg">MRR Movement</CardTitle>
          <p class="text-sm text-muted-foreground">
            Monthly breakdown of new, expansion, contraction, and churn
          </p>
        </div>
        <div class="hidden sm:flex items-center gap-4 text-sm">
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 bg-green-500 rounded" />
            <span class="text-muted-foreground">New & Expansion</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 bg-red-500 rounded" />
            <span class="text-muted-foreground">Contraction & Churn</span>
          </div>
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Summary Bar -->
      <div
        class="grid grid-cols-3 sm:grid-cols-6 gap-4 p-4 bg-muted/50 rounded-lg"
      >
        <div class="text-center">
          <div class="font-semibold text-green-600">
            {{ formatCurrency(totals.new) }}
          </div>
          <div class="text-xs text-muted-foreground">New MRR</div>
          <div class="text-xs text-green-600">
            {{ percentages.new.toFixed(1) }}%
          </div>
        </div>
        <div class="text-center">
          <div class="font-semibold text-green-600">
            {{ formatCurrency(totals.expansion) }}
          </div>
          <div class="text-xs text-muted-foreground">Expansion</div>
          <div class="text-xs text-green-600">
            {{ percentages.expansion.toFixed(1) }}%
          </div>
        </div>
        <div class="text-center">
          <div class="font-semibold text-red-600">
            {{ formatCurrency(totals.contraction) }}
          </div>
          <div class="text-xs text-muted-foreground">Contraction</div>
          <div class="text-xs text-red-600">
            {{ percentages.contraction.toFixed(1) }}%
          </div>
        </div>
        <div class="text-center">
          <div class="font-semibold text-red-600">
            {{ formatCurrency(totals.churn) }}
          </div>
          <div class="text-xs text-muted-foreground">Churn</div>
          <div class="text-xs text-red-600">
            {{ percentages.churn.toFixed(1) }}%
          </div>
        </div>
        <div class="text-center">
          <div
            class="font-semibold"
            :class="totals.netNew >= 0 ? 'text-green-600' : 'text-red-600'"
          >
            {{ totals.netNew >= 0 ? "+" : ""
            }}{{ formatCurrency(totals.netNew) }}
          </div>
          <div class="text-xs text-muted-foreground">Net New</div>
          <div
            class="text-xs"
            :class="totals.netNew >= 0 ? 'text-green-600' : 'text-red-600'"
          >
            {{ percentages.netNew >= 0 ? "+" : ""
            }}{{ percentages.netNew.toFixed(1) }}%
          </div>
        </div>
        <div class="text-center">
          <div class="font-semibold text-lg">
            {{ formatCurrency(totals.total) }}
          </div>
          <div class="text-xs text-muted-foreground">Total MRR</div>
        </div>
      </div>

      <!-- Monthly Table -->
      <div v-if="!compact" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-muted/50">
            <tr>
              <th class="text-left py-3 px-4 font-medium text-muted-foreground">
                Month
              </th>
              <th
                class="text-right py-3 px-4 font-medium text-muted-foreground"
              >
                New MRR
              </th>
              <th
                class="text-right py-3 px-4 font-medium text-muted-foreground"
              >
                Expansion
              </th>
              <th
                class="text-right py-3 px-4 font-medium text-muted-foreground"
              >
                Contraction
              </th>
              <th
                class="text-right py-3 px-4 font-medium text-muted-foreground"
              >
                Churn
              </th>
              <th
                class="text-right py-3 px-4 font-medium text-muted-foreground"
              >
                Net New
              </th>
              <th
                class="text-right py-3 px-4 font-medium text-muted-foreground"
              >
                Total MRR
              </th>
              <th
                v-if="showGrowth"
                class="text-right py-3 px-4 font-medium text-muted-foreground"
              >
                Growth
              </th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr
              v-for="month in data"
              :key="month.month"
              class="hover:bg-muted/30"
            >
              <td class="py-3 px-4">
                <div class="font-medium">{{ month.month }}</div>
              </td>
              <td class="py-3 px-4 text-right tabular-nums text-green-700">
                +{{ formatCurrency(month.new, false) }}
              </td>
              <td class="py-3 px-4 text-right tabular-nums text-green-700">
                +{{ formatCurrency(month.expansion, false) }}
              </td>
              <td class="py-3 px-4 text-right tabular-nums text-red-700">
                -{{ formatCurrency(month.contraction, false) }}
              </td>
              <td class="py-3 px-4 text-right tabular-nums text-red-700">
                -{{ formatCurrency(month.churn, false) }}
              </td>
              <td
                class="py-3 px-4 text-right tabular-nums"
                :class="month.netNew >= 0 ? 'text-green-700' : 'text-red-700'"
              >
                {{ month.netNew >= 0 ? "+" : ""
                }}{{ formatCurrency(month.netNew, false) }}
              </td>
              <td class="py-3 px-4 text-right font-semibold text-lg">
                {{ formatCurrency(month.total) }}
              </td>
              <td v-if="showGrowth" class="py-3 px-4 text-right">
                <span
                  v-if="month.previousTotal"
                  :class="
                    getGrowthColor(
                      calculateGrowth(month.total, month.previousTotal),
                    )
                  "
                  class="text-sm font-medium"
                >
                  {{ calculateGrowth(month.total, month.previousTotal) }}
                </span>
                <span v-else class="text-muted-foreground">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Visual Bars -->
      <div class="space-y-2 pt-2 border-t">
        <p class="text-xs text-muted-foreground font-medium">Last 6 Months</p>
        <div
          v-for="month in data.slice(-6)"
          :key="`visual-${month.month}`"
          class="flex items-center gap-2"
        >
          <div class="w-12 text-xs text-muted-foreground">
            {{ month.monthShort }}
          </div>
          <div
            class="flex-1 flex items-center h-5 bg-muted/30 rounded overflow-hidden"
          >
            <!-- Positive MRR (New + Expansion) -->
            <Tooltip v-if="month.new + month.expansion > 0">
              <TooltipTrigger as-child>
                <div
                  :style="{
                    width: `${Math.min(((month.new + month.expansion) / month.total) * 100, 100)}%`,
                  }"
                  class="h-full bg-green-500"
                />
              </TooltipTrigger>
              <TooltipContent
                >New+Expansion:
                {{
                  formatCurrency(month.new + month.expansion)
                }}</TooltipContent
              >
            </Tooltip>

            <!-- Negative MRR (Contraction + Churn) -->
            <Tooltip v-if="month.contraction + month.churn > 0">
              <TooltipTrigger as-child>
                <div
                  :style="{
                    width: `${Math.min(((month.contraction + month.churn) / month.total) * 100, 100)}%`,
                  }"
                  class="h-full bg-red-500"
                />
              </TooltipTrigger>
              <TooltipContent
                >Contraction+Churn: -{{
                  formatCurrency(month.contraction + month.churn)
                }}</TooltipContent
              >
            </Tooltip>

            <!-- Base MRR (remaining) -->
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="h-full bg-gray-300 dark:bg-gray-600 flex-1" />
              </TooltipTrigger>
              <TooltipContent>Existing MRR</TooltipContent>
            </Tooltip>
          </div>
          <div class="w-16 text-right text-xs font-medium">
            {{ formatCurrency(month.total) }}
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { ChevronRight, Cpu } from "lucide-vue-next";
import FeatureDefinitionsTable from "@/components/FeatureDefinitionsTable.vue";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import { useAuth } from "@/composables/useAuth";
import { getFeatures, type FeatureSummary } from "@/lib/api/features";
import { formatCurrency, formatPct } from "@/lib/format";

interface FeatureMetrics extends FeatureSummary {
  top_model: string | null;
  model_count: number;
}

const router = useRouter();
const { isLoggedIn } = useAuth();

const activeTab = ref<"economics" | "configure">("economics");

const { data: features } = useQuery({
  queryKey: ["features"],
  queryFn: getFeatures as () => Promise<FeatureMetrics[]>,
  enabled: isLoggedIn,
});

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push("/data-sources");
}

function marginBarWidth(pct: number | null): number {
  if (pct === null) return 0;
  return Math.min(Math.abs(pct), 100);
}
</script>

<template>
  <div class="space-y-6 pb-12">
    <nav
      class="flex items-center gap-1 text-xs text-muted-foreground"
      aria-label="Breadcrumb"
    >
      <router-link
        to="/data-sources"
        class="hover:text-foreground transition-colors"
      >
        Data Sources
      </router-link>
      <ChevronRight class="h-3 w-3" />
      <span class="text-foreground font-medium">Features</span>
    </nav>

    <div class="flex items-start gap-3">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-9 w-9 p-0 shrink-0 -ml-2"
            @click="goBack"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-5 w-5"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Back</TooltipContent>
      </Tooltip>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Features</h1>
        <p class="text-muted-foreground">
          Cost, revenue, and margin per feature across your AI product.
        </p>
      </div>
    </div>

    <template v-if="isLoggedIn">
      <div class="flex gap-1 border-b">
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
          :class="
            activeTab === 'economics'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'economics'"
        >
          Economics
        </button>
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
          :class="
            activeTab === 'configure'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'configure'"
        >
          Configure
        </button>
      </div>

      <!-- Economics tab -->
      <div
        v-if="activeTab === 'economics'"
        class="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <Card
          v-for="f in features"
          :key="f.feature_key"
          class="overflow-hidden"
          :class="
            f.margin_pct !== null && f.margin_pct < 0
              ? 'border-t-2 border-t-destructive'
              : ''
          "
        >
          <CardContent class="p-5 space-y-4">
            <!-- Header: feature key + model badge -->
            <div class="flex items-center justify-between gap-2">
              <code class="text-sm font-semibold bg-muted px-2 py-0.5 rounded">
                {{ f.feature_key }}
              </code>
              <div class="flex items-center gap-2">
                <Badge
                  v-if="f.top_model"
                  variant="secondary"
                  class="text-xs gap-1"
                >
                  <Cpu class="h-3 w-3" />
                  {{ f.model_count === 1 ? f.top_model : "multi-model" }}
                </Badge>
                <Badge
                  v-if="f.margin_pct !== null && f.margin_pct < 0"
                  variant="destructive"
                  class="text-xs"
                >
                  Negative Margin
                </Badge>
                <Badge
                  v-else-if="f.margin_pct !== null"
                  class="text-xs bg-emerald-500/15 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15"
                >
                  Healthy
                </Badge>
              </div>
            </div>

            <!-- Metrics row -->
            <div class="grid grid-cols-3 gap-3">
              <div>
                <p class="text-xs text-muted-foreground">Cost</p>
                <p class="text-lg font-semibold tabular-nums">
                  {{ formatCurrency(f.total_cost) }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">Revenue</p>
                <p class="text-lg font-semibold tabular-nums">
                  {{ formatCurrency(f.total_revenue) }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">Margin</p>
                <p class="text-lg font-semibold tabular-nums">
                  {{ f.margin_pct !== null ? formatPct(f.margin_pct) : "—" }}
                </p>
              </div>
            </div>

            <!-- Margin bar -->
            <div
              v-if="f.margin_pct !== null"
              class="h-2 bg-muted rounded-full overflow-hidden"
            >
              <div
                class="h-full rounded-full transition-all"
                :class="f.margin_pct >= 0 ? 'bg-emerald-500' : 'bg-destructive'"
                :style="{ width: marginBarWidth(f.margin_pct) + '%' }"
              />
            </div>
          </CardContent>
        </Card>

        <!-- Empty state -->
        <div
          v-if="features && features.length === 0"
          class="col-span-full text-center py-12 text-muted-foreground"
        >
          No features detected yet. Send events to see feature economics.
        </div>
      </div>

      <!-- Configure tab -->
      <FeatureDefinitionsTable
        v-if="activeTab === 'configure'"
        show-test-event-button
      />
    </template>

    <!-- Not logged in -->
    <Card v-else class="border-primary/40 bg-primary/5">
      <CardContent class="p-6 text-center space-y-3">
        <h2 class="font-semibold text-lg">Sign in to manage features</h2>
        <p class="text-sm text-muted-foreground max-w-md mx-auto">
          Features auto-detect from your events. Sign up to give them display
          names + revenue prices for accurate margin per feature.
        </p>
        <div class="flex justify-center gap-2 pt-1">
          <Button @click="router.push('/signup')">Sign up free</Button>
          <Button variant="outline" @click="router.push('/login')">
            Log in
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

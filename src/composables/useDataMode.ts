import { ref, computed, onMounted } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { logger } from "@/lib/logger";
import * as api from "@/lib/api";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DataMode = "none" | "sample" | "user";

export interface DataStatus {
  data_mode: DataMode;
  has_data: boolean;
  customer_count: number;
  has_revenue: boolean;
  has_costs: boolean;
  has_usage: boolean;
  revenue_customer_count: number;
  costs_record_count: number;
  usage_record_count: number;
  last_sync_at: string | null;
}

const dataStatus = ref<DataStatus | null>(null);
const isLoading = ref(true);
const isLoadingSample = ref(false);
const isClearingSample = ref(false);

const analyticsQueryKeys = [
  ["events-by-feature"],
  ["events-by-model"],
  ["events-by-customer"],
  ["data-status"],
];

export function useDataMode() {
  const queryClient = useQueryClient();

  const dataMode = computed<DataMode>(
    () => dataStatus.value?.data_mode ?? "none",
  );
  const hasData = computed(() => dataStatus.value?.has_data ?? false);
  const customerCount = computed(() => dataStatus.value?.customer_count ?? 0);
  const isSampleMode = computed(() => dataMode.value === "sample");

  const hasRevenue = computed(() => dataStatus.value?.has_revenue ?? false);
  const hasCosts = computed(() => dataStatus.value?.has_costs ?? false);
  const hasUsage = computed(() => dataStatus.value?.has_usage ?? false);
  const revenueCustomerCount = computed(
    () => dataStatus.value?.revenue_customer_count ?? 0,
  );
  const costsRecordCount = computed(
    () => dataStatus.value?.costs_record_count ?? 0,
  );
  const usageRecordCount = computed(
    () => dataStatus.value?.usage_record_count ?? 0,
  );
  const lastSyncAt = computed(() => dataStatus.value?.last_sync_at ?? null);

  async function refetch(retries = 5) {
    isLoading.value = true;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        dataStatus.value = await api.getDataStatus();
        isLoading.value = false;
        return;
      } catch (error) {
        if (attempt < retries - 1) {
          await sleep(1000);
        } else {
          logger.error("Failed to fetch data status", error);
          dataStatus.value = {
            data_mode: "none",
            has_data: false,
            customer_count: 0,
            has_revenue: false,
            has_costs: false,
            has_usage: false,
            revenue_customer_count: 0,
            costs_record_count: 0,
            usage_record_count: 0,
            last_sync_at: null,
          };
        }
      }
    }
    isLoading.value = false;
  }

  async function switchToSampleData(retries = 5) {
    isLoadingSample.value = true;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await api.loadSampleData();
        window.posthog?.capture("sample_data_loaded");
        await refetch();
        for (const key of analyticsQueryKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        isLoadingSample.value = false;
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries - 1) {
          await sleep(1000);
        } else {
          logger.error("Failed to load sample data", error);
        }
      }
    }
    isLoadingSample.value = false;
    if (lastError) throw lastError;
  }

  async function clearSample() {
    isClearingSample.value = true;
    try {
      await api.clearData();
      await refetch();
      for (const key of analyticsQueryKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    } catch (error) {
      logger.error("Failed to clear sample data", error);
      throw error;
    } finally {
      isClearingSample.value = false;
    }
  }

  function reset() {
    dataStatus.value = null;
    refetch();
  }

  onMounted(() => {
    if (dataStatus.value === null) {
      refetch();
    }
  });

  return {
    dataMode,
    hasData,
    customerCount,
    isSampleMode,
    isLoading,
    status: dataStatus,
    hasRevenue,
    hasCosts,
    hasUsage,
    revenueCustomerCount,
    costsRecordCount,
    usageRecordCount,
    lastSyncAt,
    switchToSampleData,
    clearSample,
    refetch,
    reset,
    isLoadingSample: computed(() => isLoadingSample.value),
    isClearingSample: computed(() => isClearingSample.value),
  };
}

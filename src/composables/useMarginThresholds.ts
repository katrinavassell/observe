import { ref, watch } from "vue";

const STORAGE_KEY = "observe:margin-thresholds";

interface MarginThresholds {
  healthy: number;
  atRisk: number;
}

interface MarginStatus {
  label: string;
  variant: "default" | "warning" | "destructive";
}

const defaults: MarginThresholds = { healthy: 30, atRisk: 0 };

function load(): MarginThresholds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    return {
      healthy:
        typeof parsed.healthy === "number" ? parsed.healthy : defaults.healthy,
      atRisk:
        typeof parsed.atRisk === "number" ? parsed.atRisk : defaults.atRisk,
    };
  } catch {
    return { ...defaults };
  }
}

const thresholds = ref<MarginThresholds>(load());

watch(thresholds, (v) => localStorage.setItem(STORAGE_KEY, JSON.stringify(v)), {
  deep: true,
});

export function useMarginThresholds() {
  function updateThresholds(healthy: number, atRisk: number) {
    thresholds.value = { healthy, atRisk };
  }

  function getStatus(
    marginPct: number | null | undefined,
    hasRevenue: boolean,
  ): MarginStatus {
    if (!hasRevenue) return { label: "No revenue", variant: "default" };
    if (marginPct == null) return { label: "No revenue", variant: "default" };
    if (marginPct >= thresholds.value.healthy)
      return { label: "Healthy", variant: "default" };
    if (marginPct >= thresholds.value.atRisk)
      return { label: "At Risk", variant: "warning" };
    return { label: "Underwater", variant: "destructive" };
  }

  return { thresholds, updateThresholds, getStatus };
}

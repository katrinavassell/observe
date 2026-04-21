import { computed, onMounted, onUnmounted, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  getCurrentAccountId,
  listMyAccounts,
  setCurrentAccountId,
  type AccountMembership,
} from "@/lib/api";
import { useAuth } from "@/composables/useAuth";

export function useAccounts() {
  const { isLoggedIn } = useAuth();

  const query = useQuery({
    queryKey: ["my-accounts"],
    queryFn: listMyAccounts,
    enabled: isLoggedIn,
  });

  const accounts = computed<AccountMembership[]>(
    () => query.data.value?.accounts ?? [],
  );

  const currentAccountId = ref<number | null>(getCurrentAccountId());

  function onAccountChanged(e: Event) {
    const ce = e as CustomEvent<number>;
    currentAccountId.value =
      typeof ce.detail === "number" ? ce.detail : getCurrentAccountId();
  }

  onMounted(() => {
    window.addEventListener("observe:account-changed", onAccountChanged);
  });

  onUnmounted(() => {
    window.removeEventListener("observe:account-changed", onAccountChanged);
  });

  async function switchTo(id: number) {
    if (currentAccountId.value === id) return;
    setCurrentAccountId(id);
    window.location.reload();
  }

  return {
    accounts,
    currentAccountId,
    isLoading: query.isLoading,
    switchTo,
  };
}

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ChevronsUpDown, Check } from "lucide-vue-next";
import { useAccounts } from "@/composables/useAccounts";

const { accounts, currentAccountId, switchTo } = useAccounts();

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const currentAccount = computed(
  () =>
    accounts.value.find((a) => a.id === currentAccountId.value) ??
    accounts.value.find((a) => a.is_current) ??
    accounts.value[0] ??
    null,
);

function handleOutside(e: Event) {
  if (!open.value) return;
  if (rootEl.value && !rootEl.value.contains(e.target as HTMLElement)) {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", handleOutside);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutside);
});

async function onSelect(id: number) {
  open.value = false;
  await switchTo(id);
}
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      @click="open = !open"
      class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent/50 transition-colors"
      :aria-expanded="open"
      aria-haspopup="menu"
    >
      <div
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm"
      >
        O
      </div>
      <div class="flex flex-col min-w-0 flex-1 text-left">
        <span class="text-sm font-semibold leading-tight truncate">{{
          currentAccount?.name ?? "Observe"
        }}</span>
        <span class="text-[10px] text-sidebar-foreground/40 leading-tight"
          >By Tanso</span
        >
      </div>
      <ChevronsUpDown class="h-4 w-4 shrink-0 text-sidebar-foreground/40" />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute left-2 right-2 top-full z-50 mt-1 rounded-lg border border-sidebar-border bg-sidebar shadow-lg overflow-hidden"
    >
      <div class="py-1 max-h-72 overflow-y-auto">
        <button
          v-for="acc in accounts"
          :key="acc.id"
          type="button"
          role="menuitem"
          @click="onSelect(acc.id)"
          :class="[
            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
            acc.id === currentAccount?.id
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50',
          ]"
        >
          <span class="flex-1 truncate">{{ acc.name }}</span>
          <span
            class="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 shrink-0"
          >
            {{ acc.role }}
          </span>
          <Check
            v-if="acc.id === currentAccount?.id"
            class="h-3.5 w-3.5 shrink-0 text-sidebar-primary"
          />
        </button>
      </div>
    </div>
  </div>
</template>

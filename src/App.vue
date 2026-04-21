<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { Toaster } from "vue-sonner";
import { WifiOff } from "lucide-vue-next";
import AppLayout from "@/layouts/AppLayout.vue";
import { useAuth as useClerkAuth } from "@clerk/vue";
import { useOnline } from "@/composables/useOnline";
import { useAuth } from "@/composables/useAuth";
import { registerTokenGetter } from "@/lib/clerk";
import { recordReferral } from "@/lib/api";

const { isOnline } = useOnline();
const { isLoaded, isSignedIn, getToken } = useClerkAuth();
const { isInitialized } = useAuth();
const isLoading = computed(
  () => !isLoaded.value || (isSignedIn.value && !isInitialized.value),
);

registerTokenGetter(
  () => getToken.value(),
  () => !!isSignedIn.value,
);
const route = useRoute();
const router = useRouter();
const noLayout = computed(() => !!route.meta?.noLayout);

watch(
  isInitialized,
  async (initialized) => {
    if (!initialized) return;
    const params = new window.URLSearchParams(window.location.search);
    const refCode = params.get("ref");
    if (!refCode) return;
    try {
      await recordReferral(refCode);
    } catch {
      // Silently ignore referral recording errors
    }
    // Remove the ref param from the URL without reloading
    const url = new URL(window.location.href);
    url.searchParams.delete("ref");
    router.replace({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    });
  },
  { immediate: true },
);
</script>

<template>
  <!-- Offline Banner -->
  <div
    v-if="!isOnline"
    class="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2"
  >
    <WifiOff class="h-4 w-4" />
    You're offline. Some features may not work until you reconnect.
  </div>

  <!-- Toast notifications (global) -->
  <Toaster position="top-center" richColors />

  <!-- Loading state while session initializes -->
  <div v-if="isLoading" class="flex items-center justify-center min-h-screen">
    <div
      class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"
    ></div>
  </div>

  <!-- Pages without the sidebar layout (e.g. invite acceptance) -->
  <RouterView v-else-if="noLayout" />

  <!-- Main app with sidebar -->
  <AppLayout v-else>
    <RouterView />
  </AppLayout>
</template>

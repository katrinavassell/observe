<script setup lang="ts">
import { useRouter } from "vue-router";
import { ChevronRight } from "lucide-vue-next";
import FeatureDefinitionsTable from "@/components/FeatureDefinitionsTable.vue";
import { Button } from "@/components/ui";
import { useAuth } from "@/composables/useAuth";

const router = useRouter();
const { isLoggedIn } = useAuth();

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push("/data-sources");
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
      <Button
        variant="ghost"
        size="sm"
        class="h-9 w-9 p-0 shrink-0 -ml-2"
        title="Back"
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
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Features</h1>
        <p class="text-muted-foreground">
          Label your AI features so Observe can group events, calculate margins,
          and alert per feature.
        </p>
      </div>
    </div>

    <FeatureDefinitionsTable v-if="isLoggedIn" show-test-event-button />

    <div v-else class="text-sm text-muted-foreground">
      Sign in to manage feature definitions.
    </div>
  </div>
</template>

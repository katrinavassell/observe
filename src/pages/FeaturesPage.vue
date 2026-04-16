<script setup lang="ts">
import FeatureDefinitionsTable from "@/components/FeatureDefinitionsTable.vue";
import { useAuth } from "@/composables/useAuth";

const { isLoggedIn } = useAuth();
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Features</h1>
      <p class="text-muted-foreground">
        Label your AI features so Observe can group events, calculate margins,
        and alert per feature.
      </p>
    </div>

    <FeatureDefinitionsTable v-if="isLoggedIn" show-test-event-button />

    <div v-else class="text-sm text-muted-foreground">
      Sign in to manage feature definitions.
    </div>
  </div>
</template>

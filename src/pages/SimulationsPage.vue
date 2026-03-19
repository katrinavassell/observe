<script setup lang="ts">
import { FlaskConical } from 'lucide-vue-next'
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Simulations</h1>
      <p class="text-sm text-muted-foreground mt-1">What-if pricing scenarios and revenue modeling</p>
    </div>

    <div class="rounded-lg border bg-card p-12 text-center">
      <div class="flex items-center justify-center w-14 h-14 rounded-full bg-muted mx-auto mb-4">
        <FlaskConical class="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 class="text-lg font-semibold mb-2">Coming Soon</h2>
      <p class="text-sm text-muted-foreground max-w-sm mx-auto">
        Pricing simulations let you model the revenue and margin impact of changing your plans,
        prices, or packaging — before rolling out changes to customers.
      </p>
    </div>
  </div>
</template>

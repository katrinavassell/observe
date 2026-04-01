<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { CheckCircle, Loader2 } from "lucide-vue-next";
import { getBillingStatus } from "@/lib/api";

const router = useRouter();
const planConfirmed = ref(false);

onMounted(async () => {
  // Poll billing status until plan updates to growth (webhook may be slow)
  for (let i = 0; i < 10; i++) {
    try {
      const status = await getBillingStatus();
      if (status.plan === "growth") {
        planConfirmed.value = true;
        break;
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // Redirect after confirmation or timeout
  planConfirmed.value = true;
  setTimeout(() => router.push("/"), 2000);
});
</script>

<template>
  <div class="flex items-center justify-center min-h-[60vh]">
    <div class="text-center space-y-4">
      <CheckCircle
        v-if="planConfirmed"
        class="h-12 w-12 text-success mx-auto"
      />
      <Loader2
        v-else
        class="h-12 w-12 text-muted-foreground mx-auto animate-spin"
      />
      <h1 class="text-2xl font-semibold">
        {{
          planConfirmed
            ? "Welcome to Growth!"
            : "Confirming your subscription..."
        }}
      </h1>
      <p class="text-muted-foreground">
        {{
          planConfirmed
            ? "Redirecting to your dashboard..."
            : "This may take a few seconds."
        }}
      </p>
    </div>
  </div>
</template>

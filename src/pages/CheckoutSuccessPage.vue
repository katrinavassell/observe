<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CheckCircle, Loader2, XCircle } from "lucide-vue-next";
import { getBillingStatus } from "@/lib/api";
import { logger } from "@/lib/logger";

const route = useRoute();
const router = useRouter();
const planConfirmed = ref(false);
const timedOut = ref(false);
const noSession = ref(false);

onMounted(async () => {
  if (!route.query.session_id) {
    noSession.value = true;
    return;
  }

  for (let i = 0; i < 10; i++) {
    try {
      const status = await getBillingStatus();
      if (status.plan === "growth") {
        planConfirmed.value = true;
        window.posthog?.capture("checkout_completed");
        break;
      }
    } catch (err) {
      logger.error("Failed to check billing status", err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (planConfirmed.value) {
    setTimeout(() => router.push("/"), 2000);
  } else {
    timedOut.value = true;
  }
});
</script>

<template>
  <div class="flex items-center justify-center min-h-[60vh]">
    <div class="text-center space-y-4">
      <XCircle v-if="noSession" class="h-12 w-12 text-destructive mx-auto" />
      <CheckCircle
        v-else-if="planConfirmed"
        class="h-12 w-12 text-success mx-auto"
      />
      <Loader2
        v-else
        class="h-12 w-12 text-muted-foreground mx-auto animate-spin"
      />
      <h1 class="text-2xl font-semibold">
        {{
          noSession
            ? "Invalid checkout session"
            : planConfirmed
              ? "Welcome to Growth!"
              : timedOut
                ? "Still confirming your plan"
                : "Confirming your subscription..."
        }}
      </h1>
      <p class="text-muted-foreground">
        {{
          noSession
            ? "This page requires a valid checkout session."
            : planConfirmed
              ? "Redirecting to your dashboard..."
              : timedOut
                ? "This may take a moment. Check back shortly."
                : "This may take a few seconds."
        }}
      </p>
    </div>
  </div>
</template>

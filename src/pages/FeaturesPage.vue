<script setup lang="ts">
import { useRouter } from "vue-router";
import { ChevronRight } from "lucide-vue-next";
import FeatureDefinitionsTable from "@/components/FeatureDefinitionsTable.vue";
import {
  Button,
  Card,
  CardContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
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
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-9 w-9 p-0 shrink-0 -ml-2"
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
        </TooltipTrigger>
        <TooltipContent>Back</TooltipContent>
      </Tooltip>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Features</h1>
        <p class="text-muted-foreground">
          Features are auto-detected from your events. Edit them here to add
          names and descriptions.
        </p>
      </div>
    </div>

    <FeatureDefinitionsTable v-if="isLoggedIn" show-test-event-button />

    <Card v-else class="border-primary/40 bg-primary/5">
      <CardContent class="p-6 text-center space-y-3">
        <h2 class="font-semibold text-lg">Sign in to manage features</h2>
        <p class="text-sm text-muted-foreground max-w-md mx-auto">
          Features auto-detect from your events. Sign up to give them display
          names + revenue prices for accurate margin per feature.
        </p>
        <div class="flex justify-center gap-2 pt-1">
          <Button @click="router.push('/signup')">Sign up free</Button>
          <Button variant="outline" @click="router.push('/login')">
            Log in
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

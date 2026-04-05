<script setup lang="ts">
/**
 * QuickActions - Action button grid for common dashboard actions
 */

import { type Component } from "vue";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "@/components/ui";

// =============================================================================
// TYPES
// =============================================================================

export interface QuickAction {
  label: string;
  description?: string;
  icon: Component;
  action: () => void;
  variant?: "default" | "secondary" | "outline" | "ghost";
  disabled?: boolean;
}

// =============================================================================
// PROPS
// =============================================================================

const _props = withDefaults(
  defineProps<{
    actions: QuickAction[];
    title?: string;
    columns?: 2 | 3 | 4;
  }>(),
  {
    title: "Quick Actions",
    columns: 3,
  },
);

// =============================================================================
// COMPUTED
// =============================================================================

const gridClass = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ title }}</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="grid gap-4" :class="gridClass[columns]">
        <Card
          v-for="action in actions"
          :key="action.label"
          :class="`hover:shadow-md transition-shadow cursor-pointer ${action.disabled ? 'opacity-50' : ''}`"
          @click="!action.disabled && action.action()"
        >
          <CardContent class="p-6 text-center">
            <component
              :is="action.icon"
              class="h-8 w-8 mx-auto mb-3 text-primary"
            />
            <p class="font-semibold mb-1">{{ action.label }}</p>
            <p
              v-if="action.description"
              class="text-sm text-muted-foreground mb-3"
            >
              {{ action.description }}
            </p>
            <Button
              :variant="action.variant || 'default'"
              size="sm"
              :disabled="action.disabled"
              @click.stop="action.action"
            >
              Take Action
            </Button>
          </CardContent>
        </Card>
      </div>
    </CardContent>
  </Card>
</template>

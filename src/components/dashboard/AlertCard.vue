<script setup lang="ts">
/**
 * AlertCard - Alert display with severity, description, and action buttons
 */

import { computed, type Component } from 'vue'
import { Card, CardContent, Badge, Button } from '@/components/ui'

// =============================================================================
// TYPES
// =============================================================================

export interface AlertAction {
  label: string
  action: () => void
}

export interface Alert {
  id: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'info'
  icon: Component
  actions: AlertAction[]
}

// =============================================================================
// PROPS
// =============================================================================

const props = defineProps<{
  alert: Alert
}>()

// =============================================================================
// COMPUTED
// =============================================================================

const severityConfig = computed(() => {
  const configs = {
    critical: {
      badgeVariant: 'destructive' as const,
      buttonVariant: 'destructive' as const,
      bgColor: 'bg-red-50 dark:bg-red-950/20',
      borderColor: 'border-red-200 dark:border-red-900',
      textColor: 'text-red-800 dark:text-red-200',
      descColor: 'text-red-700 dark:text-red-300',
      iconColor: 'text-red-600 dark:text-red-400',
    },
    warning: {
      badgeVariant: 'outline' as const,
      buttonVariant: 'outline' as const,
      bgColor: 'bg-amber-50 dark:bg-amber-950/20',
      borderColor: 'border-amber-200 dark:border-amber-900',
      textColor: 'text-amber-800 dark:text-amber-200',
      descColor: 'text-amber-700 dark:text-amber-300',
      iconColor: 'text-amber-600 dark:text-amber-400',
    },
    info: {
      badgeVariant: 'secondary' as const,
      buttonVariant: 'secondary' as const,
      bgColor: 'bg-blue-50 dark:bg-blue-950/20',
      borderColor: 'border-blue-200 dark:border-blue-900',
      textColor: 'text-blue-800 dark:text-blue-200',
      descColor: 'text-blue-700 dark:text-blue-300',
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
  }
  return configs[props.alert.severity]
})
</script>

<template>
  <Card :class="`${severityConfig.bgColor} ${severityConfig.borderColor} border`">
    <CardContent class="p-4">
      <div class="flex items-start gap-3">
        <component
          :is="alert.icon"
          :class="severityConfig.iconColor"
          class="h-5 w-5 mt-0.5 flex-shrink-0"
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2 mb-1">
            <p :class="severityConfig.textColor" class="font-semibold">
              {{ alert.title }}
            </p>
            <Badge :variant="severityConfig.badgeVariant" class="flex-shrink-0">
              {{ alert.severity }}
            </Badge>
          </div>
          <p :class="severityConfig.descColor" class="text-sm mb-3">
            {{ alert.description }}
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              v-for="action in alert.actions"
              :key="action.label"
              size="sm"
              :variant="severityConfig.buttonVariant"
              @click="action.action"
            >
              {{ action.label }}
            </Button>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

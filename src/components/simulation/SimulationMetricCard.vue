<script setup lang="ts">
import type { Component } from 'vue'
import { Card, CardContent } from '@/components/ui'
import { Badge } from '@/components/ui'

defineProps<{
  label: string
  value: string
  icon: Component
  gradient: 'green' | 'red' | 'blue' | 'yellow'
  badge?: { label: string; class: string }
}>()

const gradientClasses: Record<string, { card: string; label: string; value: string; icon: string }> = {
  green: {
    card: 'bg-gradient-to-br from-green-50 to-green-100/50 border-green-200',
    label: 'text-green-800',
    value: 'text-green-900',
    icon: 'text-green-600',
  },
  red: {
    card: 'bg-gradient-to-br from-red-50 to-red-100/50 border-red-200',
    label: 'text-red-800',
    value: 'text-red-900',
    icon: 'text-red-600',
  },
  blue: {
    card: 'bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200',
    label: 'text-blue-800',
    value: 'text-blue-900',
    icon: 'text-blue-600',
  },
  yellow: {
    card: 'bg-gradient-to-br from-yellow-50 to-yellow-100/50 border-yellow-200',
    label: 'text-yellow-800',
    value: 'text-yellow-900',
    icon: 'text-yellow-600',
  },
}
</script>

<template>
  <Card :class="gradientClasses[gradient].card">
    <CardContent class="pt-6">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium" :class="gradientClasses[gradient].label">{{ label }}</p>
          <p class="text-2xl font-bold" :class="gradientClasses[gradient].value">{{ value }}</p>
          <Badge v-if="badge" variant="outline" class="mt-1 text-xs" :class="badge.class">
            {{ badge.label }}
          </Badge>
        </div>
        <component :is="icon" class="h-8 w-8" :class="gradientClasses[gradient].icon" />
      </div>
    </CardContent>
  </Card>
</template>

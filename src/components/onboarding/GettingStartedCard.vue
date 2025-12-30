<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { Check, Circle, ChevronRight, X } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui'
import { getDataStatus, getMatches } from '@/api/client'

const emit = defineEmits<{
  (e: 'dismiss'): void
}>()

const router = useRouter()

const { data: dataStatus } = useQuery({
  queryKey: ['data-status'],
  queryFn: getDataStatus,
})

const { data: matchesData } = useQuery({
  queryKey: ['matches'],
  queryFn: () => getMatches(),
})

interface Step {
  id: string
  label: string
  description: string
  completed: boolean
  action?: () => void
  actionLabel?: string
}

const steps = computed<Step[]>(() => {
  const hasData = dataStatus.value?.has_data ?? false
  const accountCount = dataStatus.value?.account_count ?? 0
  const hasMatches = (matchesData.value?.total ?? 0) > 0
  const hasReviewedMatches = (matchesData.value?.confirmed_count ?? 0) + (matchesData.value?.rejected_count ?? 0) > 0

  return [
    {
      id: 'data',
      label: 'Connect your data',
      description: hasData
        ? `${accountCount} accounts loaded`
        : 'Import accounts from Stripe, CSV, or other sources',
      completed: hasData,
      action: () => router.push('/data-sources'),
      actionLabel: 'Add Data',
    },
    {
      id: 'matches',
      label: 'Review account matches',
      description: hasMatches
        ? hasReviewedMatches
          ? 'Matches reviewed'
          : `${matchesData.value?.pending_count ?? 0} pending matches`
        : 'Confirm or reject duplicate suggestions',
      completed: hasReviewedMatches || (!hasData),
      action: () => router.push('/matches'),
      actionLabel: 'Review',
    },
    {
      id: 'explore',
      label: 'Explore your metrics',
      description: 'View revenue, pricing intelligence, and more',
      completed: false,
      action: () => router.push('/'),
      actionLabel: 'View Dashboard',
    },
  ]
})

const completedCount = computed(() => steps.value.filter(s => s.completed).length)
const totalSteps = computed(() => steps.value.length)
const allComplete = computed(() => completedCount.value === totalSteps.value)

function getNextStep() {
  return steps.value.find(s => !s.completed)
}
</script>

<template>
  <Card class="border-primary/20 bg-primary/5">
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base">Getting Started</CardTitle>
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground">{{ completedCount }}/{{ totalSteps }}</span>
          <Button variant="ghost" size="icon" class="h-6 w-6" @click="emit('dismiss')">
            <X class="h-3 w-3" />
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      <div
        v-for="step in steps"
        :key="step.id"
        :class="[
          'flex items-start gap-3 rounded-md p-2 transition-colors',
          !step.completed && 'hover:bg-background/50 cursor-pointer'
        ]"
        @click="!step.completed && step.action?.()"
      >
        <div class="mt-0.5">
          <Check
            v-if="step.completed"
            class="h-4 w-4 text-success"
          />
          <Circle
            v-else
            class="h-4 w-4 text-muted-foreground"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div :class="['text-sm font-medium', step.completed && 'text-muted-foreground']">
            {{ step.label }}
          </div>
          <div class="text-xs text-muted-foreground">
            {{ step.description }}
          </div>
        </div>
        <ChevronRight
          v-if="!step.completed"
          class="h-4 w-4 text-muted-foreground/50 mt-0.5"
        />
      </div>

      <div v-if="!allComplete && getNextStep()" class="pt-2 border-t">
        <Button size="sm" class="w-full" @click="getNextStep()?.action?.()">
          {{ getNextStep()?.actionLabel }}
          <ChevronRight class="ml-1 h-3 w-3" />
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

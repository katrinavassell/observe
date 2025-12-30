<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { Link2, Check, X, ArrowLeftRight, Upload } from 'lucide-vue-next'
import { Card, CardContent, Button, Badge } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import Progress from '@/components/ui/progress.vue'
import { getMatches, confirmMatch, rejectMatch, type MatchCandidate } from '@/api/client'
import { formatPercent, cn } from '@/lib/utils'

const router = useRouter()
const status = ref<string>()
const selectedMatch = ref<MatchCandidate | null>(null)
const queryClient = useQueryClient()

const { data, isLoading } = useQuery({
  queryKey: ['matches', status],
  queryFn: () => getMatches({ status: status.value }),
})

const confirmMutation = useMutation({
  mutationFn: (id: number) => confirmMatch(id),
  onSuccess: (updated) => {
    queryClient.invalidateQueries({ queryKey: ['matches'] })
    selectedMatch.value = updated
    toast.success('Match confirmed')
  },
  onError: () => {
    toast.error('Failed to confirm match')
  },
})

const rejectMutation = useMutation({
  mutationFn: (id: number) => rejectMatch(id),
  onSuccess: (updated) => {
    queryClient.invalidateQueries({ queryKey: ['matches'] })
    selectedMatch.value = updated
    toast.success('Match rejected')
  },
  onError: () => {
    toast.error('Failed to reject match')
  },
})

const matches = computed(() => data.value?.matches ?? [])
const pendingCount = computed(() => data.value?.pending_count ?? 0)
const confirmedCount = computed(() => data.value?.confirmed_count ?? 0)
const rejectedCount = computed(() => data.value?.rejected_count ?? 0)
const totalCount = computed(() => pendingCount.value + confirmedCount.value + rejectedCount.value)

const statusOptions = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Rejected', value: 'rejected' },
]

function getScoreColor(score: number) {
  if (score >= 0.9) return 'text-success'
  if (score >= 0.7) return 'text-warning'
  return 'text-destructive'
}

function getScoreBarColor(score: number) {
  if (score >= 0.9) return 'bg-success'
  if (score >= 0.7) return 'bg-warning'
  return 'bg-destructive'
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Match Review</h1>
      <p class="text-muted-foreground">Human-in-the-loop account matching</p>
    </div>

    <!-- Stats -->
    <div v-if="totalCount > 0" class="flex gap-3">
      <div class="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
        <span class="font-mono text-lg font-semibold text-warning">{{ pendingCount }}</span>
        <span class="text-xs text-muted-foreground">Pending</span>
      </div>
      <div class="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
        <span class="font-mono text-lg font-semibold text-success">{{ confirmedCount }}</span>
        <span class="text-xs text-muted-foreground">Confirmed</span>
      </div>
      <div class="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
        <span class="font-mono text-lg font-semibold text-destructive">{{ rejectedCount }}</span>
        <span class="text-xs text-muted-foreground">Rejected</span>
      </div>
    </div>

    <!-- Filters -->
    <div v-if="totalCount > 0" class="flex gap-2">
      <select
        v-model="status"
        class="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option v-for="opt in statusOptions" :key="opt.label" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div class="space-y-2">
        <Skeleton v-for="i in 5" :key="i" class="h-24 w-full" />
      </div>
      <Skeleton class="h-96" />
    </div>

    <!-- Empty State -->
    <div v-else-if="totalCount === 0" class="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 px-4">
      <Link2 class="h-12 w-12 text-muted-foreground/40" />
      <h3 class="mt-4 text-lg font-medium">No matches to review</h3>
      <p class="mt-2 text-sm text-muted-foreground text-center max-w-md">
        When you have accounts from multiple sources (like Stripe + Salesforce),
        we'll find potential duplicates for you to review here.
      </p>
      <div class="flex gap-3 mt-6">
        <Button @click="router.push('/data-sources')">
          <Upload class="mr-2 h-4 w-4" />
          Add Another Data Source
        </Button>
      </div>
      <p class="mt-4 text-xs text-muted-foreground">
        Already have multiple sources? Matches are generated automatically.
      </p>
    </div>

    <!-- Main Content -->
    <div v-else class="grid gap-4 lg:grid-cols-[360px_1fr]">
      <!-- Matches List -->
      <div class="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-2">
        <div
          v-if="matches.length === 0"
          class="flex flex-col items-center justify-center rounded-md border bg-card p-8 text-center"
        >
          <Check class="h-6 w-6 text-success opacity-60" />
          <p class="mt-2 text-sm text-muted-foreground">No matches with this status</p>
        </div>

        <Card
          v-for="match in matches"
          :key="match.id"
          :class="cn(
            'cursor-pointer transition-colors hover:border-muted-foreground/50',
            selectedMatch?.id === match.id && 'border-foreground bg-accent'
          )"
          @click="selectedMatch = match"
        >
          <CardContent class="p-4">
            <div class="flex items-center justify-between mb-2">
              <Badge
                :variant="match.status === 'confirmed' ? 'success' : match.status === 'rejected' ? 'destructive' : 'warning'"
                class="text-[10px] uppercase"
              >
                {{ match.status }}
              </Badge>
              <span class="text-xs text-muted-foreground font-mono">#{{ match.id }}</span>
            </div>

            <div class="flex items-center gap-2 mb-3">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">{{ match.source_account_name }}</div>
                <div class="text-xs text-muted-foreground">{{ match.source_system }}</div>
              </div>
              <ArrowLeftRight class="h-3 w-3 text-muted-foreground/50 shrink-0" />
              <div class="flex-1 min-w-0 text-right">
                <div class="text-sm font-medium truncate">{{ match.target_account_name }}</div>
                <div class="text-xs text-muted-foreground">{{ match.target_system }}</div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <div class="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  :class="['h-full rounded-full', getScoreBarColor(match.overall_score)]"
                  :style="{ width: `${match.overall_score * 100}%` }"
                />
              </div>
              <span :class="['text-xs font-semibold font-mono', getScoreColor(match.overall_score)]">
                {{ formatPercent(match.overall_score) }}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Detail Panel -->
      <Card class="sticky top-4">
        <CardContent class="p-6">
          <div v-if="!selectedMatch" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Link2 class="h-8 w-8 opacity-40" />
            <p class="mt-4 text-sm">Select a match to view details</p>
          </div>

          <template v-else>
            <div class="flex items-center justify-between mb-6">
              <h3 class="font-medium">Match Comparison</h3>
              <Button variant="ghost" size="sm" @click="selectedMatch = null">
                <X class="h-4 w-4" />
              </Button>
            </div>

            <!-- Side by Side -->
            <div class="grid grid-cols-[1fr_auto_1fr] gap-4 mb-6">
              <div class="space-y-1 text-center">
                <span class="text-[10px] uppercase tracking-wider text-muted-foreground">{{ selectedMatch.source_system }}</span>
                <div class="rounded-md bg-muted p-4">
                  <div class="font-medium text-sm">{{ selectedMatch.source_account_name }}</div>
                  <span class="text-xs text-muted-foreground font-mono">ID: {{ selectedMatch.source_account_id }}</span>
                </div>
              </div>

              <div class="flex items-center justify-center">
                <div class="flex flex-col items-center justify-center w-14 h-14 rounded-full border-2" :style="{ borderColor: `hsl(var(--${selectedMatch.overall_score >= 0.7 ? 'success' : 'warning'}))` }">
                  <span class="text-[10px] uppercase text-muted-foreground">Score</span>
                  <span :class="['text-sm font-semibold font-mono', getScoreColor(selectedMatch.overall_score)]">
                    {{ formatPercent(selectedMatch.overall_score) }}
                  </span>
                </div>
              </div>

              <div class="space-y-1 text-center">
                <span class="text-[10px] uppercase tracking-wider text-muted-foreground">{{ selectedMatch.target_system }}</span>
                <div class="rounded-md bg-muted p-4">
                  <div class="font-medium text-sm">{{ selectedMatch.target_account_name }}</div>
                  <span class="text-xs text-muted-foreground font-mono">ID: {{ selectedMatch.target_account_id }}</span>
                </div>
              </div>
            </div>

            <!-- Match Explanation -->
            <div v-if="selectedMatch.explanation" class="mb-6 rounded-md bg-muted/50 p-3">
              <p class="text-sm text-foreground">{{ selectedMatch.explanation }}</p>
            </div>

            <!-- Field Scores -->
            <div class="mb-6">
              <h4 class="text-xs font-medium text-muted-foreground mb-3">Field-Level Scores</h4>
              <div class="space-y-3">
                <div v-for="field in selectedMatch.field_scores" :key="field.field" class="space-y-1">
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-medium capitalize">{{ field.field.replace(/_/g, ' ') }}</span>
                    <span :class="['font-mono', getScoreColor(field.score)]">{{ formatPercent(field.score) }}</span>
                  </div>
                  <div class="flex items-center gap-2 text-xs">
                    <span class="flex-1 truncate rounded bg-muted px-2 py-1 text-muted-foreground">{{ field.value_a || '—' }}</span>
                    <span class="text-[10px] uppercase text-muted-foreground">vs</span>
                    <span class="flex-1 truncate rounded bg-muted px-2 py-1 text-muted-foreground text-right">{{ field.value_b || '—' }}</span>
                  </div>
                  <Progress :value="field.score * 100" class="h-1" :indicator-class="getScoreBarColor(field.score)" />
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div v-if="selectedMatch.status === 'pending'" class="flex gap-2 border-t pt-4">
              <Button
                class="flex-1"
                :loading="confirmMutation.isPending.value"
                @click="confirmMutation.mutate(selectedMatch.id)"
              >
                <Check class="mr-2 h-4 w-4" />
                Confirm Match
              </Button>
              <Button
                variant="outline"
                :loading="rejectMutation.isPending.value"
                @click="rejectMutation.mutate(selectedMatch.id)"
              >
                <X class="mr-2 h-4 w-4" />
                Reject
              </Button>
            </div>

            <div v-else class="border-t pt-4">
              <div
                :class="[
                  'flex items-center gap-2 rounded-md p-3 text-sm font-medium',
                  selectedMatch.status === 'confirmed' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                ]"
              >
                <component :is="selectedMatch.status === 'confirmed' ? Check : X" class="h-4 w-4" />
                <span class="capitalize">{{ selectedMatch.status }}{{ selectedMatch.matched_by ? ` by ${selectedMatch.matched_by}` : '' }}</span>
              </div>
            </div>
          </template>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

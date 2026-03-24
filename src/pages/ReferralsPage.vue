<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { Gift, Copy, Check, Users, Ticket, ArrowRight, Clock } from 'lucide-vue-next'
import { getReferralStats } from '@/lib/api'
import { toast } from 'vue-sonner'

const copied = ref(false)

const { data: stats, isLoading } = useQuery({
  queryKey: ['referral-stats'],
  queryFn: getReferralStats,
})

const referralLink = computed(() => {
  if (!stats.value?.code) return ''
  const base = window.location.origin
  return `${base}/?ref=${stats.value.code}`
})

const availablePromos = computed(() =>
  (stats.value?.promos ?? []).filter(p => p.code && !p.used)
)

const usedPromos = computed(() =>
  (stats.value?.promos ?? []).filter(p => p.used)
)

async function copyLink() {
  if (!referralLink.value) return
  try {
    await navigator.clipboard.writeText(referralLink.value)
    copied.value = true
    toast.success('Referral link copied!')
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    toast.error('Failed to copy. Please copy the link manually.')
  }
}

async function copyCode() {
  if (!stats.value?.code) return
  try {
    await navigator.clipboard.writeText(stats.value.code)
    toast.success('Referral code copied!')
  } catch {
    toast.error('Failed to copy.')
  }
}

async function copyPromo(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.success('Promo code copied!')
  } catch {
    toast.error('Failed to copy.')
  }
}

function shareEmail() {
  if (!referralLink.value) return
  const subject = encodeURIComponent('Check out Tanso — AI cost analytics for your product')
  const body = encodeURIComponent(
    `Hey,\n\nI've been using Tanso to track AI feature costs and margins. Thought you might find it useful.\n\nSign up here: ${referralLink.value}\n\nCheers`
  )
  window.open(`mailto:?subject=${subject}&body=${body}`)
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Referrals</h1>
      <p class="text-sm text-muted-foreground mt-1">Invite colleagues and earn a free month of Pro</p>
    </div>

    <!-- How it works -->
    <div class="rounded-xl border bg-card p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wide">How it works</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="flex items-start gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">1</div>
          <div>
            <p class="text-sm font-medium">Share your link</p>
            <p class="text-xs text-muted-foreground mt-0.5">Send your unique referral link to a colleague or team member</p>
          </div>
        </div>
        <div class="flex items-center justify-center text-muted-foreground hidden sm:flex">
          <ArrowRight class="h-4 w-4" />
        </div>
        <div class="flex items-start gap-3 sm:col-start-2 sm:col-end-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">2</div>
          <div>
            <p class="text-sm font-medium">They load data</p>
            <p class="text-xs text-muted-foreground mt-0.5">Once they connect a data source or load sample data, the referral counts</p>
          </div>
        </div>
        <div class="flex items-center justify-center text-muted-foreground hidden sm:flex">
          <ArrowRight class="h-4 w-4" />
        </div>
        <div class="flex items-start gap-3 sm:col-start-3 sm:col-end-4">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">3</div>
          <div>
            <p class="text-sm font-medium">You get a free month</p>
            <p class="text-xs text-muted-foreground mt-0.5">You receive a promo code for 1 free month of Pro for each successful referral</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Referral link section -->
    <div class="rounded-xl border bg-card p-6 space-y-4">
      <div class="flex items-center gap-2">
        <Gift class="h-4 w-4 text-primary" />
        <h2 class="font-medium">Your referral link</h2>
      </div>

      <div v-if="isLoading" class="animate-pulse h-10 rounded-lg bg-muted"></div>
      <div v-else-if="stats" class="space-y-3">
        <!-- Link display -->
        <div class="flex items-center gap-2">
          <div class="flex-1 rounded-lg border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground truncate select-all">
            {{ referralLink }}
          </div>
          <button
            class="flex items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors shrink-0"
            @click="copyLink"
          >
            <Check v-if="copied" class="h-3.5 w-3.5 text-green-500" />
            <Copy v-else class="h-3.5 w-3.5" />
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
        </div>

        <!-- Code + share options -->
        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">Your code:</span>
            <button
              class="font-mono text-sm font-semibold tracking-widest bg-primary/10 text-primary rounded px-2 py-0.5 hover:bg-primary/20 transition-colors"
              @click="copyCode"
              title="Click to copy code"
            >
              {{ stats.code }}
            </button>
          </div>
          <button
            class="text-xs text-muted-foreground hover:text-foreground underline"
            @click="shareEmail"
          >
            Share via email
          </button>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <!-- Total invited -->
      <div class="rounded-xl border bg-card p-5 space-y-2">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Users class="h-4 w-4" />
          <span class="text-xs font-medium uppercase tracking-wide">Total invited</span>
        </div>
        <div v-if="isLoading" class="animate-pulse h-8 w-16 rounded bg-muted"></div>
        <div v-else class="text-3xl font-bold tracking-tight">{{ stats?.total_referrals ?? 0 }}</div>
        <p class="text-xs text-muted-foreground">people who signed up via your link</p>
      </div>

      <!-- Converted -->
      <div class="rounded-xl border bg-card p-5 space-y-2">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Clock class="h-4 w-4" />
          <span class="text-xs font-medium uppercase tracking-wide">Converted</span>
        </div>
        <div v-if="isLoading" class="animate-pulse h-8 w-16 rounded bg-muted"></div>
        <div v-else class="text-3xl font-bold tracking-tight">{{ stats?.converted_referrals ?? 0 }}</div>
        <p class="text-xs text-muted-foreground">
          referrals who loaded data
          <span v-if="stats && stats.pending_referrals > 0" class="text-amber-500 ml-1">
            ({{ stats.pending_referrals }} pending)
          </span>
        </p>
      </div>

      <!-- Promo codes -->
      <div class="rounded-xl border bg-card p-5 space-y-2">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Ticket class="h-4 w-4" />
          <span class="text-xs font-medium uppercase tracking-wide">Promo codes</span>
        </div>
        <div v-if="isLoading" class="animate-pulse h-8 w-16 rounded bg-muted"></div>
        <div v-else class="flex items-end gap-2">
          <span class="text-3xl font-bold tracking-tight">{{ availablePromos.length }}</span>
          <span class="text-sm text-muted-foreground mb-0.5">available</span>
        </div>
        <p class="text-xs text-muted-foreground">free months of Pro earned</p>
      </div>
    </div>

    <!-- Promo codes list -->
    <div v-if="availablePromos.length > 0" class="rounded-xl border bg-card p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your promo codes</h2>
      <p class="text-xs text-muted-foreground">Apply these at checkout to get 1 free month of Pro. Each code can only be used once.</p>
      <div class="space-y-2">
        <div
          v-for="promo in availablePromos"
          :key="promo.code"
          class="flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-3"
        >
          <span class="font-mono text-sm font-semibold tracking-wider">{{ promo.code }}</span>
          <button
            class="flex items-center gap-1.5 rounded border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors"
            @click="copyPromo(promo.code!)"
          >
            <Copy class="h-3 w-3" />
            Copy
          </button>
        </div>
      </div>
    </div>

    <!-- Used promos -->
    <div v-if="usedPromos.length > 0" class="rounded-xl border bg-card p-6 space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Used promo codes</h2>
      <div class="space-y-1">
        <div
          v-for="promo in usedPromos"
          :key="promo.code"
          class="flex items-center justify-between text-sm text-muted-foreground"
        >
          <span class="font-mono line-through">{{ promo.code }}</span>
          <span class="text-xs">redeemed</span>
        </div>
      </div>
    </div>

    <!-- Empty state for first time -->
    <div v-if="!isLoading && stats && stats.total_referrals === 0" class="rounded-xl border border-dashed bg-card p-8 text-center space-y-2">
      <Gift class="h-8 w-8 text-muted-foreground mx-auto" />
      <p class="text-sm font-medium">No referrals yet</p>
      <p class="text-xs text-muted-foreground max-w-xs mx-auto">
        Share your referral link above with colleagues to earn free months of Pro.
      </p>
    </div>
  </div>
</template>

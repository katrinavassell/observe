import { ref, computed, watch } from 'vue'

export type AppMode = 'saas' | 'agent'

// Shared reactive state (singleton pattern)
const mode = ref<AppMode>((localStorage.getItem('appMode') as AppMode) || 'saas')

// Sync to localStorage when mode changes
watch(mode, (newMode) => {
  localStorage.setItem('appMode', newMode)
})

export function useAppMode() {
  const isSaasMode = computed(() => mode.value === 'saas')
  const isAgentMode = computed(() => mode.value === 'agent')

  function setMode(newMode: AppMode) {
    mode.value = newMode
  }

  // Mode-specific labels
  const labels = computed(() => {
    if (mode.value === 'agent') {
      return {
        accounts: 'Agents',
        account: 'Agent',
        subscriptions: 'Transactions',
        subscription: 'Transaction',
        invoices: 'Settlements',
        invoice: 'Settlement',
        arr: 'Volume',
        mrr: 'Monthly Volume',
        customers: 'Agents',
        customer: 'Agent',
        primaryMetric: 'Transaction Volume',
        secondaryMetric: 'API Costs',
      }
    }
    return {
      accounts: 'Accounts',
      account: 'Account',
      subscriptions: 'Subscriptions',
      subscription: 'Subscription',
      invoices: 'Invoices',
      invoice: 'Invoice',
      arr: 'ARR',
      mrr: 'MRR',
      customers: 'Customers',
      customer: 'Customer',
      primaryMetric: 'ARR',
      secondaryMetric: 'MRR',
    }
  })

  return {
    mode,
    isSaasMode,
    isAgentMode,
    setMode,
    labels,
  }
}

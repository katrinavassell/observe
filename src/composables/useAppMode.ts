import { computed } from 'vue'

export function useAppMode() {
  // SaaS labels
  const labels = computed(() => ({
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
  }))

  return {
    labels,
  }
}

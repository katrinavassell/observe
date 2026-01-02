// Dashboard components barrel export
export { default as MetricCard } from './MetricCard.vue'
export { default as AlertCard } from './AlertCard.vue'
export { default as MrrMonthlyBreakdown } from './MrrMonthlyBreakdown.vue'
export { default as QuickActions } from './QuickActions.vue'

// Re-export types
export type { Alert, AlertAction } from './AlertCard.vue'
export type { MrrMonthData } from './MrrMonthlyBreakdown.vue'
export type { QuickAction } from './QuickActions.vue'

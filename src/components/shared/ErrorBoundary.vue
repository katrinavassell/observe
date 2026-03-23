<script lang="ts">
import { defineComponent, ref, h, type VNode } from 'vue'

export default defineComponent({
  name: 'ErrorBoundary',
  props: {
    fallbackMessage: {
      type: String,
      default: 'Something went wrong loading this section.',
    },
  },
  setup(props, { slots }) {
    const error = ref<Error | null>(null)

    return () => {
      if (error.value) {
        return h('div', { class: 'rounded-lg border border-red-200 bg-red-50 p-6 text-center' }, [
          h('p', { class: 'text-sm font-medium text-red-800' }, props.fallbackMessage),
          h('button', {
            class: 'mt-3 text-xs text-red-600 underline hover:text-red-800',
            onClick: () => { error.value = null },
          }, 'Try again'),
        ])
      }
      return slots.default?.() as VNode
    }
  },
  onErrorCaptured(err: Error) {
    (this as any).error = err
    console.error('ErrorBoundary caught:', err)
    return false
  },
})
</script>

import { createApp } from 'vue'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'
import router from './router'
import App from './App.vue'
import './assets/index.css'
import 'vue-sonner/style.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

const app = createApp(App)

app.use(router)
app.use(VueQueryPlugin, { queryClient })

app.mount('#app')

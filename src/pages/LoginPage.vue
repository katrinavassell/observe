<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LayoutDashboard, Mail, Lock, Loader2 } from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import { toast } from 'vue-sonner'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const { signIn, signUp } = useAuth()

const email = ref('')
const password = ref('')
const isLoading = ref(false)
const isRegisterMode = ref(false)

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(email: string): boolean {
  return emailRegex.test(email.trim())
}

async function handleSubmit() {
  const trimmedEmail = email.value.trim()

  if (!trimmedEmail) {
    toast.error('Please enter your email')
    return
  }

  if (!isValidEmail(trimmedEmail)) {
    toast.error('Please enter a valid email address')
    return
  }

  if (!password.value || password.value.length < 6) {
    toast.error('Password must be at least 6 characters')
    return
  }

  isLoading.value = true

  try {
    if (isRegisterMode.value) {
      await signUp(trimmedEmail, password.value)
      toast.success('Account created!', {
        description: 'You are now signed in.',
      })
    } else {
      await signIn(trimmedEmail, password.value)
      toast.success('Welcome back!')
    }
    router.push('/')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed'
    toast.error('Error', { description: message })
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background p-4">
    <Card class="w-full max-w-md">
      <CardContent class="p-8">
        <div class="flex items-center justify-center gap-3 mb-8">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard class="h-5 w-5" />
          </div>
          <span class="text-2xl font-semibold tracking-tight">Tanso</span>
        </div>

        <div class="text-center mb-6">
          <h1 class="text-xl font-semibold">
            {{ isRegisterMode ? 'Create an account' : 'Welcome back' }}
          </h1>
          <p class="text-sm text-muted-foreground mt-1">
            {{ isRegisterMode ? 'Sign up to analyze your pricing data' : 'Sign in to analyze your pricing data' }}
          </p>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div class="space-y-2">
            <label class="text-sm font-medium" for="email">Email</label>
            <div class="relative">
              <Mail class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                id="email"
                v-model="email"
                type="email"
                placeholder="you@company.com"
                class="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium" for="password">Password</label>
            <div class="relative">
              <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                id="password"
                v-model="password"
                type="password"
                placeholder="Enter your password"
                class="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
          </div>

          <Button type="submit" class="w-full" :disabled="isLoading">
            <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
            {{ isRegisterMode ? 'Create account' : 'Sign in' }}
          </Button>
        </form>

        <div class="text-center mt-6">
          <button
            type="button"
            class="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            @click="isRegisterMode = !isRegisterMode"
          >
            {{ isRegisterMode ? 'Already have an account? Sign in' : "Don't have an account? Sign up" }}
          </button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

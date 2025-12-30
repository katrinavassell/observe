<script setup lang="ts">
import { ref } from 'vue'
import { LayoutDashboard, Mail, Loader2, CheckCircle } from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'

const email = ref('')
const isLoading = ref(false)
const emailSent = ref(false)

async function handleMagicLink() {
  if (!email.value) {
    toast.error('Please enter your email')
    return
  }

  isLoading.value = true

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.value,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    })

    if (error) throw error

    emailSent.value = true
    toast.success('Check your email!', {
      description: 'We sent you a magic link to sign in.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send magic link'
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
        <!-- Logo -->
        <div class="flex items-center justify-center gap-3 mb-8">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard class="h-5 w-5" />
          </div>
          <span class="text-2xl font-semibold tracking-tight">Tanso</span>
        </div>

        <!-- Success State -->
        <template v-if="emailSent">
          <div class="text-center space-y-4">
            <div class="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle class="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h1 class="text-xl font-semibold">Check your email</h1>
            <p class="text-sm text-muted-foreground">
              We sent a magic link to <strong>{{ email }}</strong>
            </p>
            <p class="text-xs text-muted-foreground">
              Click the link in the email to sign in. You can close this tab.
            </p>
            <Button variant="outline" class="mt-4" @click="emailSent = false">
              Use a different email
            </Button>
          </div>
        </template>

        <!-- Login Form -->
        <template v-else>
          <div class="text-center mb-6">
            <h1 class="text-xl font-semibold">Welcome to Tanso</h1>
            <p class="text-sm text-muted-foreground mt-1">
              Sign in to analyze your pricing data
            </p>
          </div>

          <!-- Magic Link Form -->
          <form @submit.prevent="handleMagicLink" class="space-y-4">
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

            <Button type="submit" class="w-full" :disabled="isLoading">
              <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
              <Mail v-else class="h-4 w-4 mr-2" />
              Send magic link
            </Button>
          </form>

          <p class="text-center text-xs text-muted-foreground mt-6">
            No password needed. We'll email you a secure login link.
          </p>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import {
  Users,
  UserPlus,
  Trash2,
  Crown,
  Eye,
  Copy,
  Check,
  Pencil,
} from 'lucide-vue-next'
import { useTeam } from '@/composables/useTeam'
import type { OrgMember } from '@/lib/api'

const {
  isLoading,
  error,
  myRole,
  isAdmin,
  org,
  members,
  fetchTeamInfo,
  renameTeam,
  inviteMember,
  changeRole,
  removeMember,
} = useTeam()

const inviteEmail = ref('')
const inviteRole = ref<'admin' | 'viewer'>('viewer')
const isInviting = ref(false)
const inviteLink = ref('')
const copiedLink = ref(false)

const editingName = ref(false)
const nameInput = ref('')
const isSavingName = ref(false)

onMounted(() => {
  fetchTeamInfo()
})

function startEditName() {
  nameInput.value = org.value?.name ?? ''
  editingName.value = true
}

async function saveName() {
  if (!nameInput.value.trim()) return
  isSavingName.value = true
  try {
    await renameTeam(nameInput.value.trim())
    editingName.value = false
    toast.success('Team name updated')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to update name')
  } finally {
    isSavingName.value = false
  }
}

async function handleInvite() {
  isInviting.value = true
  inviteLink.value = ''
  try {
    const result = await inviteMember(inviteEmail.value.trim(), inviteRole.value)
    inviteLink.value = result.invite_link
    inviteEmail.value = ''
    toast.success('Invite link generated')
    await fetchTeamInfo()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to create invite')
  } finally {
    isInviting.value = false
  }
}

async function copyInviteLink() {
  await navigator.clipboard.writeText(inviteLink.value)
  copiedLink.value = true
  setTimeout(() => { copiedLink.value = false }, 2000)
}

async function handleRoleChange(member: OrgMember, role: 'admin' | 'viewer') {
  try {
    await changeRole(member.id, role)
    toast.success('Role updated')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to change role')
  }
}

async function handleRemove(member: OrgMember) {
  if (!confirm(`Remove ${member.invited_email || 'this member'} from the team?`)) return
  try {
    await removeMember(member.id)
    toast.success('Member removed')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to remove member')
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString()
}

function memberLabel(member: OrgMember) {
  return member.invited_email || `Anonymous (${member.visitor_id?.slice(0, 8) ?? '?'}...)`
}
</script>

<template>
  <div class="space-y-8 max-w-2xl">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold">Team Settings</h1>
      <p class="text-muted-foreground mt-1">Manage your workspace and team members.</p>
    </div>

    <!-- Loading / Error -->
    <div v-if="isLoading" class="flex items-center gap-2 text-muted-foreground">
      <div class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
      Loading team info...
    </div>
    <div v-else-if="error" class="text-destructive text-sm">{{ error }}</div>

    <template v-else-if="org">
      <!-- Team Name -->
      <div class="border rounded-lg p-5 space-y-3">
        <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Workspace</h2>
        <div class="flex items-center gap-3">
          <template v-if="editingName">
            <input
              v-model="nameInput"
              class="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              @keydown.enter="saveName"
              @keydown.escape="editingName = false"
            />
            <button
              class="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              :disabled="isSavingName"
              @click="saveName"
            >
              Save
            </button>
            <button
              class="text-sm px-3 py-1.5 rounded border hover:bg-accent"
              @click="editingName = false"
            >
              Cancel
            </button>
          </template>
          <template v-else>
            <span class="text-lg font-semibold flex-1">{{ org.name }}</span>
            <button
              v-if="isAdmin"
              class="text-muted-foreground hover:text-foreground"
              title="Rename team"
              @click="startEditName"
            >
              <Pencil class="h-4 w-4" />
            </button>
          </template>
        </div>
        <p class="text-xs text-muted-foreground">
          Your role: <span class="font-medium capitalize">{{ myRole }}</span>
        </p>
      </div>

      <!-- Invite Member (Admin only) -->
      <div v-if="isAdmin" class="border rounded-lg p-5 space-y-4">
        <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <UserPlus class="h-4 w-4" />
          Invite Teammate
        </h2>
        <div class="flex gap-2 flex-wrap">
          <input
            v-model="inviteEmail"
            type="email"
            placeholder="teammate@example.com (optional)"
            class="flex-1 min-w-[200px] border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            @keydown.enter="handleInvite"
          />
          <select
            v-model="inviteRole"
            class="border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            class="px-4 py-1.5 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            :disabled="isInviting"
            @click="handleInvite"
          >
            <div v-if="isInviting" class="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
            Generate Link
          </button>
        </div>

        <!-- Generated invite link -->
        <div v-if="inviteLink" class="mt-2 p-3 bg-muted rounded-lg">
          <p class="text-xs text-muted-foreground mb-1.5">Share this link with your teammate:</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 text-xs break-all">{{ inviteLink }}</code>
            <button
              class="shrink-0 text-muted-foreground hover:text-foreground"
              @click="copyInviteLink"
            >
              <component :is="copiedLink ? Check : Copy" class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Viewer role notice (for viewers only) -->
      <div v-if="!isAdmin" class="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
        You have <strong>Viewer</strong> access to this workspace. You can see all data but cannot modify it, upload data, or invite teammates. Contact your admin to change your role.
      </div>

      <!-- Members List -->
      <div class="border rounded-lg overflow-hidden">
        <div class="p-4 border-b flex items-center gap-2">
          <Users class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold">Team Members</h2>
          <span class="ml-auto text-xs text-muted-foreground">{{ members.length }} member{{ members.length !== 1 ? 's' : '' }}</span>
        </div>

        <div v-if="members.length === 0" class="p-6 text-center text-sm text-muted-foreground">
          No members yet. Invite your first teammate above.
        </div>

        <ul v-else class="divide-y">
          <li
            v-for="member in members"
            :key="member.id"
            class="flex items-center gap-3 p-4"
          >
            <!-- Avatar placeholder -->
            <div class="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              <component :is="member.role === 'admin' ? Crown : Eye" class="h-4 w-4 text-muted-foreground" />
            </div>

            <!-- Info -->
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">{{ memberLabel(member) }}</div>
              <div class="text-xs text-muted-foreground">
                <span
                  :class="member.status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
                >{{ member.status === 'active' ? 'Active' : 'Pending' }}</span>
                <span v-if="member.joined_at"> · Joined {{ formatDate(member.joined_at) }}</span>
                <span v-else> · Invited {{ formatDate(member.created_at) }}</span>
              </div>
            </div>

            <!-- Role badge / selector -->
            <template v-if="isAdmin">
              <select
                :value="member.role"
                class="border rounded px-2 py-1 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                @change="handleRoleChange(member, ($event.target as HTMLSelectElement).value as 'admin' | 'viewer')"
              >
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                class="text-muted-foreground hover:text-destructive transition-colors"
                title="Remove member"
                @click="handleRemove(member)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </template>
            <template v-else>
              <span class="text-xs px-2 py-0.5 rounded-full border capitalize">{{ member.role }}</span>
            </template>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

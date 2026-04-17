<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { toast } from "vue-sonner";
import {
  Users,
  UserPlus,
  Trash2,
  User as UserIcon,
  Copy,
  Check,
  Pencil,
  Link as LinkIcon,
  Loader2,
} from "lucide-vue-next";
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";
import { useTeam } from "@/composables/useTeam";
import type { OrgMember } from "@/lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Input,
  Badge,
} from "@/components/ui";

const {
  isLoading,
  error,
  org,
  members,
  inviteToken,
  fetchTeamInfo,
  renameTeam,
  rotateInvite,
  removeMember,
} = useTeam();

const router = useRouter();
const { isLoggedIn } = useAuth();

const isRotating = ref(false);
const copiedLink = ref(false);

const inviteLink = computed(() =>
  inviteToken.value
    ? `${window.location.origin}/join/${inviteToken.value}`
    : "",
);

const editingName = ref(false);
const nameInput = ref("");
const isSavingName = ref(false);

onMounted(() => {
  if (isLoggedIn.value) fetchTeamInfo();
});

function startEditName() {
  nameInput.value = org.value?.name ?? "";
  editingName.value = true;
}

async function saveName() {
  if (!nameInput.value.trim()) return;
  isSavingName.value = true;
  try {
    await renameTeam(nameInput.value.trim());
    editingName.value = false;
    toast.success("Team name updated");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Failed to update name");
  } finally {
    isSavingName.value = false;
  }
}

async function copyInviteLink() {
  if (!inviteLink.value) return;
  await window.navigator.clipboard.writeText(inviteLink.value);
  copiedLink.value = true;
  toast.success("Link copied to clipboard");
  window.posthog?.capture("team_invite_link_copied");
  setTimeout(() => {
    copiedLink.value = false;
  }, 2000);
}

async function handleRotate() {
  if (
    !window.confirm(
      "Rotate invite link? The old link will stop working immediately.",
    )
  )
    return;
  isRotating.value = true;
  try {
    await rotateInvite();
    toast.success("New invite link generated");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Failed to rotate link");
  } finally {
    isRotating.value = false;
  }
}

async function handleRemove(member: OrgMember) {
  if (
    !window.confirm(
      `Remove ${member.invited_email || "this member"} from the team?`,
    )
  )
    return;
  try {
    await removeMember(member.id);
    toast.success("Member removed");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Failed to remove member");
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString();
}

function memberLabel(member: OrgMember) {
  return (
    member.invited_email ||
    `Anonymous (${member.visitor_id?.slice(0, 8) ?? "?"}...)`
  );
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Team Settings</h1>
      <p class="text-muted-foreground mt-1">
        Manage your workspace and team members.
      </p>
    </div>

    <!-- Guest CTA -->
    <Card v-if="!isLoggedIn" class="border-primary/40 bg-primary/5">
      <CardContent class="p-6 text-center space-y-3">
        <h2 class="font-semibold text-lg">Sign in to manage your team</h2>
        <p class="text-sm text-muted-foreground max-w-md mx-auto">
          Invite teammates, assign roles, and share customer data + alerts
          across your account. Free to start.
        </p>
        <div class="flex justify-center gap-2 pt-1">
          <Button @click="router.push('/signup')">Sign up free</Button>
          <Button variant="outline" @click="router.push('/login')">
            Log in
          </Button>
        </div>
      </CardContent>
    </Card>

    <div
      v-else-if="isLoading"
      class="flex items-center gap-2 text-muted-foreground py-8"
    >
      <Loader2 class="h-4 w-4 animate-spin" />
      Loading team info…
    </div>
    <div v-else-if="error" class="text-destructive text-sm">{{ error }}</div>

    <template v-else-if="org">
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base">Workspace</CardTitle>
          <CardDescription>Your team name</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex items-center gap-3">
            <template v-if="editingName">
              <Input
                v-model="nameInput"
                class="flex-1"
                @keydown.enter="saveName"
                @keydown.escape="editingName = false"
              />
              <Button size="sm" :disabled="isSavingName" @click="saveName">
                <Loader2
                  v-if="isSavingName"
                  class="h-3 w-3 animate-spin mr-1.5"
                />
                Save
              </Button>
              <Button variant="outline" size="sm" @click="editingName = false">
                Cancel
              </Button>
            </template>
            <template v-else>
              <span class="text-lg font-semibold flex-1">{{ org.name }}</span>
              <Button
                variant="ghost"
                size="icon"
                title="Rename team"
                @click="startEditName"
              >
                <Pencil class="h-4 w-4" />
              </Button>
            </template>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base flex items-center gap-2">
            <UserPlus class="h-4 w-4" />
            Invite link
          </CardTitle>
          <CardDescription>
            Share this link with anyone you want on your team. They sign up (or
            log in) and join automatically.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <div
            class="flex items-center gap-2 rounded-md border bg-muted/50 p-3"
          >
            <LinkIcon class="h-4 w-4 text-muted-foreground shrink-0" />
            <code
              class="flex-1 text-xs break-all text-muted-foreground select-all"
            >
              {{ inviteLink || "Loading…" }}
            </code>
            <Button
              variant="ghost"
              size="icon"
              class="shrink-0 h-8 w-8"
              :disabled="!inviteLink"
              @click="copyInviteLink"
            >
              <Check v-if="copiedLink" class="h-4 w-4 text-success" />
              <Copy v-else class="h-4 w-4" />
            </Button>
          </div>
          <div class="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              :disabled="isRotating"
              @click="handleRotate"
            >
              <Loader2 v-if="isRotating" class="h-3 w-3 animate-spin mr-1.5" />
              Rotate link
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-base flex items-center gap-2">
              <Users class="h-4 w-4" />
              Team Members
            </CardTitle>
            <span class="text-sm text-muted-foreground"
              >{{ members.length }} member{{
                members.length !== 1 ? "s" : ""
              }}</span
            >
          </div>
        </CardHeader>
        <CardContent class="p-0">
          <div
            v-if="members.length === 0"
            class="p-6 text-center text-sm text-muted-foreground"
          >
            No members yet. Invite your first teammate above.
          </div>

          <ul v-else class="divide-y">
            <li
              v-for="member in members"
              :key="member.id"
              class="flex items-center gap-3 px-6 py-4"
            >
              <div
                class="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0"
              >
                <UserIcon class="h-4 w-4 text-muted-foreground" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">
                  {{ memberLabel(member) }}
                </div>
                <div
                  class="text-xs text-muted-foreground flex items-center gap-1.5"
                >
                  <Badge
                    :variant="
                      member.status === 'active' ? 'success' : 'warning'
                    "
                    class="text-[10px] px-1.5 py-0"
                  >
                    {{ member.status === "active" ? "Active" : "Pending" }}
                  </Badge>
                  <span v-if="member.joined_at"
                    >Joined {{ formatDate(member.joined_at) }}</span
                  >
                  <span v-else
                    >Invited {{ formatDate(member.created_at) }}</span
                  >
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                class="text-muted-foreground hover:text-destructive h-8 w-8"
                title="Remove member"
                @click="handleRemove(member)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>
    </template>
  </div>
</template>

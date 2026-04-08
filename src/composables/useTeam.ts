import { ref, computed } from "vue";
import * as api from "@/lib/api";

const teamInfo = ref<api.TeamInfo | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

export function useTeam() {
  const myRole = computed(() => teamInfo.value?.my_role ?? null);
  const isAdmin = computed(() => myRole.value === "admin");
  const isViewer = computed(() => myRole.value === "viewer");
  const org = computed(() => teamInfo.value?.org ?? null);
  const members = computed(() => teamInfo.value?.members ?? []);

  async function fetchTeamInfo() {
    isLoading.value = true;
    error.value = null;
    try {
      teamInfo.value = await api.getTeamInfo();
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load team";
    } finally {
      isLoading.value = false;
    }
  }

  async function renameTeam(name: string) {
    await api.renameTeam(name);
    if (teamInfo.value) {
      teamInfo.value.org.name = name;
    }
  }

  async function inviteMember(email: string, role: "admin" | "viewer") {
    return api.createInvite(email, role);
  }

  async function changeRole(memberId: string, role: "admin" | "viewer") {
    await api.changeMemberRole(memberId, role);
    if (teamInfo.value) {
      const member = teamInfo.value.members.find((m) => m.id === memberId);
      if (member) member.role = role;
    }
  }

  async function removeMember(memberId: string) {
    await api.removeMember(memberId);
    if (teamInfo.value) {
      teamInfo.value.members = teamInfo.value.members.filter(
        (m) => m.id !== memberId,
      );
    }
  }

  return {
    teamInfo,
    isLoading,
    error,
    myRole,
    isAdmin,
    isViewer,
    org,
    members,
    fetchTeamInfo,
    renameTeam,
    inviteMember,
    changeRole,
    removeMember,
  };
}

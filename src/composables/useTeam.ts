import { ref, computed } from "vue";
import * as api from "@/lib/api";

const teamInfo = ref<api.TeamInfo | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

export function useTeam() {
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

  async function inviteMember(email: string) {
    return api.createInvite(email);
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
    org,
    members,
    fetchTeamInfo,
    renameTeam,
    inviteMember,
    removeMember,
  };
}

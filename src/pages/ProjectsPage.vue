<script setup lang="ts">
import { ref } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { FolderOpen, Plus, Upload as UploadIcon, FileText, Clock, CheckCircle, AlertCircle } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import { getProjects, createProject, getProjectUploads, uploadFile, type Project } from '@/api/client'
import { cn } from '@/lib/utils'

const queryClient = useQueryClient()
const selectedProject = ref<Project | null>(null)
const showNewProjectForm = ref(false)
const newProjectName = ref('')
const newProjectDescription = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)

const { data: projects, isLoading } = useQuery({
  queryKey: ['projects'],
  queryFn: getProjects,
})

const { data: uploads, isLoading: uploadsLoading } = useQuery({
  queryKey: ['project-uploads', selectedProject.value?.id],
  queryFn: () => selectedProject.value ? getProjectUploads(selectedProject.value.id) : Promise.resolve([]),
  enabled: () => !!selectedProject.value,
})

const createMutation = useMutation({
  mutationFn: () => createProject({
    name: newProjectName.value,
    description: newProjectDescription.value || undefined,
  }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] })
    showNewProjectForm.value = false
    newProjectName.value = ''
    newProjectDescription.value = ''
  },
})

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !selectedProject.value) return

  isUploading.value = true
  try {
    await uploadFile(selectedProject.value.id, file)
    queryClient.invalidateQueries({ queryKey: ['project-uploads'] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  } finally {
    isUploading.value = false
    input.value = ''
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed': return CheckCircle
    case 'processing': return Clock
    case 'completed_with_errors': return AlertCircle
    default: return Clock
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'completed': return 'text-success'
    case 'processing': return 'text-warning'
    case 'completed_with_errors': return 'text-destructive'
    default: return 'text-muted-foreground'
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Projects</h1>
        <p class="text-muted-foreground">Manage your data projects and uploads</p>
      </div>
      <Button @click="showNewProjectForm = true">
        <Plus class="mr-2 h-4 w-4" />
        New Project
      </Button>
    </div>

    <!-- New Project Form -->
    <Card v-if="showNewProjectForm">
      <CardHeader>
        <CardTitle class="text-base">Create New Project</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <label class="text-sm font-medium">Project Name</label>
          <Input v-model="newProjectName" placeholder="e.g., Q4 Revenue Analysis" />
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium">Description (optional)</label>
          <Input v-model="newProjectDescription" placeholder="What is this project for?" />
        </div>
        <div class="flex gap-2">
          <Button
            :loading="createMutation.isPending.value"
            :disabled="!newProjectName.trim()"
            @click="createMutation.mutate()"
          >
            Create Project
          </Button>
          <Button variant="outline" @click="showNewProjectForm = false">
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Loading State -->
    <div v-if="isLoading" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="h-32" />
    </div>

    <!-- Empty State -->
    <div v-else-if="!projects?.length" class="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
      <FolderOpen class="h-10 w-10 text-muted-foreground/40" />
      <h3 class="mt-4 text-sm font-medium">No projects yet</h3>
      <p class="mt-1 text-sm text-muted-foreground">Create your first project to start uploading data.</p>
      <Button class="mt-4" @click="showNewProjectForm = true">
        <Plus class="mr-2 h-4 w-4" />
        Create Project
      </Button>
    </div>

    <!-- Projects Grid and Detail -->
    <div v-else class="grid gap-6 lg:grid-cols-[1fr_400px]">
      <!-- Projects List -->
      <div class="grid gap-4 md:grid-cols-2">
        <Card
          v-for="project in projects"
          :key="project.id"
          :class="cn(
            'cursor-pointer transition-colors hover:border-muted-foreground/50',
            selectedProject?.id === project.id && 'border-foreground'
          )"
          @click="selectedProject = project"
        >
          <CardContent class="p-4">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FolderOpen class="h-5 w-5" />
                </div>
                <div>
                  <h3 class="font-medium">{{ project.name }}</h3>
                  <p v-if="project.description" class="text-xs text-muted-foreground line-clamp-1">
                    {{ project.description }}
                  </p>
                </div>
              </div>
              <Badge variant="secondary">{{ project.upload_count }} uploads</Badge>
            </div>
            <p class="mt-3 text-xs text-muted-foreground">
              Created {{ new Date(project.created_at).toLocaleDateString() }}
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Project Detail -->
      <Card class="sticky top-4 h-fit">
        <CardContent class="p-6">
          <div v-if="!selectedProject" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FolderOpen class="h-8 w-8 opacity-40" />
            <p class="mt-4 text-sm">Select a project to view details</p>
          </div>

          <template v-else>
            <div class="flex items-center justify-between mb-6">
              <h3 class="font-semibold">{{ selectedProject.name }}</h3>
              <Button size="sm" @click="fileInputRef?.click()">
                <UploadIcon class="mr-2 h-4 w-4" />
                Upload
              </Button>
              <input
                ref="fileInputRef"
                type="file"
                accept=".csv"
                class="hidden"
                @change="handleFileUpload"
              />
            </div>

            <p v-if="selectedProject.description" class="text-sm text-muted-foreground mb-6">
              {{ selectedProject.description }}
            </p>

            <!-- Uploads List -->
            <div class="space-y-3">
              <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Uploads</h4>

              <div v-if="uploadsLoading" class="space-y-2">
                <Skeleton v-for="i in 3" :key="i" class="h-14" />
              </div>

              <div v-else-if="!uploads?.length" class="rounded-md border border-dashed p-6 text-center">
                <FileText class="mx-auto h-6 w-6 text-muted-foreground/40" />
                <p class="mt-2 text-sm text-muted-foreground">No uploads yet</p>
                <Button variant="outline" size="sm" class="mt-3" @click="fileInputRef?.click()">
                  Upload CSV
                </Button>
              </div>

              <div v-else class="space-y-2">
                <div
                  v-for="upload in uploads"
                  :key="upload.id"
                  class="flex items-center gap-3 rounded-md border p-3"
                >
                  <FileText class="h-5 w-5 text-muted-foreground" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{{ upload.file_name }}</p>
                    <p class="text-xs text-muted-foreground">
                      {{ upload.row_count ?? 0 }} rows
                      <span v-if="upload.processed_at">
                        &middot; {{ new Date(upload.processed_at).toLocaleString() }}
                      </span>
                    </p>
                  </div>
                  <component
                    :is="getStatusIcon(upload.status)"
                    :class="['h-4 w-4', getStatusColor(upload.status)]"
                  />
                </div>
              </div>
            </div>
          </template>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

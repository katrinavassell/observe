<script setup lang="ts">
import { ref } from 'vue'
import { Upload, FileText, X } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

interface Props {
  accept?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  accept: '.csv',
  disabled: false,
})

const emit = defineEmits<{
  file: [file: File]
  clear: []
}>()

const isDragging = ref(false)
const selectedFile = ref<File | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  if (!props.disabled) {
    isDragging.value = true
  }
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false

  if (props.disabled) return

  const droppedFiles = e.dataTransfer?.files
  if (droppedFiles && droppedFiles.length > 0) {
    const file = droppedFiles[0]
    if (file) handleFile(file)
  }
}

function handleFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  const inputFiles = input.files
  if (inputFiles && inputFiles.length > 0) {
    const file = inputFiles[0]
    if (file) handleFile(file)
  }
}

function handleFile(file: File) {
  selectedFile.value = file
  emit('file', file)
}

function clearFile() {
  selectedFile.value = null
  if (inputRef.value) {
    inputRef.value.value = ''
  }
  emit('clear')
}

function openFilePicker() {
  if (!props.disabled) {
    inputRef.value?.click()
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div
    :class="cn(
      'relative rounded-lg border-2 border-dashed transition-colors',
      isDragging ? 'border-primary bg-primary/5' : 'border-border',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-muted-foreground/50',
      selectedFile ? 'border-success bg-success/5' : ''
    )"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @click="openFilePicker"
  >
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      :disabled="disabled"
      class="hidden"
      @change="handleFileInput"
    />

    <!-- Empty state -->
    <div v-if="!selectedFile" class="flex flex-col items-center justify-center p-8 text-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Upload class="h-6 w-6 text-muted-foreground" />
      </div>
      <p class="mt-4 text-sm font-medium">
        Drop your CSV file here
      </p>
      <p class="mt-1 text-xs text-muted-foreground">
        or click to browse
      </p>
    </div>

    <!-- File selected -->
    <div v-else class="flex items-center gap-3 p-4">
      <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
        <FileText class="h-5 w-5 text-success" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">{{ selectedFile.name }}</p>
        <p class="text-xs text-muted-foreground">{{ formatFileSize(selectedFile.size) }}</p>
      </div>
      <button
        type="button"
        class="rounded-md p-1 hover:bg-muted"
        @click.stop="clearFile"
      >
        <X class="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  </div>
</template>

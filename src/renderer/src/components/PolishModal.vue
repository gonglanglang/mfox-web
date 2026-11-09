<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{
  show: boolean
  text: string
  polishing: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  accept: []
}>()

const renderedHtml = computed(() => {
  if (!props.text) return ''
  return marked.parse(props.text) as string
})

function cancel(): void {
  emit('update:show', false)
}

function accept(): void {
  emit('accept')
}
</script>

<template>
  <AppModal :open="show" @close="cancel">
    <div class="modal-box w-11/12 max-w-3xl">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold flex items-center gap-2">
          <span class="text-primary">✨</span> AI 润色结果
        </h3>
        <span v-if="polishing" class="badge badge-ghost badge-sm">生成中</span>
        <span v-else class="badge badge-success badge-sm gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          完成
        </span>
      </div>

      <div class="bg-base-200 rounded-xl p-5 max-h-[60vh] overflow-y-auto">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <article class="md-content" v-html="renderedHtml"></article>
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost btn-sm" @click="cancel">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="polishing" @click="accept">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          采用
        </button>
      </div>
    </div>
  </AppModal>
</template>

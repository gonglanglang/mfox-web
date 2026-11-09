<script setup lang="ts">
import { computed, watch } from 'vue'
import { useWorkflowTimeline } from '@/composables/useWorkflowTimeline'
import AppModal from '@/components/AppModal.vue'

// 纯展示组件：只读全局工作流时间链状态，负责弹窗显示与完成后的自动隐藏。
// 任务恢复（useTaskRecovery）由各页面自行调用，避免组件与页面职责耦合。
const { steps, visible, hide, allDone } = useWorkflowTimeline()
const hasFailed = computed(() => steps.value.some(s => s.status === 'failed'))

// 全部步骤完成后延迟隐藏弹窗（给用户留出完成反馈时间）
watch(allDone, (v) => {
  if (v) {
    const timer = setTimeout(hide, 1500)
    return () => clearTimeout(timer) // watch 清理：组件卸载/再次触发时取消未执行的定时器
  }
})

// 失败后保留 3 秒让用户看清失败步骤，然后自动关闭
watch(hasFailed, (v) => {
  if (v) {
    const timer = setTimeout(hide, 3000)
    return () => clearTimeout(timer)
  }
})
</script>

<template>
  <AppModal :open="visible" :backdrop-close="false" @close="hide">
      <div class="modal-box max-w-[260px] w-full rounded-2xl p-5 text-center bg-base-100">
        <div class="inline-flex items-center gap-2 mb-4">
          <svg class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <span class="text-sm font-bold">正在为你构建小说世界...</span>
        </div>

        <div class="space-y-2">
          <div v-for="s in steps" :key="s.name"
            class="flex items-center gap-2.5 p-2.5 rounded-lg transition-all duration-500"
            :class="s.status === 'done' ? 'bg-success/5' : s.status === 'failed' ? 'bg-error/5' : s.status === 'running' ? 'bg-primary/5' : 'bg-base-200/50'">
            <div class="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500"
              :class="s.status === 'done' ? 'bg-success text-white' : s.status === 'failed' ? 'bg-error text-error-content' : s.status === 'running' ? 'bg-primary text-white' : 'bg-base-300 text-base-content/30'">
              <svg v-if="s.status === 'done'" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <svg v-else-if="s.status === 'failed'" class="w-3 h-3" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span v-else-if="s.status === 'running'" class="loading loading-spinner loading-xs" />
              <span v-else class="text-[10px] font-bold">{{ steps.indexOf(s) + 1 }}</span>
            </div>
            <div class="text-left flex-1 min-w-0">
              <div class="text-xs font-medium transition-colors duration-500"
                :class="s.status === 'done' ? 'text-success' : s.status === 'failed' ? 'text-error' : s.status === 'running' ? 'text-primary' : 'text-base-content/30'">
                {{ s.label }}</div>
            </div>
          </div>
        </div>

        <p class="text-[10px] text-base-content/25 mt-3">{{steps.every(s => s.status === 'done') ? '即将跳转...' : ''}}
        </p>
      </div>
    </AppModal>
</template>

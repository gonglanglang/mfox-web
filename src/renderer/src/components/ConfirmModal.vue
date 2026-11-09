<script setup lang="ts">
/**
 * 通用二次确认弹窗（替代 window.confirm）
 * 基于 AppModal：支持 ESC / 遮罩关闭（等价“取消”）、确认按钮 loading 态与危险色。
 */
import AppModal from '@/components/AppModal.vue'

const props = withDefaults(defineProps<{
  /** 是否打开（支持 v-model:open） */
  open: boolean
  /** 标题 */
  title?: string
  /** 说明文案（支持换行） */
  message?: string
  /** 确认按钮文字 */
  confirmText?: string
  /** 取消按钮文字 */
  cancelText?: string
  /** 危险操作样式（红色按钮） */
  danger?: boolean
  /** 确认中：按钮 loading 并禁用遮罩/ESC 关闭 */
  loading?: boolean
}>(), {
  title: '请确认',
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  danger: false,
  loading: false,
})

const emit = defineEmits<{
  confirm: []
  cancel: []
  'update:open': [value: boolean]
}>()

/** 确认 */
function onConfirm(): void {
  if (!props.loading) emit('confirm')
}

/** 点取消按钮 */
function onCancel(): void {
  emit('cancel')
  emit('update:open', false)
}

/** ESC / 遮罩关闭：语义等同“取消” */
function onClose(): void {
  emit('cancel')
  emit('update:open', false)
}
</script>

<template>
  <AppModal :open="open" :backdrop-close="!loading" @close="onClose">
    <div class="modal-box rounded-2xl max-w-sm">
      <h3 class="font-bold text-base flex items-center gap-2">
        <span
          v-if="danger"
          class="w-6 h-6 rounded-full inline-flex items-center justify-center shrink-0 bg-error/10 text-error"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </span>
        {{ title }}
      </h3>
      <p v-if="message" class="text-sm text-base-content/70 mt-3 whitespace-pre-wrap leading-relaxed">
        {{ message }}
      </p>

      <div class="modal-action mt-5">
        <button class="btn btn-sm" :disabled="loading" @click="onCancel">{{ cancelText }}</button>
        <button
          class="btn btn-sm"
          :class="danger ? 'btn-error' : 'btn-primary'"
          :disabled="loading"
          @click="onConfirm"
        >
          <span v-if="loading" class="loading loading-spinner loading-xs"></span>
          {{ confirmText }}
        </button>
      </div>
    </div>
  </AppModal>
</template>

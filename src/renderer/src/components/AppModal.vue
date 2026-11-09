<script setup lang="ts">
/**
 * 通用弹窗容器（daisyUI 原生 dialog 方式，官方 showModal 语义）
 * 统一管理：Teleport to body、dialog 原生 showModal/close、ESC/遮罩/form 关闭并回写状态。
 * 内容由调用方通过默认插槽提供（modal-box 及其内部结构）。
 */
import { ref, watch, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  /** 是否打开（支持 v-model:open） */
  open: boolean
  /** 点击遮罩是否关闭（默认 true） */
  backdropClose?: boolean
}>(), {
  backdropClose: true,
})

const emit = defineEmits<{
  close: []
  'update:open': [value: boolean]
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)

watch(() => props.open, async (v) => {
  const dlg = dialogRef.value
  if (!v) {
    if (dlg?.open) dlg.close()
    return
  }
  await nextTick()
  await openDialog()
}, { immediate: true })

/**
 * 原生打开 dialog。SPA 路由切换时上一页的原生 modal 可能尚未关闭，
 * 此时 showModal() 会抛 InvalidStateError 导致本次打开永久丢失（刷新才恢复）。
 * 因此捕获冲突并短暂重试（最多约 1s），确保弹窗可靠弹出。
 */
async function openDialog(retries = 8): Promise<void> {
  const dlg = dialogRef.value
  if (!dlg || dlg.open) return
  try {
    dlg.showModal()
  } catch (e) {
    console.warn('AppModal 打开时与其它原生 dialog 冲突，稍后重试', e)
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 120))
      await openDialog(retries - 1)
    }
  }
}

/** 统一关闭出口：原生关闭（ESC / form / 程序 close）都会回到这里同步状态 */
function onClose() {
  emit('close')
  emit('update:open', false)
}

function onBackdrop() {
  if (props.backdropClose) onClose()
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialogRef" class="modal" @click.self="onBackdrop" @close="onClose">
      <slot />
      <form v-if="backdropClose" method="dialog" class="modal-backdrop">
        <button aria-label="关闭">close</button>
      </form>
    </dialog>
  </Teleport>
</template>

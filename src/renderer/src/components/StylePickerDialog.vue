<script setup lang="ts">
/**
 * 紧凑画风入口：只显示当前画风（缩略图 + 名称），点击打开弹层再选。
 * 用于窄面板/页面顶部——画风有 30+ 个，直接铺开会挤掉正文。
 */
import { computed, onMounted, ref } from 'vue'
import AppModal from '@/components/AppModal.vue'
import StylesGrid from '@/components/StylesGrid.vue'
import { visualStylesApi, type VisualStyleItem } from '@/api/visual-styles'

const props = withDefaults(defineProps<{
  /** 当前选中的画风 ID */
  modelValue: number | null
  /** 是否允许创建/删除自定义画风 */
  allowCustom?: boolean
  /** 前置标题文案；传空（默认）则不显示，画风行只显示当前画风 */
  label?: string
}>(), { allowCustom: true, label: '' })

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const open = ref(false)
const items = ref<VisualStyleItem[]>([])
/** 摘要与弹层共用同一份列表，避免两处显示不一致 */
const current = computed(() => items.value.find(style => style.style_id === props.modelValue) || null)

async function load() {
  try { items.value = await visualStylesApi.list() } catch { /* 摘要加载失败不阻断选择 */ }
}

onMounted(load)

function select(value: number | null) {
  emit('update:modelValue', value)
  open.value = false
}
</script>

<template>
  <div class="flex items-center gap-3 min-w-0">
    <span v-if="label" class="text-xs font-semibold text-base-content/50 shrink-0">{{ label }}</span>
    <button type="button"
      class="flex items-center gap-2 rounded-xl border border-base-300 bg-base-100 px-2 py-1 min-w-0 flex-1 hover:border-primary/60 transition-colors"
      @click="open = true">
      <span class="w-12 h-7 rounded-md overflow-hidden bg-base-200 shrink-0 flex items-center justify-center">
        <img v-if="current?.effect_image" :src="current.effect_image" alt="画风参考图" class="w-full h-full object-cover" />
        <span v-else class="text-[9px] text-base-content/30">—</span>
      </span>
      <span class="text-xs truncate" :class="current ? 'text-base-content/80' : 'text-base-content/40'">
        {{ current?.name || '未选择画风' }}
      </span>
      <span class="text-[11px] text-primary shrink-0 ml-auto pr-1">更换</span>
    </button>
  </div>

  <AppModal v-model:open="open">
    <div class="modal-box max-w-3xl">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-bold text-sm">选择作品画风</h3>
        <button class="btn btn-sm btn-circle btn-ghost" @click="open = false">✕</button>
      </div>
      <p class="text-[11px] text-base-content/50 leading-snug mb-3">
        画风描述会写入所有分镜帧提示词的【画风】段；画风参考图作为 style reference 随分镜出图一并传给模型。
      </p>
      <StylesGrid :model-value="modelValue" :items="items" :allow-custom="allowCustom" :columns="4"
        @update:model-value="select" @changed="load" />
    </div>
  </AppModal>
</template>

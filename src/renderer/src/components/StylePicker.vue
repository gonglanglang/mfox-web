<script setup lang="ts">
/**
 * 画风选择器（内联网格）：用于宽表单（如新建作品）。
 * 窄容器里请用 StylePickerDialog（只显示当前画风 + 弹层选择），避免把整份列表铺在页面上。
 */
import StylesGrid from '@/components/StylesGrid.vue'

withDefaults(defineProps<{
  /** 当前选中的画风 ID */
  modelValue: number | null
  /** 网格列数 */
  columns?: number
  /** 标题文案；传空字符串则不显示标题 */
  label?: string
  /** 是否允许创建/删除自定义画风 */
  allowCustom?: boolean
}>(), { columns: 3, label: '选择画风', allowCustom: true })

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
</script>

<template>
  <div>
    <div v-if="label" class="label">
      <span class="label-text font-medium">{{ label }} <span class="text-error">*</span> <span
          class="text-base-content/30 text-xs font-normal ml-1">（必选）</span></span>
    </div>
    <StylesGrid :model-value="modelValue" :columns="columns" :allow-custom="allowCustom"
      @update:model-value="emit('update:modelValue', $event)" />
  </div>
</template>

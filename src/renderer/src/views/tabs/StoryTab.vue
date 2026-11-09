<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue'
import NovelEditor from '@/components/NovelEditor.vue'
// 角色列表 + 提取（可复用组件）+ 提取任务链
import CharacterListPanel from '@/components/CharacterListPanel.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import StylePickerDialog from '@/components/StylePickerDialog.vue'
import { useToast } from '@/composables/useToast'
import type { PersonaItem } from '@/api/personas'
import { validateProps, type ValidationRule } from '@/utils/validator';

const props = defineProps<{
  workId: number // 工作ID
  chapterId: number // 当前章节ID
  chapterTitle: string // 当前章节标题
  chapterContent: string // 当前章节内容
  personas: PersonaItem[] // 工作下所有角色
  /** 作品画风 ID（分镜提取与重绘统一使用） */
  styleId: number | null
  /** AI 文本模型（VideoStoryboard header 选择，透传角色提取） */
  model: string
  /** 当前文本模型单次消耗积分 */
  modelCost?: number
}>()

const emit = defineEmits<{
  'update:chapterTitle': [value: string]
  'update:chapterContent': [value: string]
  /** 作品画风变更（由父级持久化到 works） */
  'update:styleId': [value: number | null]
  /** 向 VideoStoryboard header 注册本步骤主操作（提取角色） */
  'register-action': [action: { label: string; run: () => void } | null]
}>()

const chapterTitleModel = computed({
  get: () => props.chapterTitle,
  set: (v: string) => emit('update:chapterTitle', v),
})

const chapterContentModel = computed({
  get: () => props.chapterContent,
  set: (v: string) => emit('update:chapterContent', v),
})

const styleModel = computed({
  get: () => props.styleId,
  set: (v: number | null) => emit('update:styleId', v),
})

// ── 注册主操作：提取角色（实际逻辑在 CharacterListPanel，经 ref 调用） ──
const clpRef = ref<InstanceType<typeof CharacterListPanel> | null>(null)
const showExtractConfirm = ref(false)
const extractType = ref<'all' | 'persona' | 'scene' | 'prop'>('all')
const extractLabel = computed(() => ({ all: '角色、场景、道具', persona: '角色', scene: '场景', prop: '道具' })[extractType.value])

const { show: showToast } = useToast()

const extractConfirmMessage = computed(() => [
  `文本模型：${props.model || '未选择'}`,
  `本次预计消耗：${(props.modelCost || 0) * (extractType.value === 'all' ? 3 : 1)} 积分`,
  `将从原文提取${extractLabel.value}，并创建到故事素材列表。`,
].join('\n'))

// 打开提取确认确认弹窗
function openExtractConfirm(type: 'all' | 'persona' | 'scene' | 'prop' = 'all') {
  if (clpRef.value?.extracting) return
  extractType.value = type
  const rules: ValidationRule[] = [
    { key: 'chapterContent', message: '章节内容为空，无法提取素材' },
    { key: 'model', message: '请先在顶部选择文本模型' },
  ]
  const result = validateProps(props, rules)
  console.log('validateProps', result)
  if (!result.valid) {
    showToast(result.message, 'info')
    return
  }
  showExtractConfirm.value = true
}

// 确认提取素材
function confirmExtract() {
  showExtractConfirm.value = false
  clpRef.value?.runExtract(extractType.value)
}

// 组件挂载时，注册主操作：提取素材
onMounted(() => {
  nextTick(() => {
    emit('register-action', { label: '提取素材', run: openExtractConfirm })
  })
})

// 组件卸载时，取消注册主操作
onUnmounted(() => emit('register-action', null))
</script>

<template>
  <div class="flex-1 flex min-h-0">
    <!-- 左：角色列表 + 提取（顶部扩展位放作品画风：列表较长，点击弹层选择） -->
    <CharacterListPanel ref="clpRef" :work-id="workId" :chapter-id="chapterId" :chapter-content="props.chapterContent"
      :personas="personas" :model="props.model" @request-extract="openExtractConfirm">
      <template #header>
        <div class="mb-3">
          <StylePickerDialog v-model="styleModel" />
        </div>
      </template>
    </CharacterListPanel>

    <!-- 右：章节编辑器 -->
    <div class="flex-1 flex flex-col min-h-0">
      <NovelEditor :work-id="workId" :chapter-id="chapterId" v-model:chapter-title="chapterTitleModel"
        :content="chapterContentModel" />
    </div>
  </div>

  <!-- 文本确认 -->
  <ConfirmModal
    v-model:open="showExtractConfirm"
    title="确认提取故事素材"
    :message="extractConfirmMessage"
    confirm-text="确认提取"
    type="text"
    @confirm="confirmExtract"
  />
</template>

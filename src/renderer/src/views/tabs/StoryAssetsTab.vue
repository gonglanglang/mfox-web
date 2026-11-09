<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { uploadImageToOSS } from '@/api/oss'
import {
  personasApi,
  type ImageAsset,
  type PersonaItem,
  type UpdatePersonaParams,
} from '@/api/personas'
import { voicesApi, type VoiceItem } from '@/api/voices'
import { ASSET_CATEGORY_OPTIONS, DEFAULT_ASSET_NAME_BY_CATEGORY } from '@/constants/assets'
import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'
import {
  buildAssetSearchText,
  buildSceneDetailFromForm,
  createUploadedImageAsset,
  getAssetLabel,
  hasRunningAssetImage,
} from '@/utils'
import { validateProps, type ValidationRule } from '@/utils/validator'
import type { AssetCategory, AssetCategorySummary, AssetEditorModelConfig } from '@/types/assets'
import AssetEditorModal from './assets/AssetEditorModal.vue'
import AssetGrid from './assets/AssetGrid.vue'
import AssetsToolbar from './assets/AssetsToolbar.vue'

/**
 * 故事素材 Tab 的容器组件。
 *
 * 父级 VideoStoryboard 持有作品、章节、素材、配音和模型选择等公共状态，本组件通过 props 接收这些引用。
 * 素材刷新时使用 splice 原地替换数组内容，目的是让父组件和其他 tab 仍然共享同一个响应式数组引用。
 */
const props = defineProps<{
  personas: PersonaItem[]
  voices: VoiceItem[]
  voiceOptions: string[]
  workId: number
  chapterId: number
  chapterContent: string
  styleId: number | null
  model: string
  textModel: string
  modelResolution?: string
  modelCost?: number
}>()

/**
 * 头部主操作按钮由父组件统一渲染。
 * 本组件只注册当前素材步骤应该执行的动作，切换到其他 tab 或卸载时会主动清空。
 */
const emit = defineEmits<{
  'register-action': [action: {
    label: string
    run: () => void
    confirm?: {
      open: boolean
      selectedCount: number
      quality?: string
      resolution?: string
      cost: number
      generating: boolean
      close: () => void
      submit: () => void
    }
  } | null]
}>()

const { show: showToast } = useToast()
const { refreshUser } = useAuth()

// 与弹窗共享模型参数契约，不再使用旧版弹窗内选模和确认状态。
const editorModelConfig = computed<AssetEditorModelConfig>(() => ({
  model: props.model,
  modelResolution: props.modelResolution,
  modelCost: props.modelCost,
}))

// ═══════════════════════════════════════════
// 素材加载
// ═══════════════════════════════════════════

/**
 * 从后端重新拉取素材和配音。
 * 这里不重新赋值 props.personas / props.voices，而是原地替换，避免父级传下来的数组引用失效。
 */
async function refreshAssets() {
  if (!props.workId) return
  const [pList, vList] = await Promise.all([
    personasApi.list(props.workId),
    voicesApi.list(),
  ])
  props.personas.splice(0, props.personas.length, ...pList)
  props.voices.splice(0, props.voices.length, ...vList)
}

// ═══════════════════════════════════════════
// 分类与搜索
// ═══════════════════════════════════════════

const assetCategory = ref<AssetCategory>('persona')
const assetSearch = ref('')
const normalizedAssetSearch = computed(() => assetSearch.value.trim().toLowerCase())

/**
 * 按当前分类和关键词筛选素材。
 * 搜索文本包含场景 detail 里的时间、地点、氛围、关键事件，保证“深夜 / 城中村巷道”这类结构化字段也能命中。
 */
const assetsByType = (type: AssetCategory) => {
  const list = props.personas.filter(item => item.source_type === type)
  const keyword = normalizedAssetSearch.value
  if (!keyword) return list
  return list.filter(item => buildAssetSearchText(item).includes(keyword))
}

const assetCount = (type: AssetCategory) => props.personas.filter(item => item.source_type === type).length
const filteredAssetCount = (type: AssetCategory) => assetsByType(type).length
const currentAssets = computed(() => assetsByType(assetCategory.value))
const currentCategoryLabel = computed(() => getAssetLabel(assetCategory.value))
const currentEmptyText = computed(() => normalizedAssetSearch.value
  ? `没有找到「${assetSearch.value.trim()}」`
  : `暂无${currentCategoryLabel.value}`)
const categorySummaries = computed<AssetCategorySummary[]>(() => ASSET_CATEGORY_OPTIONS.map(cat => ({
  key: cat.key,
  label: cat.label,
  count: normalizedAssetSearch.value ? filteredAssetCount(cat.key) : assetCount(cat.key),
})))

/**
 * 全局搜索时，如果当前分类没有结果但其他分类有结果，自动切到第一个命中的分类。
 * 这样顶部搜索可以快速定位角色、场景或道具，不需要用户手动试每个分类。
 */
watch(normalizedAssetSearch, (keyword) => {
  if (!keyword || filteredAssetCount(assetCategory.value) > 0) return
  const matched = ASSET_CATEGORY_OPTIONS.find(cat => filteredAssetCount(cat.key) > 0)
  if (matched) assetCategory.value = matched.key
})

// ═══════════════════════════════════════════
// 批量生成素材图片
// ═══════════════════════════════════════════

const selectingForGenerate = ref(false)
const selectedAssetIds = ref<number[]>([])
const batchGenerating = ref(false)
const showBatchConfirmModal = ref(false)

const selectableAssets = computed(() => currentAssets.value.filter(item => item.description?.trim()))
const selectedAssets = computed(() => props.personas.filter(item => selectedAssetIds.value.includes(item.id)))
const selectedCount = computed(() => selectedAssetIds.value.length)
const selectedGenerateCost = computed(() => selectedCount.value * (props.modelCost || 0))

/**
 * 切换分类时清空选择，避免用户在“角色”选中后切到“场景”误以为只会生成当前分类。
 */
watch(assetCategory, () => {
  selectedAssetIds.value = []
})

function toggleSelectAsset(id: number) {
  if (!selectingForGenerate.value) return

  const item = props.personas.find(asset => asset.id === id) || {}
  const result = validateProps(item, [
    { key: 'description', message: '请先补充素材描述' },
  ])
  if (!result.valid) {
    showToast(result.message, 'info')
    return
  }

  selectedAssetIds.value = selectedAssetIds.value.includes(id)
    ? selectedAssetIds.value.filter(itemId => itemId !== id)
    : [...selectedAssetIds.value, id]
}

function startBatchSelect() {
  const result = validateProps(props, [
    { key: 'textModel', message: '请先选择文本模型' },
    { key: 'model', message: '请先选择图片模型' },
  ])
  if (!result.valid) {
    showToast(result.message, 'info')
    return
  }
  selectingForGenerate.value = true
  selectedAssetIds.value = []
}

function cancelBatchSelect() {
  selectingForGenerate.value = false
  selectedAssetIds.value = []
}

function selectAllCurrentAssets() {
  selectedAssetIds.value = selectableAssets.value.map(item => item.id)
}

/**
 * 打开最终扣费确认弹窗前做前置校验。
 * 生成接口会扣积分，所以这里必须确认模型、质量、分辨率、风格和目标素材都齐全。
 */
function openBatchGenerateConfirm() {
  const rules: ValidationRule[] = [
    { key: 'batchGenerating', message: '正在生成的图片，请稍后再试', validator: () => !batchGenerating.value },
    { key: 'textModel', message: '请先选择文本模型' },
    { key: 'model', message: '请先选择图片模型' },
    { key: 'modelResolution', message: '请先选择图片分辨率' },
    { key: 'styleId', message: '请先设置风格' },
    {
      key: 'selectedAssets',
      message: '请选择有描述的素材',
      validator: () => selectedAssets.value.some(item => item.description?.trim()),
    },
  ]
  const result = validateProps(props, rules)
  if (!result.valid) {
    showToast(result.message, 'info')
    return
  }
  showBatchConfirmModal.value = true
}

async function confirmBatchGenerate() {
  showBatchConfirmModal.value = false
  await generateSelectedAssets()
}

/**
 * 批量生成只负责逐个创建后端任务，不等待图片真正生成完成。
 * 后端任务创建成功后立刻刷新列表，前端通过轮询把 running 占位图更新成最终图片。
 */
async function generateSelectedAssets() {
  const targets = selectedAssets.value.filter(item => item.description?.trim())
  batchGenerating.value = true
  try {
    for (const item of targets) {
      await personasApi.generateImage(item.work_id, item.id, {
        textModel: props.textModel,
        aiModel: props.model,
        resolution: props.modelResolution,
      })
    }
    showToast(`已开始生成 ${targets.length} 张图片`, 'success')
    refreshUser()
    await refreshAssets()
    cancelBatchSelect()
    autoPollIfRunning()
  } catch (e: any) {
    showToast(e?.message || '批量生成图片失败', 'error')
    await refreshAssets()
  } finally {
    batchGenerating.value = false
  }
}

function registerGenerateAction() {
  const confirm = showSingleGenerateConfirmModal.value
    ? {
        open: true,
        selectedCount: 1,
        resolution: props.modelResolution,
        cost: props.modelCost || 0,
        generating: generating.value,
        close: () => { showSingleGenerateConfirmModal.value = false },
        submit: onAiGenerate,
      }
    : selectingForGenerate.value
      ? {
          open: showBatchConfirmModal.value,
          selectedCount: selectedCount.value,
          resolution: props.modelResolution,
          cost: selectedGenerateCost.value,
          generating: batchGenerating.value,
          close: () => { showBatchConfirmModal.value = false },
          submit: confirmBatchGenerate,
        }
      : undefined

  emit('register-action', selectingForGenerate.value
    ? {
        label: batchGenerating.value ? '素材生成中...' : `确认素材生成${selectedCount.value ? ` ${selectedCount.value}` : ''}`,
        run: openBatchGenerateConfirm,
        confirm,
      }
    : { label: '生成素材图片', run: startBatchSelect, confirm })
}

// ═══════════════════════════════════════════
// 素材编辑弹窗
// ═══════════════════════════════════════════

const showEditModal = ref(false)
const editingPersonaId = ref<number | null>(null)
const editingAssetNameId = ref<number | null>(null)
const editAssetName = ref('')

const addFormName = ref('')
const addFormGender = ref<'male' | 'female' | 'unknown'>('unknown')
const addFormAge = ref('')
const addFormHeight = ref('') // 身高（cm）表单值；空串表示未填
const addFormVoiceId = ref<number | null>(null)
const addFormDescription = ref('')
const sceneFormTime = ref('')
const sceneFormLocation = ref('')
const sceneFormInterior = ref<'indoor' | 'outdoor' | 'unknown'>('unknown')
const sceneFormMood = ref('')
const sceneFormKeyEvents = ref('')
const addFormRefImage = ref<ImageAsset | null>(null)
const addFormImages = ref<ImageAsset[]>([])
const addFormCurImageId = ref<string>('')
const uploading = ref(false)
const generating = ref(false)
const generatingDescription = ref(false)
let descriptionRequestId = 0

function invalidateDescriptionRequest() {
  descriptionRequestId++
  generatingDescription.value = false
}

/** 身高（厘米）：只接受 30~300 的整数，空串 / 小数 / 越界按未填处理；与后端 normalizeHeight 规则一致。 */
function normalizeHeight(value: string): number | null {
  if (!value.trim()) return null
  const height = Number(value)
  return Number.isInteger(height) && height >= 30 && height <= 300 ? height : null
}

function descriptionSnapshot() {
  return JSON.stringify([addFormName.value, addFormGender.value, addFormAge.value, addFormHeight.value, addFormDescription.value])
}

async function onGenerateDescription() {
  if (generatingDescription.value || generating.value || !props.workId || !editingPersonaId.value) return
  if (!addFormName.value.trim()) return showToast('请先填写角色名称', 'info')
  if (!props.textModel) return showToast('请先选择文本模型', 'info')
  const requestId = ++descriptionRequestId
  const snapshot = descriptionSnapshot()
  generatingDescription.value = true
  try {
    const result = await personasApi.generateDescription(props.workId, editingPersonaId.value, {
      textModel: props.textModel,
      name: addFormName.value,
      gender: addFormGender.value,
      age: addFormAge.value,
      description: addFormDescription.value,
    })
    if (requestId !== descriptionRequestId || !showEditModal.value) return
    if (snapshot !== descriptionSnapshot()) {
      showToast('角色信息已修改，已保留当前内容，请重新生成描述', 'info')
      return
    }
    addFormDescription.value = result.description
    // 结构化身高回填输入框（用户仍可修改）；描述正文里也已写明该数值
    if (result.heightCm != null) addFormHeight.value = String(result.heightCm)
    showToast(result.heightCm ? `角色描述已生成（身高约 ${result.heightCm}cm），可修改后点击应用保存` : '角色描述已生成，可修改后点击应用保存', 'success')
  } catch (e: any) {
    if (requestId === descriptionRequestId && showEditModal.value) showToast(e?.message || 'AI 生成角色描述失败', 'error')
  } finally {
    if (requestId === descriptionRequestId) generatingDescription.value = false
  }
}
const showSingleGenerateConfirmModal = ref(false)

const editingAsset = computed(() => props.personas.find(item => item.id === editingPersonaId.value) || null)
const editingAssetType = computed<AssetCategory>(() => editingAsset.value?.source_type || assetCategory.value)
const editingCategoryLabel = computed(() => getAssetLabel(editingAssetType.value))
const editModalTitle = computed(() => editingPersonaId.value ? `编辑${editingCategoryLabel.value}` : `新增${editingCategoryLabel.value}`)
const imageSectionLabel = computed(() => editingAssetType.value === 'persona' ? '形象图' : `${editingCategoryLabel.value}图`)
const aiGenerateLabel = computed(() => `AI生成${imageSectionLabel.value}`)
const imageTileClass = computed(() => editingAssetType.value === 'persona' ? 'aspect-[3/4]' : 'aspect-square')

/**
 * 快速创建会先落库，再打开编辑弹窗。
 * 这样图片上传、AI 生成等操作都能基于一个真实素材 ID 进行，避免临时草稿和服务端数据同步复杂化。
 */
async function quickCreate(type: AssetCategory) {
  if (!props.workId || !props.chapterId) return
  const created = await personasApi.create(props.workId, {
    chapters_id: props.chapterId,
    name: DEFAULT_ASSET_NAME_BY_CATEGORY[type],
    source_type: type,
  })
  await refreshAssets()
  const item = props.personas.find(persona => persona.id === created.id)
  if (item) openEditModal(item)
}

function openEditModal(persona: PersonaItem) {
  invalidateDescriptionRequest()
  editingPersonaId.value = persona.id
  addFormName.value = persona.name
  addFormGender.value = persona.gender
  addFormAge.value = persona.age || ''
  addFormHeight.value = persona.height == null ? '' : String(persona.height)
  addFormVoiceId.value = persona.voice_id || null
  addFormDescription.value = persona.description || ''
  sceneFormTime.value = persona.detail?.time || ''
  sceneFormLocation.value = persona.detail?.location || ''
  sceneFormInterior.value = persona.detail?.interior === true
    ? 'indoor'
    : persona.detail?.interior === false ? 'outdoor' : 'unknown'
  sceneFormMood.value = persona.detail?.mood || ''
  sceneFormKeyEvents.value = persona.detail?.key_events || ''
  addFormRefImage.value = persona.ref_images?.[0] || null
  addFormImages.value = persona.images || []
  addFormCurImageId.value = persona.cur_image_id || ''
  showEditModal.value = true
}

function closeEditModal() {
  invalidateDescriptionRequest()
  showEditModal.value = false
  showSingleGenerateConfirmModal.value = false
}

/**
 * 构造提交给后端的素材 payload。
 * 场景素材会额外把时间、地点、室内外等字段写入 detail；道具目前沿用基础字段。
 */
function buildEditPayload(trimName = true): UpdatePersonaParams {
  const payload: UpdatePersonaParams = {
    name: trimName ? addFormName.value.trim() : addFormName.value,
    description: addFormDescription.value || '',
    ref_images: addFormRefImage.value ? [addFormRefImage.value] : [],
    images: addFormImages.value,
    cur_image_id: addFormCurImageId.value || undefined,
  }

  if (editingAssetType.value === 'persona') {
    payload.gender = addFormGender.value
    payload.age = addFormAge.value || undefined
    payload.height = normalizeHeight(addFormHeight.value)
    payload.voice_id = addFormVoiceId.value || undefined
  } else if (editingAssetType.value === 'scene') {
    payload.detail = buildSceneDetailFromForm({
      previous: editingAsset.value?.detail,
      name: addFormName.value,
      description: addFormDescription.value,
      time: sceneFormTime.value,
      location: sceneFormLocation.value,
      interior: sceneFormInterior.value,
      mood: sceneFormMood.value,
      keyEvents: sceneFormKeyEvents.value,
    })
  }

  return payload
}

async function submitEdit() {
  if (generatingDescription.value) return
  if (!props.workId || !editingPersonaId.value || !addFormName.value.trim()) return
  await personasApi.update(props.workId, editingPersonaId.value, buildEditPayload())
  showEditModal.value = false
  editingPersonaId.value = null
  await refreshAssets()
}

/**
 * 编辑弹窗内触发 AI 生成前先静默保存表单。
 * 这样后端生成图片时读取到的是用户最新编辑的描述、场景 detail 和参考图。
 */
async function submitEditSilent() {
  if (!props.workId || !editingPersonaId.value) return
  const payload = buildEditPayload(false)
  payload.style_id = props.styleId || undefined
  await personasApi.update(props.workId, editingPersonaId.value, payload)
}

function syncEditingImages() {
  const asset = props.personas.find(item => item.id === editingPersonaId.value)
  if (!asset) return
  addFormImages.value = asset.images || []
  if (!addFormCurImageId.value && addFormImages.value.length > 0) {
    addFormCurImageId.value = addFormImages.value[addFormImages.value.length - 1].id
  }
}

// ═══════════════════════════════════════════
// 上传、删除、配音和预览
// ═══════════════════════════════════════════

async function onUpload(target: 'ref_image' | 'images', e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const url = await uploadImageToOSS(file)
    const asset = createUploadedImageAsset(url)
    if (target === 'ref_image') addFormRefImage.value = asset
    else addFormImages.value.push(asset)
  } finally {
    uploading.value = false
  }
}

function removeImage(target: 'ref_image' | 'images', idx?: number) {
  if (target === 'ref_image') {
    addFormRefImage.value = null
    return
  }
  if (idx === undefined) return
  const removed = addFormImages.value[idx]
  addFormImages.value.splice(idx, 1)
  if (removed?.id && addFormCurImageId.value === removed.id) addFormCurImageId.value = ''
}

function startEditAsset(persona: PersonaItem) {
  editingAssetNameId.value = persona.id
  editAssetName.value = persona.name
}

function cancelEditAsset() {
  editingAssetNameId.value = null
}

function finishEditAsset(persona: PersonaItem) {
  const name = editAssetName.value.trim()
  if (name) {
    personasApi.update(persona.work_id, persona.id, { name }).then(() => {
      persona.name = name
    })
  }
  editingAssetNameId.value = null
}

async function deleteAsset(persona: PersonaItem) {
  await personasApi.remove(persona.work_id, persona.id)
  const idx = props.personas.findIndex(item => item.id === persona.id)
  if (idx >= 0) props.personas.splice(idx, 1)
}

async function onVoiceChange(persona: PersonaItem, voiceName: string) {
  const voice = props.voices.find(item => item.voice_name === voiceName)
  if (!voice) return
  await personasApi.update(persona.work_id, persona.id, { voice_id: voice.id })
  persona.voice_id = voice.id
}

// ═══════════════════════════════════════════
// 单个素材图片生成
// ═══════════════════════════════════════════

function openSingleGenerateConfirm() {
  if (!props.workId || !editingPersonaId.value || !addFormDescription.value.trim()) return

  const result = validateProps({
    textModel: props.textModel,
    model: props.model,
    modelResolution: props.modelResolution,
    styleId: props.styleId,
  }, [
    { key: 'textModel', message: '请先选择文本模型' },
    { key: 'model', message: '请先选择图片模型' },
    { key: 'modelResolution', message: '请先选择图片分辨率' },
    { key: 'styleId', message: '请先设置风格' },
  ])
  if (!result.valid) {
    showToast(result.message, 'info')
    return
  }
  showSingleGenerateConfirmModal.value = true
}

async function onAiGenerate() {
  if (!props.workId || !editingPersonaId.value || !addFormDescription.value.trim()) return

  const result = validateProps({
    textModel: props.textModel,
    model: props.model,
    modelResolution: props.modelResolution,
    styleId: props.styleId,
  }, [
    { key: 'textModel', message: '请先选择文本模型' },
    { key: 'model', message: '请先选择图片模型' },
    { key: 'modelResolution', message: '请先选择图片分辨率' },
    { key: 'styleId', message: '请先设置风格' },
  ])
  if (!result.valid) {
    showToast(result.message, 'info')
    return
  }

  generating.value = true
  showSingleGenerateConfirmModal.value = false
  try {
    await submitEditSilent()
    await personasApi.generateImage(props.workId, editingPersonaId.value, {
      textModel: props.textModel,
      aiModel: props.model,
      resolution: props.modelResolution,
    })
    refreshUser()
    await refreshAssets()
    syncEditingImages()
    pollGeneration()
  } catch (e: any) {
    showToast(e?.message || 'AI 生成图片失败', 'error')
  } finally {
    generating.value = false
  }
}

// ═══════════════════════════════════════════
// 图片任务轮询与生命周期
// ═══════════════════════════════════════════

let pollTimer: ReturnType<typeof setInterval> | null = null
let globalPollTimer: ReturnType<typeof setInterval> | null = null

function clearEditPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

function clearGlobalPoll() {
  if (globalPollTimer) clearInterval(globalPollTimer)
  globalPollTimer = null
}

/**
 * 编辑弹窗内的轮询只同步当前素材图片列表。
 * 当弹窗关闭、素材不存在或没有 running 图片时停止，避免页面离开后继续请求接口。
 */
function pollGeneration() {
  clearEditPoll()
  pollTimer = setInterval(async () => {
    if (!editingPersonaId.value || !showEditModal.value) return clearEditPoll()
    await refreshAssets()
    syncEditingImages()
    if (!addFormImages.value.some(image => image.job_status === 'running')) clearEditPoll()
  }, 3000)
}

/**
 * 全局轮询用于批量生成场景：只要任意素材还有 running 图片，就定时刷新整个素材列表。
 */
function autoPollIfRunning() {
  if (!hasRunningAssetImage(props.personas)) return clearGlobalPoll()
  if (globalPollTimer) return
  globalPollTimer = setInterval(async () => {
    await refreshAssets()
    if (!hasRunningAssetImage(props.personas)) clearGlobalPoll()
  }, 3000)
}

onMounted(registerGenerateAction)
onUnmounted(() => {
  invalidateDescriptionRequest()
  emit('register-action', null)
  clearEditPoll()
  clearGlobalPoll()
})
watch([
  selectingForGenerate,
  selectedCount,
  selectedGenerateCost,
  showBatchConfirmModal,
  batchGenerating,
  generating,
  showSingleGenerateConfirmModal,
  () => props.model,
  () => props.textModel,
  () => props.modelResolution,
  () => props.modelCost,
], registerGenerateAction)
watch(() => props.personas, () => autoPollIfRunning(), { deep: true, immediate: true })
</script>

<template>
  <!-- 故事素材主区域：顶部工具条控制分类/搜索，下面的网格只负责展示当前分类结果。 -->
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-6xl mx-auto p-6 space-y-6">
      <!-- 分类、搜索和批量选择状态入口。 -->
      <AssetsToolbar v-model:active-category="assetCategory" v-model:search="assetSearch"
        :categories="categorySummaries" :selecting="selectingForGenerate" :generating="batchGenerating"
        :selected-count="selectedCount" :current-category-label="currentCategoryLabel"
        @select-all="selectAllCurrentAssets" @cancel-select="cancelBatchSelect" @create="quickCreate(assetCategory)" />

      <!-- 当前分类素材列表。列表组件向上抛出编辑、删除、预览、配音和选择事件，真正副作用留在容器处理。 -->
      <AssetGrid :category="assetCategory" :items="currentAssets" :selected-ids="selectedAssetIds"
        :selecting="selectingForGenerate" :empty-text="currentEmptyText" :show-empty="!!normalizedAssetSearch"
        :voices="voices" :voice-options="voiceOptions" v-model:edit-name="editAssetName"
        :editing-name-id="editingAssetNameId" @toggle-select="toggleSelectAsset"
        @edit="openEditModal" @delete="deleteAsset" @start-rename="startEditAsset" @finish-rename="finishEditAsset"
        @cancel-rename="cancelEditAsset" @voice-change="onVoiceChange" />
    </div>

    <!-- 编辑弹窗：复用同一个表单承载角色、场景、道具，差异字段由 category 控制。 -->
    <AssetEditorModal :open="showEditModal" :title="editModalTitle" :category="editingAssetType"
      :category-label="editingCategoryLabel" :image-section-label="imageSectionLabel"
      :ai-generate-label="aiGenerateLabel" :image-tile-class="imageTileClass" :voices="voices"
      v-model:name="addFormName" v-model:gender="addFormGender" v-model:age="addFormAge"
      v-model:height="addFormHeight"
      v-model:voice-id="addFormVoiceId" v-model:description="addFormDescription"
      v-model:scene-interior="sceneFormInterior" v-model:scene-time="sceneFormTime"
      v-model:scene-location="sceneFormLocation" v-model:scene-mood="sceneFormMood"
      v-model:scene-key-events="sceneFormKeyEvents" v-model:cur-image-id="addFormCurImageId"
      :ref-image="addFormRefImage" :images="addFormImages" :uploading="uploading" :generating="generating"
      :generating-description="generatingDescription" :text-model="textModel" @generate-description="onGenerateDescription"
      v-bind="editorModelConfig"
      @close="closeEditModal" @submit="submitEdit" @request-generate-confirm="openSingleGenerateConfirm"
      @upload="onUpload" @remove-image="removeImage" />

  </div>
</template>

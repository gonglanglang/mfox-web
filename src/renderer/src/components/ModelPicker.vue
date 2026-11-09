<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { modelsApi, type ModelItem, type ModelContentType } from '@/api/models'
import AppModal from '@/components/AppModal.vue'
import { useModelPreferencesStore } from '@/stores/modelPreferences'

/**
 * 模型选择组件（下拉框）
 * modelType 支持单类型或多类型数组；多类型时显示 Tabs。
 * v-model 绑定选中的模型标识（ModelItem.model，程序调用 ID）
 * v-model:selected-models 在多类型模式下返回各类型的选中模型。
 *
 * 图片/视频的档位（分辨率）由模型自身的 price_config 提供：
 * label 用于显示、value 既随请求发给模型、也作为后端计费键，两者同源。
 */
const props = withDefaults(defineProps<{
  /** 模型类型：单个类型保持下拉模式，多个类型显示 Tabs。 */
  modelType: ModelContentType | ModelContentType[]
  /** 选中的模型标识（model 字段） */
  modelValue?: string
  /** 多类型模式下各类型的选中模型。 */
  selectedModels?: Partial<Record<ModelContentType, string>>
  /** 图片或视频的档位取值（来自模型 price_config） */
  resolution?: string
  /** 当前模型消耗积分，由组件根据模型与档位回传 */
  cost?: number
  /** 前缀标签 */
  label?: string
  /** 是否显示扣费确认弹窗。只在需要二次确认的生成流程中传入，普通模型选择不受影响。 */
  confirmOpen?: boolean
  /** 确认弹窗中的生成数量。 */
  confirmSelectedCount?: number
  /** 确认弹窗中的预计消耗积分。 */
  confirmCost?: number
  /** 确认弹窗展示的档位；不传时回退到当前选择器的档位。 */
  confirmResolution?: string
  /** 确认弹窗确认按钮 loading 状态。 */
  confirmGenerating?: boolean
  /** 确认弹窗标题，默认用于素材图片生成。 */
  confirmTitle?: string
}>(), {
  label: '',
  modelValue: '',
  selectedModels: () => ({}),
  resolution: '',
  cost: 0,
  confirmOpen: false,
  confirmSelectedCount: 0,
  confirmCost: 0,
  confirmResolution: '',
  confirmGenerating: false,
  confirmTitle: '确认素材生成',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedModels': [value: Partial<Record<ModelContentType, string>>]
  'update:resolution': [value: string]
  'update:cost': [value: number]
  'confirm-close': []
  'confirm-submit': []
}>()

const loading = ref(false)
const modelPreferences = useModelPreferencesStore()
const modelsByType = ref<Record<ModelContentType, ModelItem[]>>({ text: [], image: [], video: [], audio: [] })
const dropdownRef = ref<HTMLDetailsElement | null>(null)
const modelTypes = computed<ModelContentType[]>(() => {
  const values = Array.isArray(props.modelType) ? props.modelType : [props.modelType]
  return [...new Set(values)]
})
const multiType = computed(() => modelTypes.value.length > 1)
const activeType = ref<ModelContentType>(modelTypes.value[0] || 'text')
const models = computed(() => modelsByType.value[activeType.value] || [])

const typeLabels: Record<ModelContentType, string> = {
  text: '文本模型', image: '图片模型', video: '视频模型', audio: '语音模型',
}
const optionTypes: ModelContentType[] = ['image', 'video']

function selectedValue(type: ModelContentType) {
  return multiType.value ? props.selectedModels?.[type] || '' : props.modelValue || ''
}

// 竞态保护：快速切换类型时丢弃过期响应
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const responses = await Promise.all(modelTypes.value.map(async type => [type, await modelsApi.list(type)] as const))
    if (seq !== loadSeq) return // 已有更新的请求，丢弃本次结果
    const nextByType = { text: [], image: [], video: [], audio: [] } as Record<ModelContentType, ModelItem[]>
    responses.forEach(([type, items]) => { nextByType[type] = items || [] })
    modelsByType.value = nextByType

    if (multiType.value) {
      const selections = { ...props.selectedModels }
      modelTypes.value.forEach(type => {
        const options = nextByType[type]
        const currentValue = selections[type]
        const savedValue = modelPreferences.selectedModels[type]
        selections[type] = options.some(model => model.model === currentValue)
          ? currentValue
          : options.some(model => model.model === savedValue)
            ? savedValue
            : options[0]?.model || ''
        if (selections[type]) modelPreferences.setSelectedModel(type, selections[type]!)
      })
      emit('update:selectedModels', selections)
    } else {
      const type = modelTypes.value[0]
      const options = nextByType[type] || []
      const savedValue = modelPreferences.selectedModels[type]
      const value = options.some(model => model.model === props.modelValue)
        ? props.modelValue
        : options.some(model => model.model === savedValue)
          ? savedValue || ''
          : options[0]?.model || ''
      if (value !== props.modelValue) emit('update:modelValue', value)
      if (value) modelPreferences.setSelectedModel(type, value)
    }
  } catch (e) {
    if (seq === loadSeq) console.error('加载模型列表失败', e)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function onChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  modelPreferences.setSelectedModel(activeType.value, value)
  if (multiType.value) emit('update:selectedModels', { ...props.selectedModels, [activeType.value]: value })
  else emit('update:modelValue', value)
}

function onDocumentClick(e: MouseEvent) {
  const dropdown = dropdownRef.value
  if (!dropdown?.open) return
  const target = e.target as Node | null
  if (target && dropdown.contains(target)) return
  dropdown.open = false
}

onMounted(() => {
  load()
  document.addEventListener('click', onDocumentClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})
watch(() => props.modelType, () => {
  const types = modelTypes.value
  if (!types.includes(activeType.value)) activeType.value = types[0] || 'text'
  load()
}, { deep: true })
const selectedModel = computed(() => models.value.find(m => m.model === selectedValue(activeType.value)) || null)
const optionType = computed(() => modelTypes.value.find(type => optionTypes.includes(type)) || null)
const selectedOptionModel = computed(() => {
  const type = optionType.value
  return type ? modelsByType.value[type].find(model => model.model === selectedValue(type)) || null : null
})

interface TierOption {
  label: string
  value: string
  /** 该档位单价（积分）；0 表示不收费 */
  price: number
}

function getModelCost(model: ModelItem) {
  // 价格统一来自 price_config：先匹配当前档位，再回退「默认」档，最后用第一档
  const tiers = Array.isArray(model.price_config) ? model.price_config : []
  if (!tiers.length) return 0
  const matched = props.resolution
    ? tiers.find((tier) => tier?.value === props.resolution || tier?.label === props.resolution)
    : undefined
  const fallback = tiers.find((tier) => String(tier?.label ?? '').trim() === '默认') || tiers[0]
  const price = Number((matched || fallback)?.price)
  return Number.isFinite(price) && price >= 0 ? Math.floor(price) : 0
}

function formatModelDisplayName(model: ModelItem | null | undefined) {
  if (!model) return ''
  return model.provider_name ? `${model.provider_name} · ${model.name}` : model.name
}

function formatModelOption(model: ModelItem) {
  const cost = getModelCost(model)
  return `${formatModelDisplayName(model)}${cost ? `（${cost}积分）` : ''}`
}

/** 档位选项：来自当前模型的 price_config（label 显示、value 提交并用于计费） */
const resolutionOptions = computed<TierOption[]>(() => {
  const tiers = selectedOptionModel.value?.price_config
  if (!Array.isArray(tiers)) return []
  return tiers.flatMap((tier) => {
    const label = String(tier?.label || '').trim()
    const value = String(tier?.value ?? '').trim()
    // 「默认」档是固定价（不选档位时生效），不作为可选项展示
    if (!label || !value || label === '默认') return []
    const price = Number(tier?.price)
    return [{ label, value, price: Number.isFinite(price) && price >= 0 ? Math.floor(price) : 0 }]
  })
})

/** 档位显示文案：带积分单价，方便在下拉里直接对比各档位 */
function formatTier(option: TierOption) {
  return option.price > 0 ? `${option.label}（${option.price}积分）` : option.label
}
const hasOptionConfig = computed(() => resolutionOptions.value.length > 0)
const showGenerationOptions = computed(() =>
  activeType.value === optionType.value && resolutionOptions.value.length > 0,
)

// 模型或档位清单变化时，把档位校正到当前模型支持的值，并持久化该模型的偏好
watch([selectedOptionModel, resolutionOptions, () => props.resolution], () => {
  if (!optionType.value) {
    if (props.resolution) emit('update:resolution', '')
    return
  }
  const optionModel = selectedOptionModel.value
  if (!optionModel) return

  const saved = modelPreferences.modelOptions[optionModel.model]
  const options = resolutionOptions.value
  const resolution = options.some(option => option.value === props.resolution)
    ? props.resolution
    : options.some(option => option.value === saved?.resolution)
      ? saved.resolution
      : options[0]?.value || ''

  if (resolution !== props.resolution) emit('update:resolution', resolution)
  modelPreferences.setModelOptions(optionModel.model, resolution)
}, { immediate: true, deep: true })

watch([modelTypes, () => props.modelValue, () => props.selectedModels], () => {
  modelTypes.value.forEach(type => {
    const value = selectedValue(type)
    if (value) modelPreferences.setSelectedModel(type, value)
  })
}, { deep: true })

const nameTemplate = computed(() => {
  return multiType.value ? '模型配置' : typeLabels[activeType.value]
})
const selectedModelName = computed(() => formatModelDisplayName(selectedModel.value))
const modelCount = computed(() => models.value.length)
const selectedModelsForConfirmation = computed(() => modelTypes.value.flatMap(type => {
  const model = modelsByType.value[type].find(item => item.model === selectedValue(type))
  return model ? [{ type, model, cost: getModelCost(model) }] : []
}))
const selectedModelCost = computed(() =>
  selectedModelsForConfirmation.value.reduce((total, item) => total + item.cost, 0),
)
const selectedResolutionLabel = computed(() =>
  resolutionOptions.value.find(option => option.value === props.resolution)?.label || props.resolution,
)
const pickerSummary = computed(() => {
  if (loading.value) return '加载中'
  if (multiType.value) {
    const selectedCount = selectedModelsForConfirmation.value.length
    return selectedCount ? `已配置 ${selectedCount} 个模型` : nameTemplate.value
  }
  if (!props.modelValue) return nameTemplate.value
  if (activeType.value !== optionType.value) return selectedModelName.value || props.modelValue
  return [selectedModelName.value || props.modelValue, selectedResolutionLabel.value]
    .filter(Boolean)
    .join(' / ')
})
const confirmResolutionText = computed(() => {
  const value = props.confirmResolution || props.resolution
  if (!value) return '未选择'
  return resolutionOptions.value.find(option => option.value === value)?.label || value
})

function closePicker() {
  if (dropdownRef.value) dropdownRef.value.open = false
}

watch([selectedModelCost, () => props.resolution, () => props.selectedModels], () => {
  emit('update:cost', selectedModelCost.value)
}, { immediate: true, deep: true })

function onResolutionChange(e: Event) {
  const resolution = (e.target as HTMLSelectElement).value
  emit('update:resolution', resolution)
  if (selectedOptionModel.value) {
    modelPreferences.setModelOptions(selectedOptionModel.value.model, resolution)
  }
}
</script>

<template>
  <!-- 模型选择下拉：普通页面只使用这一部分。 -->
  <details ref="dropdownRef" class="dropdown dropdown-end w-full">
    <summary class="btn btn-sm btn-outline w-full min-w-0 justify-between gap-2 px-3"
      :class="loading ? 'btn-disabled' : ''" :title="pickerSummary">
      <span class="iconfont icon-a-zhinengti text-xs shrink-0"></span>
      <span class="truncate text-left flex-1">{{ pickerSummary }}</span>
      <span v-if="modelCount" class="badge badge-xs badge-primary shrink-0">{{ modelCount }}</span>
      <svg class="w-3.5 h-3.5 shrink-0 opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
          clip-rule="evenodd" />
      </svg>
    </summary>

    <div class="dropdown-content z-50 mt-2 w-80 rounded-lg border bg-base-100 p-3 shadow-xl">
      <div class="mb-2 flex items-center justify-between gap-3">
        <span class="text-xs font-semibold text-base-content/70">{{ label || nameTemplate }}</span>
        <button class="btn btn-ghost btn-xs btn-square" type="button" title="关闭" @click="closePicker">✕</button>
      </div>

      <div class="space-y-3">
        <div v-if="multiType" role="tablist" class="tabs tabs-box tabs-sm grid"
          :style="{ gridTemplateColumns: `repeat(${modelTypes.length}, minmax(0, 1fr))` }">
          <button v-for="type in modelTypes" :key="type" type="button" role="tab" class="tab min-w-0"
            :class="activeType === type ? 'tab-active' : ''" @click="activeType = type">
            {{ typeLabels[type] }}
          </button>
        </div>

        <label class="form-control w-full">
          <div class="label py-1">
            <span class="label-text text-xs">模型</span>
          </div>
          <select class="select select-bordered select-sm w-full" :value="selectedValue(activeType)" :disabled="loading"
            @change="onChange">
            <option value="" disabled>
              {{ loading ? '加载中...' : `请选择${nameTemplate}` }}
            </option>
            <option v-for="m in models" :key="m.id" :value="m.model">
              {{ formatModelOption(m) }}
            </option>
          </select>
        </label>

        <label v-if="showGenerationOptions" class="form-control w-full">
          <div class="label py-1">
            <span class="label-text text-xs">分辨率</span>
          </div>
          <select class="select select-bordered select-sm w-full" :value="resolution" :disabled="loading"
            @change="onResolutionChange">
            <option v-for="option in resolutionOptions" :key="option.value" :value="option.value">
              {{ formatTier(option) }}
            </option>
          </select>
        </label>
      </div>
    </div>
  </details>

  <!-- 生成扣费确认：由需要扣积分的业务流程传入数据，统一放在模型选择组件里展示。 -->
  <AppModal :open="confirmOpen" @close="emit('confirm-close')">
    <div class="modal-box w-full max-w-md rounded-2xl" @click.stop>
      <button class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4" @click="emit('confirm-close')">✕</button>
      <h3 class="font-bold text-lg mb-4">{{ confirmTitle }}</h3>
      <div class="space-y-3 text-sm">
        <div class="flex justify-between gap-4">
          <span class="text-base-content/60">生成数量</span>
          <span class="font-semibold">{{ confirmSelectedCount }} {{ modelTypes.length === 1 && modelTypes[0] === 'video' ? '段' : '张' }}</span>
        </div>
        <div v-for="item in selectedModelsForConfirmation" :key="item.type" class="flex justify-between gap-4">
          <span class="text-base-content/60">{{ typeLabels[item.type] }}</span>
          <span class="font-semibold text-right">{{ formatModelDisplayName(item.model) }}</span>
        </div>
        <div v-if="optionType && hasOptionConfig" class="flex justify-between gap-4">
          <span class="text-base-content/60">分辨率</span>
          <span class="font-semibold">{{ confirmResolutionText }}</span>
        </div>
        <div class="flex justify-between gap-4 border-t border-base-200 pt-3">
          <span class="text-base-content/60">本次消耗</span>
          <span class="font-bold text-primary">{{ confirmCost }} 积分</span>
        </div>
      </div>
      <div class="modal-action">
        <button class="btn btn-ghost" @click="emit('confirm-close')">取消</button>
        <button class="btn btn-primary" :disabled="confirmGenerating" @click="emit('confirm-submit')">
          <span v-if="confirmGenerating" class="loading loading-spinner loading-xs"></span>
          确认生成
        </button>
      </div>
    </div>
  </AppModal>
</template>

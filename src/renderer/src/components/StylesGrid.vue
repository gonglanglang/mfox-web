<script setup lang="ts">
/**
 * 画风网格：列表 + 新建自定义画风 + 删除自定义画风。
 * 画风列表 = 官方内置 + 当前用户自定义。
 *
 * 加载方式：
 * - 未传 items：组件自行加载（宽表单内联使用，如 StylePicker）；
 * - 传入 items：由父级负责加载（弹层里用父级的同一份列表，摘要与网格保持一致），
 *   创建/删除后通过 changed 事件通知父级重新加载。
 */
import { computed, onMounted, ref } from 'vue'
import { visualStylesApi, type VisualStyleItem } from '@/api/visual-styles'
import { uploadImageToOSS } from '@/api/oss'
import { useToast } from '@/composables/useToast'

const props = withDefaults(defineProps<{
  /** 当前选中的画风 ID */
  modelValue: number | null
  /** 网格列数 */
  columns?: number
  /** 是否允许创建/删除自定义画风 */
  allowCustom?: boolean
  /** 受控列表；不传则组件自行加载 */
  items?: VisualStyleItem[]
}>(), { columns: 3, allowCustom: true })

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
  /** 列表发生变化（创建/删除后），供父级重新加载自己的副本 */
  changed: []
}>()

const { show: showToast } = useToast()

const loaded = ref<VisualStyleItem[]>([])
const loadingStyles = ref(false)
const controlled = computed(() => props.items !== undefined)
const visualStyles = computed(() =>
  [...(controlled.value ? props.items || [] : loaded.value)].sort((a, b) => a.sort_order - b.sort_order))
const gridStyle = computed(() => ({ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }))

async function load() {
  loadingStyles.value = true
  try {
    loaded.value = await visualStylesApi.list()
  } catch (e: any) {
    showToast(e.message || '加载画风失败', 'error')
  } finally {
    loadingStyles.value = false
  }
}

onMounted(() => { if (!controlled.value) void load() })

function select(styleId: number) {
  emit('update:modelValue', styleId)
}

/** 列表变化后：受控模式交回父级刷新，否则自己重新加载。 */
function afterChange() {
  if (controlled.value) emit('changed')
  else void load()
}

// ── 自定义画风：上传参考图 + 风格描述 ──
const creating = ref(false)
const saving = ref(false)
const uploading = ref(false)
const form = ref({ name: '', description: '', effect_image: '' })
const fileInput = ref<HTMLInputElement | null>(null)

function openForm() {
  form.value = { name: '', description: '', effect_image: '' }
  creating.value = true
}

function closeForm() {
  creating.value = false
  form.value = { name: '', description: '', effect_image: '' }
}

function pickImage() {
  fileInput.value?.click()
}

async function onImageChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许连续选择同一文件
  if (!file) return
  uploading.value = true
  try {
    form.value.effect_image = await uploadImageToOSS(file)
  } catch (e: any) {
    showToast(e.message || '风格参考图上传失败', 'error')
  } finally {
    uploading.value = false
  }
}

async function save() {
  if (saving.value || uploading.value) return
  const name = form.value.name.trim()
  const description = form.value.description.trim()
  if (!name) return showToast('请填写画风名称', 'info')
  if (!description) return showToast('请填写风格描述', 'info')
  if (!form.value.effect_image) return showToast('请上传风格参考图', 'info')
  saving.value = true
  try {
    const { style_id } = await visualStylesApi.create({ name, description, effect_image: form.value.effect_image })
    afterChange()
    emit('update:modelValue', style_id) // 新建后直接选中
    closeForm()
    showToast('自定义画风已创建并选中', 'success')
  } catch (e: any) {
    showToast(e.message || '创建自定义画风失败', 'error')
  } finally {
    saving.value = false
  }
}

async function removeStyle(style: VisualStyleItem) {
  if (!window.confirm(`确定删除自定义画风「${style.name}」吗？`)) return
  try {
    await visualStylesApi.remove(style.style_id)
    if (props.modelValue === style.style_id) emit('update:modelValue', null)
    afterChange()
    showToast('已删除该画风', 'success')
  } catch (e: any) {
    showToast(e.message || '删除画风失败', 'error')
  }
}
</script>

<template>
  <div>
    <div v-if="loadingStyles" class="flex items-center justify-center py-10 text-sm text-base-content/40">
      <span class="loading loading-spinner loading-sm mr-2"></span>画风加载中…
    </div>
    <template v-else>
      <div class="grid gap-3 mt-2" :style="gridStyle">
        <div v-for="style in visualStyles" :key="style.style_id"
          class="card relative bg-base-100 border-2 cursor-pointer transition-all hover:shadow-md overflow-hidden"
          style="content-visibility: auto; contain-intrinsic-size: 160px;"
          :class="modelValue === style.style_id ? 'border-primary shadow-md ring-2 ring-primary/20' : 'border-base-200 hover:border-base-300'"
          @click="select(style.style_id)">
          <figure class="h-20 overflow-hidden bg-base-200">
            <img :src="style.effect_image" class="w-full h-full object-cover" loading="lazy" decoding="async" />
          </figure>
          <div class="card-body p-2 gap-0">
            <h4 class="card-title text-xs truncate">{{ style.name }}</h4>
          </div>
          <button v-if="allowCustom && style.type === 'custom'"
            class="absolute top-1 right-1 z-10 btn btn-xs btn-circle btn-error opacity-0 hover:opacity-100 transition-opacity tooltip tooltip-left"
            data-tip="删除该自定义画风" @click.stop="removeStyle(style)">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 新建自定义画风 -->
        <button v-if="allowCustom && !creating"
          class="card border-2 border-dashed border-base-300 bg-base-200/30 hover:border-primary hover:bg-primary/5 transition-colors min-h-28 items-center justify-center"
          @click="openForm">
          <div class="text-center text-base-content/40">
            <svg class="w-5 h-5 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span class="text-[11px] font-medium">自定义画风</span>
          </div>
        </button>
      </div>

      <div v-if="visualStyles.length === 0 && !creating"
        class="flex items-center justify-center py-6 text-sm text-base-content/40">暂无画风可选</div>

      <!-- 自定义画风表单：名称 + 风格描述 + 参考图 -->
      <div v-if="creating" class="mt-3 p-3 rounded-xl border border-base-300 bg-base-200/30 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold">新建自定义画风</span>
          <button class="btn btn-ghost btn-xs" :disabled="saving" @click="closeForm">取消</button>
        </div>
        <input v-model="form.name" class="input input-bordered input-sm w-full text-xs rounded-lg" maxlength="30"
          placeholder="画风名称，如「水墨赛璐璐」" />
        <textarea v-model="form.description" rows="3" maxlength="600"
          class="textarea textarea-bordered textarea-sm w-full text-xs leading-relaxed rounded-lg"
          placeholder="风格描述，如：整体为低饱和水墨质感，细线稿、淡墨晕染、留白构图，光色克制"></textarea>
        <div class="flex items-center gap-2">
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onImageChange" />
          <button class="btn btn-ghost btn-xs border border-base-300" :disabled="uploading" @click="pickImage">
            {{ uploading ? '上传中…' : (form.effect_image ? '更换参考图' : '上传风格参考图') }}
          </button>
          <img v-if="form.effect_image" :src="form.effect_image" alt="风格参考图"
            class="w-16 h-9 object-cover rounded border border-base-300" />
          <button class="btn btn-primary btn-xs ml-auto" :disabled="saving || uploading" @click="save">
            {{ saving ? '保存中…' : '创建并选中' }}
          </button>
        </div>
        <p class="text-[10px] text-base-content/40 leading-snug">参考图会作为风格参考（style reference）随分镜出图一并传给模型；描述会写入所有帧提示词的【画风】段。</p>
      </div>
    </template>
  </div>
</template>

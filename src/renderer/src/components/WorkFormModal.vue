<script setup lang="ts">
/**
 * 作品创建 / 编辑 合并弹窗（daisyUI）
 * mode="create"：标题 + 题材 + 篇幅长短 + 目标读者/视角 + 封面(上传) + 简介 + 画风
 * mode="edit" ：同上（不含封面，改封面走独立的「设置封面」入口）
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { worksApi } from '@/api/works'
import { genresApi } from '@/api/genres'
import StylePicker from '@/components/StylePicker.vue'
import AppModal from '@/components/AppModal.vue'
import { useToast } from '@/composables/useToast'
import { getAuthHeaders } from '@/composables/useAuth'
import { ASPECT_RATIOS, ASPECT_RATIO_HINTS, AUDIENCES, DEFAULT_ASPECT_RATIO, POVS } from '@/config/constants'
import type { AspectRatio, Audience, Pov, WorkType } from '@/config/constants'

const props = defineProps<{
  /** 弹窗是否打开 */
  open: boolean
  /** create=创建 / edit=编辑 */
  mode: 'create' | 'edit'
  /** edit 模式：目标作品 ID */
  workId?: number
}>()

const emit = defineEmits<{
  close: []
  /** 保存成功（父级刷新列表） */
  saved: []
}>()

const { show: showToast } = useToast()
const isEdit = computed(() => props.mode === 'edit')

// ── 题材（挂载时加载一次；画风由 StylePicker 组件内部加载） ──
const genres = ref<string[]>([])
const loadingGenres = ref(false)
async function loadGenres() {
  if (genres.value.length || loadingGenres.value) return
  loadingGenres.value = true
  try {
    const list = await genresApi.list()
    genres.value = (list || []).map(g => g.name)
  } catch {
    // 题材加载失败时静默降级
  } finally {
    loadingGenres.value = false
  }
}

// ── 表单 ──
const LENGTHS: readonly WorkType[] = ['长篇', '短篇']
interface WorkFormData {
  title: string
  type: WorkType
  genre: string
  audience: Audience
  pov: Pov
  description: string
  style_id: number | null
  /** 视口宽高比：只定画面比例，分辨率由所选模型决定 */
  aspect_ratio: AspectRatio
}
const DEFAULT_FORM: WorkFormData = {
  title: '',
  type: '长篇',
  genre: '',
  audience: '全频',
  pov: '第一人称',
  description: '',
  style_id: null,
  aspect_ratio: DEFAULT_ASPECT_RATIO,
}
const form = reactive<WorkFormData>({ ...DEFAULT_FORM })
const saving = ref(false)
/** edit 模式：拉取作品详情中 */
const fetching = ref(false)

function resetForm() {
  Object.assign(form, DEFAULT_FORM)
  clearCover()
}

// ── 封面（仅 create 模式） ──
const coverFile = ref<File | null>(null)
const coverPreview = ref('')
const uploadingCover = ref(false)
const coverInputRef = ref<HTMLInputElement | null>(null)

function onCoverFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  coverFile.value = file
  coverPreview.value = URL.createObjectURL(file)
}

function clearCover() {
  coverFile.value = null
  coverPreview.value = ''
  if (coverInputRef.value) coverInputRef.value.value = ''
}

async function uploadCover(): Promise<string | null> {
  if (!coverFile.value) return null
  uploadingCover.value = true
  try {
    const formData = new FormData()
    formData.append('file', coverFile.value)
    formData.append('bucket', 'cover')
    const base = import.meta.env.VITE_API_BASE_URL || '/api'
    const res = await fetch(`${base}/oss/file`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
      body: formData,
    })
    const json = await res.json()
    if (json.code === 0 || json.code === 200) {
      return json.data.url as string
    }
    throw new Error(json.message || '上传失败')
  } catch (err: any) {
    console.error('Cover upload error:', err)
    showToast(err.message || '封面上传失败', 'error')
    return null
  } finally {
    uploadingCover.value = false
  }
}

// ── 打开时初始化表单数据（显隐由 AppModal 原生 dialog 管理） ──
watch(() => props.open, async (v) => {
  if (!v) return
  // 内容初始化（编辑拉取详情 / 创建重置）
  if (props.mode === 'edit') {
    if (!props.workId) return
    fetching.value = true
    try {
      const detail = await worksApi.detail(props.workId)
      Object.assign(form, {
        title: detail.title,
        description: detail.description || '',
        type: (['长篇', '短篇'].includes(detail.type) ? detail.type : '长篇'),
        genre: detail.genre || '',
        audience: detail.audience,
        pov: detail.pov,
        style_id: (detail as any).style_id || null,
        // 旧数据没有该字段时回落到默认比例
        aspect_ratio: (ASPECT_RATIOS as readonly string[]).includes(detail.aspect_ratio)
          ? detail.aspect_ratio as AspectRatio
          : DEFAULT_ASPECT_RATIO,
      })
    } catch (e: any) {
      showToast(e.message || '获取作品信息失败', 'error')
      emit('close')
    } finally {
      fetching.value = false
    }
  } else {
    resetForm()
  }
  await loadGenres()
}, { immediate: true })

// ── 提交 ──
async function handleSubmit() {
  if (saving.value) return
  if (!form.title.trim()) {
    showToast('请输入作品标题', 'error')
    return
  }
  if (!form.genre) {
    showToast('请选择题材', 'error')
    return
  }
  if (form.style_id === null) {
    showToast('请选择画风', 'error')
    return
  }
  saving.value = true
  try {
    if (props.mode === 'create') {
      let cover_url = ''
      if (coverFile.value) {
        const url = await uploadCover()
        if (url) cover_url = url
      }
      await worksApi.create({
        title: form.title.trim(),
        description: form.description,
        type: form.type,
        audience: form.audience,
        pov: form.pov,
        genre: form.genre,
        style_id: form.style_id,
        aspect_ratio: form.aspect_ratio,
        cover_url,
        content: '',
      })
      showToast('创建成功')
    } else {
      if (!props.workId) return
      await worksApi.update(props.workId, {
        title: form.title.trim(),
        description: form.description,
        type: form.type,
        genre: form.genre,
        audience: form.audience,
        pov: form.pov,
        style_id: form.style_id,
        aspect_ratio: form.aspect_ratio,
      })
      showToast('保存成功')
    }
    emit('saved')
    emit('close')
    resetForm()
  } catch (err: any) {
    console.error('保存作品失败:', err.message)
    showToast(err.message || '保存失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

function close() {
  if (saving.value) return
  emit('close')
}
</script>

<template>
  <AppModal :open="open" @close="close">
    <div class="modal-box w-[90vw] max-w-6xl rounded-2xl p-0 overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-base-200">
          <h3 class="text-lg font-bold text-base-content">{{ isEdit ? '编辑作品' : '创建作品' }}</h3>
          <button class="btn btn-sm btn-ghost btn-circle" @click="close" :disabled="saving">
            <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div v-if="fetching" class="flex items-center justify-center py-20">
          <span class="loading loading-spinner loading-lg text-[#6C5CE7]"></span>
        </div>
        <div v-else class="flex gap-0 divide-x divide-base-200">
          <!-- 左侧：表单 -->
          <div class="flex-1 px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
            <!-- 作品标题 -->
            <div class="form-control">
              <label class="label pb-1.5"><span class="label-text font-semibold text-sm">作品标题 <span
                    class="text-error">*</span></span></label>
              <input v-model="form.title" type="text" placeholder="给你的作品起个响亮的名字…"
                class="input input-bordered w-full rounded-xl focus:border-[#6C5CE7] focus:ring-1 focus:ring-[#6C5CE7]/20 transition-all" />
            </div>

            <!-- 题材 -->
            <div class="form-control">
              <label class="label pb-1.5"><span class="label-text font-semibold text-sm">题材 <span
                    class="text-error">*</span></span></label>
              <div v-if="loadingGenres" class="flex items-center gap-2 text-xs text-base-content/40 py-1.5">
                <span class="loading loading-spinner loading-xs"></span>题材加载中…
              </div>
              <div v-else-if="genres.length" class="flex flex-wrap gap-2 items-center">
                <button v-for="g in genres" :key="g"
                  class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  :class="form.genre === g
                    ? 'border border-primary/30 bg-primary/10 text-primary'
                    : 'border border-base-200 bg-base-100 text-base-content/60 hover:border-primary/30 hover:text-primary'"
                  @click="form.genre = g">{{ g }}</button>
              </div>
              <span v-else class="text-xs text-base-content/30 py-1.5">暂无题材</span>
            </div>

            <!-- 频道 / 视角 / 篇幅长短（daisyUI tabs-box radio 三组，name 各自唯一） -->
            <div class="flex flex-col items-start md:flex-row gap-3 pt-2 flex-wrap">
              <div class="tabs tabs-box">
                <input v-for="a in AUDIENCES" :key="a" type="radio" name="form_channel_tabs" class="tab"
                  :aria-label="a" :checked="form.audience === a" @change="form.audience = a" />
              </div>
              <div class="tabs tabs-box">
                <input v-for="p in POVS" :key="p" type="radio" name="form_pov_tabs" class="tab"
                  :aria-label="p" :checked="form.pov === p" @change="form.pov = p" />
              </div>
              <div class="tabs tabs-box">
                <input v-for="o in LENGTHS" :key="o" type="radio" name="form_length_tabs" class="tab"
                  :aria-label="o === '长篇' ? '长篇' : '短篇'" :checked="form.type === o"
                  @change="form.type = o" />
              </div>
            </div>

            <!-- 视口宽高比（作品级）：只定画面比例，分辨率由所选模型决定 -->
            <div class="form-control">
              <label class="label pb-1.5">
                <span class="label-text font-semibold text-sm">视口比例
                  <span class="text-base-content/30 text-xs font-normal ml-1">（默认 16:9；分辨率由所选模型决定）</span>
                </span>
              </label>
              <div class="flex flex-wrap gap-2 items-center">
                <button v-for="r in ASPECT_RATIOS" :key="r"
                  class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
                  :class="form.aspect_ratio === r
                    ? 'border border-primary/30 bg-primary/10 text-primary'
                    : 'border border-base-200 bg-base-100 text-base-content/60 hover:border-primary/30 hover:text-primary'"
                  @click="form.aspect_ratio = r">
                  <span>{{ r }}</span>
                  <span class="text-xs opacity-60">{{ ASPECT_RATIO_HINTS[r] }}</span>
                </button>
              </div>
            </div>

            <!-- 封面（仅创建） -->
            <div v-if="!isEdit" class="form-control">
              <label class="label pb-1.5"><span class="label-text font-semibold text-sm">作品封面 <span
                    class="text-base-content/30 text-xs font-normal ml-1">（选填）</span></span></label>
              <div v-if="!coverPreview"
                class="w-full border-2 border-dashed border-base-300 rounded-xl p-6 flex flex-col items-center justify-center hover:border-[#6C5CE7] hover:bg-[#6C5CE7]/5 transition-all cursor-pointer gap-2"
                @click="coverInputRef?.click()">
                <svg xmlns="http://www.w3.org/2000/svg" class="size-8 text-base-content/20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span class="text-sm text-base-content/40">点击上传封面图</span>
                <span class="text-xs text-base-content/20">支持 JPG / PNG / WebP，建议 3:4 比例</span>
              </div>
              <div v-else class="flex justify-center">
                <div class="relative inline-flex">
                  <img :src="coverPreview" alt="封面预览"
                    class="h-40 object-cover rounded-xl border border-base-200 shadow-sm" />
                  <button
                    class="btn btn-xs btn-circle btn-ghost bg-base-100/80 hover:bg-error hover:text-white absolute -top-1.5 -right-1.5 shadow"
                    @click="clearCover" :disabled="saving">
                    <svg xmlns="http://www.w3.org/2000/svg" class="size-2.5" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              <input ref="coverInputRef" type="file" accept="image/jpeg,image/png,image/webp" class="hidden"
                @change="onCoverFileChange" />
              <span v-if="uploadingCover" class="text-xs text-[#6C5CE7] mt-1.5 flex items-center gap-1"><span
                  class="loading loading-spinner loading-xs"></span> 上传中…</span>
            </div>

            <!-- 作品简介 -->
            <div class="form-control">
              <label class="label pb-1.5"><span class="label-text font-semibold text-sm">作品简介</span></label>
              <textarea v-model="form.description"
                placeholder="简单介绍一下你的作品主题、故事梗概、创作灵感…" rows="5"
                class="textarea textarea-bordered w-full rounded-xl focus:border-[#6C5CE7] focus:ring-1 focus:ring-[#6C5CE7]/20 transition-all resize-none text-sm" />
            </div>
          </div>

          <!-- 右侧：画风选择（独立组件 StylePicker，必选） -->
          <div class="w-[480px] shrink-0 px-4 py-5 max-h-[60vh] overflow-y-auto">
            <StylePicker v-model="form.style_id" />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-base-200 bg-base-200/30">
          <button class="btn btn-ghost rounded-xl" @click="close" :disabled="saving">取消</button>
          <button
            class="btn bg-[#6C5CE7] hover:bg-[#5B4BC4] text-white border-none rounded-xl shadow-lg shadow-[#6C5CE7]/20"
            :disabled="saving || fetching" @click="handleSubmit">
            <span v-if="saving" class="loading loading-spinner loading-xs"></span>
            <span>{{ saving ? (isEdit ? '保存中…' : '创建中…') : (isEdit ? '保存修改' : '立即创建') }}</span>
          </button>
        </div>
      </div>
    </AppModal>
</template>

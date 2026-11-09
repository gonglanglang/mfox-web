import type { ImageAsset, PersonaItem, SceneDetail } from '@/api/personas'
import { ASSET_CATEGORY_OPTIONS, UNKNOWN_ASSET_LABEL } from '@/constants/assets'
import type { AssetCategory, SceneDetailForm } from '@/types/assets'

/**
 * 数字千分位格式化。
 * @param value 数值（支持数字/数字字符串/null/undefined）
 * @example
 * formatNumber(1500)        // "1,500"
 * formatNumber(1234567)     // "1,234,567"
 * formatNumber(68000)       // "68,000"
 * formatNumber('abc')       // "0"
 */
export function formatNumber(value: number | string | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('zh-CN')
}

/**
 * 根据后端素材类型获取中文标签。
 * 提取原因：列表、弹窗标题、搜索索引都会用到同一套标签，集中后避免文案不一致。
 */
export function getAssetLabel(type: AssetCategory): string {
  return ASSET_CATEGORY_OPTIONS.find(cat => cat.key === type)?.label || UNKNOWN_ASSET_LABEL
}

/**
 * 获取素材当前用于展示的大图。
 * 边界：cur_image_id 可能指向已删除图片，因此找不到时回退到第一张图，保持旧展示行为。
 */
export function getSelectedAssetImage(persona: PersonaItem): ImageAsset | null {
  if (!persona.images?.length) return null
  if (persona.cur_image_id) {
    const found = persona.images.find(image => image.id === persona.cur_image_id)
    if (found) return found
  }
  return persona.images[0]
}

/**
 * 构造上传图片在前端临时使用的 ImageAsset。
 * 上传图不走 AI 任务，因此 job_status 固定为 ready，后端保存时沿用这个结构。
 */
export function createUploadedImageAsset(url: string): ImageAsset {
  return {
    job_id: 0,
    job_status: 'ready',
    edit_job_id: 0,
    edit_job_status: 'ready',
    id: Date.now().toString(),
    url,
    type: 'upload',
    parent_image_id: null,
    prompt: '',
    ref_images: [],
  }
}

/**
 * 构建素材搜索文本。
 * 搜索需要覆盖名称、描述和场景 detail 字段，否则用户输入“深夜/城中村”等场景信息时找不到素材。
 */
export function buildAssetSearchText(item: PersonaItem): string {
  return [
    item.name,
    item.description,
    item.gender,
    item.age,
    getAssetLabel(item.source_type),
    item.detail?.title,
    item.detail?.time,
    item.detail?.location,
    item.detail?.description,
    item.detail?.mood,
    item.detail?.key_events,
  ].filter(Boolean).join(' ').toLowerCase()
}

/** 判断素材列表里是否还有图片生成任务运行中，用于决定是否继续轮询。 */
export function hasRunningAssetImage(personas: PersonaItem[]): boolean {
  return personas.some(persona => (persona.images || []).some(image => image.job_status === 'running'))
}

/**
 * 把场景编辑表单合并回 detail。
 * 这里保留 previous 里的其他字段，例如 characters / unresolved_characters，避免编辑基础信息时覆盖 AI 提取结果。
 */
export function buildSceneDetailFromForm(form: SceneDetailForm): SceneDetail {
  const previous = form.previous || {}
  const detail: SceneDetail = {
    ...previous,
    title: form.name.trim() || previous.title,
    description: form.description || previous.description,
  }
  if (form.time.trim()) detail.time = form.time.trim()
  else delete detail.time
  if (form.location.trim()) detail.location = form.location.trim()
  else delete detail.location
  if (form.interior === 'indoor') detail.interior = true
  else if (form.interior === 'outdoor') detail.interior = false
  else delete detail.interior
  if (form.mood.trim()) detail.mood = form.mood.trim()
  else delete detail.mood
  if (form.keyEvents.trim()) detail.key_events = form.keyEvents.trim()
  else delete detail.key_events
  return detail
}

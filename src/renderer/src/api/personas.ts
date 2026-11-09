import { get, post, put, del } from './request'

// ============================================
// Types
// ============================================
export interface PersonaItem {
  id: number
  work_id: number
  chapters_id: number
  user_id: number
  voice_id: number | null
  name: string
  source_type: 'persona' | 'scene' | 'prop'
  gender: 'male' | 'female' | 'unknown'
  age: string
  /** 身高（厘米）；null 表示未填 */
  height?: number | null
  images: ImageAsset[]
  images_history: ImageAsset[]
  ref_images: ImageAsset[]
  description: string | null
  detail?: SceneDetail | null
  cur_image_id: string | null
  createdAt: string
  updatedAt: string
}

/** 场景素材结构化信息（personas.detail，来自 SceneExtractAgent 输出） */
export interface SceneDetail {
  /** 场景序号 */
  id?: number
  /** 场景标题 */
  title?: string
  /** 时间描述（如"清晨"/"深夜"） */
  time?: string
  /** 地点名称 */
  location?: string
  /** 室内 / 室外 */
  interior?: boolean
  /** 出场角色数据库 ID */
  characters?: number[]
  unresolved_characters?: unknown[]
  /** 场景环境描写 */
  description?: string
  /** 情绪氛围（如"紧张"/"温馨"） */
  mood?: string
  /** 关键事件摘要 */
  key_events?: string
}

export interface ImageAsset {
  id: string
  url: string
  type: string
  job_id: number
  job_status: string
  edit_job_id: number
  edit_job_status: string
  prompt: string
  parent_image_id: string | null
  ref_images: any[]
}

export interface CreatePersonaParams {
  chapters_id: number
  name: string
  source_type?: 'persona' | 'scene' | 'prop'
  gender?: 'male' | 'female' | 'unknown'
  age?: string
  /** 身高（厘米） */
  height?: number | null
  images?: ImageAsset[]
  images_history?: ImageAsset[]
  ref_images?: ImageAsset[]
  description?: string
  voice_id?: number | null
  detail?: SceneDetail | null
}

export interface UpdatePersonaParams {
  name?: string
  source_type?: 'persona' | 'scene' | 'prop'
  gender?: 'male' | 'female' | 'unknown'
  age?: string
  /** 身高（厘米） */
  height?: number | null
  images?: ImageAsset[]
  images_history?: ImageAsset[]
  ref_images?: ImageAsset[]
  description?: string
  chapters_id?: number
  voice_id?: number | null
  cur_image_id?: string | null
  style_id?: number | null
  detail?: SceneDetail | null
}

// ============================================
// Personas APIs
// ============================================
export const personasApi = {
  /** 根据当前表单和角色所属章节生成描述草稿（含结构化身高），不自动保存。 */
  generateDescription(workId: number, personaId: number, data: {
    textModel: string; name: string; gender: 'male' | 'female' | 'unknown'; age: string; description: string
  }) {
    return post<{ description: string; heightCm: number | null }>(`/works/${workId}/personas/${personaId}/generate-description`, data, { timeout: 120000 })
  },

  /** 获取素材列表（按作品，可选过滤章节/类型） */
  list(workId: number, params?: { chapters_id?: number; source_type?: string }) {
    return get<PersonaItem[]>(`/works/${workId}/personas`, params)
  },

  /** 创建素材 */
  create(workId: number, data: CreatePersonaParams) {
    return post<{ id: number }>(`/works/${workId}/personas`, data)
  },

  /** 更新素材 */
  update(workId: number, id: number, data: UpdatePersonaParams) {
    return put<null>(`/works/${workId}/personas/${id}`, data)
  },

  /** 删除素材 */
  remove(workId: number, id: number) {
    return del<null>(`/works/${workId}/personas/${id}`)
  },

  /** AI 生成形象图 */
  generateImage(workId: number, personaId: number, options?: {
    textModel?: string
    aiModel?: string
    quality?: string
    resolution?: string
  }) {
    return post<{ imageUrl: string }>(`/works/${workId}/personas/${personaId}/generate-image`, {
      textModel: options?.textModel,
      quality: options?.quality,
      resolution: options?.resolution,
    }, {
      timeout: 120000,
      headers: options?.aiModel ? { aiModel: options.aiModel } : undefined,
    })
  },

  /** AI 预览形象图（创建表单中，无需已保存的 persona） */
  previewImage(workId: number, data: { name: string; gender: string; age: string; description: string; refImageUrl?: string }) {
    return post<{ imageUrl: string }>(`/works/${workId}/personas/preview-image`, data, { timeout: 120000 })
  },

  /** AI 提取角色信息 */
  extractCharacters(workId: number, data: { chapterId: number; text: string }) {
    return post<{ saved: number }>('/agent/character-extract', { ...data, workId }, { timeout: 120000 })
  }
}

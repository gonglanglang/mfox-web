import { get, post, put, del } from './request'

// ============================================
// Types
// ============================================
export interface VoiceItem {
  id: number
  voice_name: string
  /** 供应商音色 ID（TTS 合成时真正传给 MiniMax 的 voice_id）；空则该配音无法用于合成 */
  voice_id?: string
  description: string | null
  example_url: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateVoiceParams {
  voice_name: string
  /** 供应商音色 ID（MiniMax voice_id） */
  voice_id?: string
  description?: string
  example_url?: string
  tags?: string[]
}

export interface UpdateVoiceParams {
  voice_name?: string
  /** 供应商音色 ID（MiniMax voice_id） */
  voice_id?: string
  description?: string
  example_url?: string
  tags?: string[]
}

// ============================================
// Voices APIs
// ============================================
export const voicesApi = {
  /** 获取配音列表 */
  list() {
    return get<VoiceItem[]>('/works/voices')
  },

  /** 创建配音 */
  create(data: CreateVoiceParams) {
    return post<{ id: number }>('/works/voices', data)
  },

  /** 更新配音 */
  update(id: number, data: UpdateVoiceParams) {
    return put<null>(`/works/voices/${id}`, data)
  },

  /** 删除配音 */
  remove(id: number) {
    return del<null>(`/works/voices/${id}`)
  }
}

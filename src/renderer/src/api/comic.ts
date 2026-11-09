import { get, post, put, del } from './request'
import type { ApiResponse } from './request'

// ============================================
// Types
// ============================================
export interface ComicItem {
  id: number
  title: string
  author: string
  cover: string
  tags: string[]
  chapters: number
  createdAt: string
}

export interface CreateComicParams {
  prompt: string
  genre: string
  audience: string
  pov: string
  length: string
  model: string
}

export interface GenerateResult {
  id: number
  title: string
  content: string
}

// ============================================
// Comic APIs
// ============================================
export const comicApi = {
  /** 获取漫画列表 */
  list(params?: { page?: number; pageSize?: number; genre?: string; keyword?: string }) {
    return get<{ list: ComicItem[]; total: number }>('/comics', params)
  },

  /** 获取漫画详情 */
  detail(id: number) {
    return get<ComicItem>(`/comics/${id}`)
  },

  /** AI 创作漫画 */
  create(data: CreateComicParams) {
    return post<GenerateResult>('/comics/create', data)
  },

  /** 更新漫画 */
  update(id: number, data: Partial<CreateComicParams>) {
    return put<ComicItem>(`/comics/${id}`, data)
  },

  /** 删除漫画 */
  remove(id: number) {
    return del<void>(`/comics/${id}`)
  }
}

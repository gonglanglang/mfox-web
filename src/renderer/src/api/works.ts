import { post, get, del, put, patch } from './request'
import type { WorkType, Audience, Pov, AspectRatio } from '@/config/constants'
import type { FrameMode } from '@/utils/storyboard'

// ============================================
// Types
// ============================================
export interface CreateWorkParams {
  title: string
  description?: string
  type: WorkType
  genre?: string
  audience: Audience
  pov: Pov
  cover_url?: string
  content?: string
  style_id?: number | null
  narration_voice_id?: number | null
  /** 视口宽高比（分辨率由所选模型决定） */
  aspect_ratio?: AspectRatio
}

/** 章节视频条目（聚合接口 /works/videos 返回） */
export interface ChapterVideoItem {
  id: number
  title: string
  volumeTitle: string
  chapter_no: number
  /** done=已生成完成, making=制作中（含未开始/生成中/部分完成） */
  videoStatus: 'done' | 'making'
  doneCount: number
  totalCount: number
}

/** 作品及其章节视频列表（聚合接口 /works/videos 返回） */
export interface WorkVideoItem {
  workId: number
  workTitle: string
  cover_url: string
  type: WorkType
  chapters: ChapterVideoItem[]
}

export interface WorkItem {
  id: number
  user_id: number
  title: string
  description: string | null
  content: string | null
  type: WorkType
  audience: Audience
  pov: Pov
  genre?: string
  cover_url: string
  word_count: number
  read_time: number
  narration_voice_id: number | null
  /** 视口宽高比，如 16:9（分辨率由所选模型决定） */
  aspect_ratio: string
  /** 分镜视频是否参考上一镜成片：0=否 1=是（作品级开关，默认关） */
  use_prev_video?: number
  /** 作品级默认关键帧模式：single=主流单帧驱动（默认） / dual=首尾双帧 / video_tail=视频末帧续接 */
  frame_mode?: FrameMode
  createdAt: string
  updatedAt: string
}

export interface UpdateWorkParams {
  title?: string
  description?: string
  content?: string
  type?: WorkType
  genre?: string
  audience?: Audience
  pov?: Pov
  word_count?: number
  read_time?: number
  style_id?: number | null
  narration_voice_id?: number | null
  /** 视口宽高比（分辨率由所选模型决定） */
  aspect_ratio?: AspectRatio
  /** 分镜视频是否参考上一镜成片：0=否 1=是（作品级开关） */
  use_prev_video?: number
  /** 作品级默认关键帧模式：single=主流单帧驱动 / dual=首尾双帧 / video_tail=视频末帧续接 */
  frame_mode?: FrameMode
}

// ============================================
// Works APIs
// ============================================
export const worksApi = {
  /** 创建作品 */
  create(data: CreateWorkParams) {
    return post<{ workId: number }>('/users/works/create', data)
  },

  /** 获取作品列表（分页，按创建时间倒序；type 可选筛选） */
  list(params?: { page?: number; pageSize?: number; type?: string }) {
    return get<{ list: WorkItem[]; total: number }>('/works', params)
  },

  /** 我的作品章节视频列表（聚合：作品 → 章节 → 分镜视频状态） */
  videos() {
    return get<WorkVideoItem[]>('/works/videos')
  },

  /** 获取作品详情 */
  detail(id: number) {
    return get<WorkItem>(`/works/${id}`)
  },

  /** 更新作品信息 */
  update(id: number, data: UpdateWorkParams) {
    return put<string>(`/works/${id}`, data)
  },

  /** 设置封面 */
  setCover(id: number, cover_url: string) {
    return patch<string>(`/works/${id}/cover`, { cover_url })
  },

  /** 删除作品 */
  remove(id: number) {
    return del<void>(`/works/${id}`)
  },
}

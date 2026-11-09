import { get, post, del } from './request'

export interface VisualStyleItem {
  id: number
  style_id: number
  name: string
  /** official=官方内置 / custom=用户自定义 */
  type: string
  /** 自定义画风归属用户；NULL 表示官方内置 */
  user_id?: number | null
  description: string | null
  effect_image: string
  status: string
  sort_order: number
}

export const visualStylesApi = {
  list() {
    return get<VisualStyleItem[]>('/visual-styles')
  },

  /** 创建自定义画风（上传风格参考图 + 风格描述） */
  create(data: { name: string; description: string; effect_image: string }) {
    return post<{ style_id: number }>('/visual-styles', data)
  },

  /** 删除自定义画风（仅本人；仍被作品引用时会被拒绝） */
  remove(styleId: number) {
    return del<null>(`/visual-styles/${styleId}`)
  },
}

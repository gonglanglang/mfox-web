import { get } from './request'

// ============================================
// Types
// ============================================
export type ModelContentType = 'text' | 'video' | 'image' | 'audio'
export type ModelOptionConfig =
  | string[]
  | { label?: string; value?: string; quality?: string; resolution?: string; size?: string }[]
  | Record<string, unknown>
  | string
  | null

/** 价格档位：[{label, value, price}] —— label 显示、value 用于匹配与请求、price 为积分 */
export interface PriceTier {
  label?: string
  value?: string
  price?: number
}

export interface ModelItem {
  id: number
  provider_id: number
  provider_name?: string
  sort_order?: number
  content_type: ModelContentType
  name: string
  model: string
  status: number
  /** 档位与价格的统一来源（未配置时该模型不扣积分） */
  price_config: PriceTier[] | null
  /** 模型固定请求参数 */
  params?: Record<string, unknown> | null
  /** 相对 api_url 的接口路径 */
  endpoint?: string
}

// ============================================
// Models APIs
// ============================================
export const modelsApi = {
  /** 获取启用模型列表（可按类型过滤：text / video / image / audio） */
  list(type?: ModelContentType) {
    return get<ModelItem[]>('/ai-models', type ? { type } : undefined)
  },
}

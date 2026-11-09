import type { ImageAsset, SceneDetail } from '@/api/personas'

/** 故事素材的三种业务类型，对应后端 personas.source_type。 */
export type AssetCategory = 'persona' | 'scene' | 'prop'

/** 编辑弹窗只展示外部选择的模型；生成确认由父级导航统一管理。 */
export interface AssetEditorModelConfig {
  model: string
  /** 图片档位（来自模型 price_config） */
  modelResolution?: string
  modelCost?: number
}

/** 顶部素材分类导航的展示数据。 */
export interface AssetCategoryItem {
  key: AssetCategory
  label: string
  icon: string
}

/** 顶部导航在搜索状态下会显示过滤后的数量，因此与静态分类配置分开。 */
export interface AssetCategorySummary {
  key: AssetCategory
  label: string
  count: number
}

/** 场景表单中的室内/室外状态，unknown 表示用户没有显式指定。 */
export type SceneInteriorValue = 'indoor' | 'outdoor' | 'unknown'

/** 编辑弹窗内的场景结构化字段。 */
export interface SceneDetailForm {
  name: string
  description: string
  time: string
  location: string
  interior: SceneInteriorValue
  mood: string
  keyEvents: string
  previous?: SceneDetail | null
}

/** 编辑素材时提交给后端的图片相关字段。 */
export interface AssetImageDraft {
  refImage: ImageAsset | null
  images: ImageAsset[]
  curImageId: string
}

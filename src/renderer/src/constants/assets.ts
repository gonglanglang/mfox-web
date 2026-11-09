import type { AssetCategory, AssetCategoryItem } from '@/types/assets'

/** 素材分类导航。icon 先保留字段，便于后续把分类切换改成图标按钮。 */
export const ASSET_CATEGORY_OPTIONS: AssetCategoryItem[] = [
  { key: 'persona', label: '角色', icon: '' },
  { key: 'scene', label: '场景', icon: '' },
  { key: 'prop', label: '道具', icon: '' },
]

/** 快速新增素材时使用的默认名称，与现有业务文案保持一致。 */
export const DEFAULT_ASSET_NAME_BY_CATEGORY: Record<AssetCategory, string> = {
  persona: '新角色',
  scene: '新场景',
  prop: '新道具',
}

export const UNKNOWN_ASSET_LABEL = '素材'

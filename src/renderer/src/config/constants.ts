// ============================================
// 作品通用类型常量 — 所有页面统一引用
// 新增类型只需在这里加，全局生效
// ============================================

export const WORK_TYPES = ['长篇', '短篇', '视频', '剧本'] as const
export type WorkType = (typeof WORK_TYPES)[number]

export const AUDIENCES = ['男频', '女频', '全频'] as const
export type Audience = (typeof AUDIENCES)[number]

export const POVS = ['第一人称', '第三人称'] as const
export type Pov = (typeof POVS)[number]

// 视口宽高比（作品级设置）：只定画面比例，分辨率由所选模型决定；默认 16:9
export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9'

/** 宽高比的用途提示（选择按钮上的小字） */
export const ASPECT_RATIO_HINTS: Record<AspectRatio, string> = {
  '16:9': '横屏',
  '9:16': '竖屏',
  '1:1': '方形',
  '4:3': '横屏',
  '3:4': '竖屏',
  '3:2': '横屏',
  '2:3': '竖屏',
  '21:9': '宽幅',
}

// 类型选项（含图标、描述、颜色）
export const WORK_TYPE_OPTIONS = [
  { value: '长篇' as const, label: '长篇', icon: 'icon-shuba', desc: '宏大叙事 · 深度世界观', color: '#6C5CE7' },
  { value: '短篇' as const, label: '短篇', icon: 'icon-wenzhang', desc: '短小精悍 · 快速成文', color: '#00B894' },
  { value: '视频' as const, label: '视频', icon: '🎥', desc: '可视化内容 · 一键输出', color: '#FFB347' },
  { value: '剧本' as const, label: '剧本', icon: '🎬', desc: '专业分镜 · 对白格式', color: '#0984E3' },
]

// 类型 → DaisyUI badge 颜色映射
export const WORK_TYPE_BADGE: Record<WorkType, string> = {
  '长篇': 'btn-primary',
  '短篇': 'btn-secondary',
  '视频': 'btn-warning',
  '剧本': 'btn-info',
}

// 类型 → 颜色值映射
export const WORK_TYPE_COLOR: Record<WorkType, string> = {
  '长篇': '#6C5CE7',
  '短篇': '#00B894',
  '视频': '#FFB347',
  '剧本': '#0984E3',
}

// 筛选标签（含"全部"）
export function buildFilterTags() {
  return [{ id: '全部', label: '全部' }, ...WORK_TYPES.map(t => ({ id: t, label: t }))]
}

// 按钮 icon 映射
export const AUDIENCE_ICONS: Record<Audience, string> = {
  '男频': '👨',
  '女频': '👩',
  '全频': '🌐',
}

export const POV_ICONS: Record<Pov, string> = {
  '第一人称': '🙋',
  '第三人称': '👁️',
}

// 类型 icon 查找
export function workTypeIcon(type: WorkType): string {
  return WORK_TYPE_OPTIONS.find(o => o.value === type)?.icon || ''
}

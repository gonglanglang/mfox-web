export type FrameMode = 'single' | 'dual' | 'video_tail'

export type VideoGenMode =
  | 'text2video'
  | 'singleImage2video'
  | 'frames2video'
  | 'image2video'
  | 'video2video'
  | 'videoEdit2video'
  | 'audio2video'
  | 'mixed2video'

export interface ShotCharacterRef {
  role_id?: number | string
  name: string
  image_url: string
  description?: string
}

export interface StoryDialogue {
  id: string | number
  prop_ids?: (string | number)[]
  speaker: string
  text: string
  tone: string
  emotion: string
}

export interface StoryShot {
  start_prompt?: string
  end_prompt?: string
  negative_prompt?: string
  roles?: { id: number | string }[]
  durShort?: number
  videoPrompt?: string
  /** 镜头级切换方式：本镜 → 下一镜（为空时按场景级兜底） */
  transition?: string
  /** 关键帧模式：single=主流单帧驱动（默认推荐） / dual=首尾双帧 / video_tail=视频末帧续接 */
  frame_mode?: FrameMode
  /** 前序不可逆世界与道具状态锁（防止动作在下一镜还原重做） */
  world_state?: string
  continuity_status?: string
  shot_size: string
  camera_angle: string
  camera_movement: string
  content: string
  dialogue: StoryDialogue[]
  sound_effect: string
  // ── LibTV 对齐新增 11 字段 ──
  plot_description?: string
  image_prompt?: string
  motion_prompt?: string
  scene_tags?: string[] | string
  lighting?: string
  emotion?: string
  character_action?: string
  character_refs?: ShotCharacterRef[]
  reference_frame_url?: string
  gen_mode?: VideoGenMode
  model_params?: Record<string, any>
  videoNeedsRerun?: boolean
  ttsAudioUrl?: string
}

export interface StoryScene {
  role_id?: string | number
  scene_id?: string | number | null
  prop_ids?: (string | number)[]
  environment: string
  shots: StoryShot[]
  transition: string
  bgm: string
}
export type ScenePatch = Partial<Omit<StoryScene, 'shots'>>
export type ShotPatch = Partial<StoryShot>

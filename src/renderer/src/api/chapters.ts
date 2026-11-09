import { get, post, put, patch, del } from './request'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import type { FrameMode, ScenePatch, ShotCharacterRef, ShotPatch, StoryScene, StoryShot, VideoGenMode } from '@/utils/storyboard'

export interface ComposeClipInput {
  sourceNodeId?: string
  panelIdx?: number
  url: string
  startTime?: number
  duration: number
  sourceOffset?: number
  sourceDuration?: number
  decibel?: number
  transitionAfter?: string
}

export interface ShotAssetVersionItem {
  id: number
  work_id: number
  chapter_id: number
  scene_index: number
  shot_index: number
  asset_type: 'first_frame' | 'last_frame' | 'reference_frame' | 'video' | 'tts' | 'compose'
  version: number
  url: string
  prompt?: string | null
  model?: string | null
  gen_mode?: string | null
  params?: Record<string, any> | null
  duration?: number | null
  status: 'running' | 'completed' | 'failed'
  is_current: number
  cost: number
  error_msg?: string | null
  createdAt?: string
}

export interface ChapterItem {
  id: number
  work_id: number
  volume_id: number | null
  user_id: number
  title: string
  content: string
  chapter_no: number
  word_count: number
  status: 'draft' | 'published'
  content_configs: any | null
  createdAt: string
  updatedAt: string
}

export interface PanelPatch {
  start_prompt?: string
  end_prompt?: string
  negative_prompt?: string
  sound_effect?: string
  scene_id?: number | null
  prop_ids?: number[]
  environment?: string
  roles?: { id: number }[]
  durShort?: number
  shot_size?: string
  camera_angle?: string
  camera_movement?: string
  /** 镜头级切换方式（本镜 → 下一镜）；场景级转场走 updateScene */
  transition?: string
  /** 关键帧模式：single=主流单帧驱动（默认推荐） / dual=首尾双帧 / video_tail=视频末帧续接 */
  frame_mode?: FrameMode
  /** 前序不可逆世界与道具状态锁 */
  world_state?: string
  segments?: unknown[]
  videoPrompt?: string
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
}

export const chaptersApi = {
  updateScene(workId: number, chapterId: number, sceneIdx: number, data: ScenePatch) {
    return patch<StoryScene>(`/works/${workId}/chapters/${chapterId}/scenes/${sceneIdx}`, data)
  },

  updateShot(workId: number, chapterId: number, sceneIdx: number, shotIdx: number, data: ShotPatch) {
    return patch<StoryShot>(`/works/${workId}/chapters/${chapterId}/scenes/${sceneIdx}/shots/${shotIdx}`, data)
  },
  /** 一键创建卷+章节 */
  createVolume(workId: number) {
    return post<{ volumeId: number }>(`/works/${workId}/volumes`)
  },

  /** 在指定卷下创建章节 */
  create(workId: number, data: { title: string; volume_id?: number; chapter_no?: number }) {
    return post<{ id: number }>(`/works/${workId}/chapters`, data)
  },

  /** 更新卷信息 */
  updateVolume(workId: number, volumeId: number, data: { title?: string }) {
    return put<null>(`/works/${workId}/volumes/${volumeId}`, data)
  },

  /** 更新章节 */
  update(workId: number, chapterId: number, data: {
    title?: string
    content?: string
    chapter_no?: number
    word_count?: number
    status?: 'draft' | 'published'
    content_configs?: any
  }) {
    return put<null>(`/works/${workId}/chapters/${chapterId}`, data)
  },

  /** 增量更新单个分镜；生成状态、媒体 URL 和任务字段由服务端维护。 */
  updatePanel(workId: number, chapterId: number, panelIdx: number, data: PanelPatch) {
    return patch<unknown>(`/works/${workId}/chapters/${chapterId}/panels/${panelIdx}`, data)
  },

  /** 删除分镜：按数据形态分发到树形（scenes/shots）或扁平（panels）接口 */
  removeStoryboardPanel(target: {
    workId: number; chapterId: number
    sceneIdx?: number; shotIdx?: number; panelIdx?: number
  }) {
    const { workId, chapterId, sceneIdx, shotIdx, panelIdx } = target
    return sceneIdx !== undefined && shotIdx !== undefined
      ? del<{ remaining: number }>(`/works/${workId}/chapters/${chapterId}/scenes/${sceneIdx}/shots/${shotIdx}`)
      : del<{ remaining: number }>(`/works/${workId}/chapters/${chapterId}/panels/${panelIdx ?? 0}`)
  },

  /** 删除章节 */
  remove(workId: number, chapterId: number) {
    return del<null>(`/works/${workId}/chapters/${chapterId}`)
  },

  /** 删除卷（级联删除其下所有章节） */
  removeVolume(workId: number, volumeId: number) {
    return del<null>(`/works/${workId}/volumes/${volumeId}`)
  },

  /** AI 提取分镜（SSE 任务时间链） */
  breakdown(workId: number, chapterId: number, text: string): Promise<{ taskId: string; configs: any[] }> {
    const base = import.meta.env.VITE_API_BASE_URL || '/api'
    const token = localStorage.getItem('token') || ''
    const ctrl = new AbortController()

    return new Promise((resolve, reject) => {
      let taskId = ''
      let configs: any[] = []

      fetchEventSource(`${base}/agent/storyboard-breakdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chapterId, text, workId }),
        signal: ctrl.signal,
        openWhenHidden: true,
        onmessage(event) {
          if (event.data === '[DONE]') {
            resolve({ taskId, configs })
            return
          }
          try {
            const data = JSON.parse(event.data)
            if (data?.type === 'task') {
              taskId = data.taskId
              return
            }
            // 收集 extract-storyboard step 的输出（configs）
            if (data?.type === 'workflow-step-result' && data?.payload?.output) {
              const out = data.payload.output
              if (out.configs) configs = out.configs
            }
          } catch { /* ignore parse errors */ }
        },
        onerror(err) {
          ctrl.abort()
          reject(err)
        },
      })
    })
  },

  /** AI 重绘分镜（异步非阻塞，前端轮询 panelStatus） */
  quoteRedrawFrame(data: {
    workId: number
    chapterId: number
    panelIdx: number
    resolution: string
    frameMode?: FrameMode
  }, model: string) {
    return post<{ linked: boolean; cost: number }>('/agent/frame-redraw/quote', data, { headers: { aiModel: model } })
  },

  /**
   * 市场主流无缝承接：一键从上一镜视频截取真实最后一帧（或上一镜关键帧）作为本镜首帧
   */
  inheritPrevFrame(data: {
    workId: number
    chapterId: number
    panelIdx: number
    source?: 'auto' | 'video_tail' | 'prev_frame'
  }) {
    return post<{
      panelIdx: number
      firstFrameUrl: string
      sourceUsed: 'video_tail' | 'prev_frame'
      world_state: string
    }>('/agent/storyboard/inherit-prev-frame', data)
  },

  /**
   * 重置卡住的视频任务：进程重启/异常退出会让分镜一直停在"生成中"且无法重新提交；
   * 重置会退回本次预扣积分并解锁该分镜。
   */
  resetFrameVideo(workId: number, chapterId: number, panelIdx: number) {
    return post<null>('/agent/frame-video/reset', { workId, chapterId, panelIdx })
  },

  /**
   * 合成章节成品：把勾选的分镜视频按顺序重编码拼接（跨场景按 transition 插转场）。
   * 支持 clips[] 时间线入点/出点/分贝调节与双轨音量控制。
   */
  compose(workId: number, chapterId: number, data: {
    resolution: string
    fps: number
    panelIdxes?: number[]
    clips?: ComposeClipInput[]
    videoAudioMuted?: boolean
    videoAudioVolume?: number
    audioTrackMuted?: boolean
    audioTrackVolume?: number
  }) {
    return post<{ taskId: string; segmentCount: number; width: number; height: number }>(
      '/agent/compose', { workId, chapterId, ...data })
  },

  /** LibTV 节点化流水线：单节点重跑 */
  runPipelineNode(data: {
    workId: number
    chapterId: number
    panelIdx: number
    nodeType: 'image' | 'video' | 'audio' | 'compose'
    model?: string
    resolution?: string
    styleId?: number | null
    frameMode?: FrameMode
    genMode?: VideoGenMode
    narrationVoiceId?: number | null
    params?: Record<string, any>
  }) {
    return post<{
      nodeId: string
      nodeType: string
      panelIdx: number
      status: 'completed' | 'failed'
      assetId?: number
      version?: number
      url?: string
      error?: string
    }>('/pipeline/node/run', data, data.model ? { headers: { aiModel: data.model } } : undefined)
  },

  /** LibTV 节点化流水线：批量节点运行 */
  runPipelineBatch(data: {
    workId: number
    chapterId: number
    nodeType: 'image' | 'video' | 'audio'
    panelIdxes: number[]
    concurrency?: number
    model?: string
    resolution?: string
    styleId?: number | null
    frameMode?: FrameMode
    genMode?: VideoGenMode
    narrationVoiceId?: number | null
  }) {
    return post<{
      total: number
      completed: number
      failed: number
      results: Array<{
        nodeId: string
        panelIdx: number
        status: 'completed' | 'failed'
        version?: number
        url?: string
        error?: string
      }>
    }>('/pipeline/batch/run', data, data.model ? { headers: { aiModel: data.model } } : undefined)
  },

  /** 查询分镜历史版本列表 */
  getNodeVersions(params: {
    workId: number
    chapterId: number
    panelIdx: number
    assetType?: string
  }) {
    return get<{
      panelIdx: number
      sceneIndex: number
      shotIndex: number
      versions: ShotAssetVersionItem[]
    }>('/pipeline/node/versions', params)
  },

  /** 切换分镜指定版本为当前版本 (is_current=1) */
  selectNodeVersion(data: {
    workId: number
    chapterId: number
    panelIdx: number
    assetType: string
    assetId?: number
    version?: number
  }) {
    return post<{
      selected: ShotAssetVersionItem
      shot: any
    }>('/pipeline/node/select', data)
  },

  /** 视频高清超分 (1080p / 2k / 4k) */
  upscaleVideo(data: {
    workId: number
    chapterId: number
    panelIdx?: number
    sourceUrl?: string
    targetResolution?: '1080p' | '2k' | '4k'
  }) {
    return post<{
      url: string
      width: number
      height: number
      targetResolution: '1080p' | '2k' | '4k'
      version?: number
      assetId?: number
    }>('/pipeline/video/upscale', data)
  },

  /** 查询视频模型的能力 Schema */
  getModelCapabilities(model: string) {
    return get<{
      model: string
      modes: VideoGenMode[]
      params: Record<string, any>
      inputLimits?: Record<string, { min: number; max: number }>
    }>('/pipeline/models/capabilities', { model })
  },

  redrawFrame(panelData: {
    /** 必填：前端确认过的报价，服务端据此拦截参数变化后的旧报价 */
    expectedCost: number
    workId: number
    chapterId: number
    panelIdx: number
    styleId: number
    /** 图片档位（来自模型 price_config，同时作为计费键） */
    resolution: string
    /** 关键帧模式：single=主流单帧驱动（默认推荐，仅出1张） / dual=首尾双帧（出2张） */
    frameMode?: FrameMode
  }, model: string): Promise<{ panelIdx: number; cost: number; runId: string }> {
    return post<{ panelIdx: number; cost: number; runId: string }>(`/agent/frame-redraw`, panelData, {
      headers: { aiModel: model },
    })
  },
}

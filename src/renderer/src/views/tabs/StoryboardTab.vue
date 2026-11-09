<script setup lang="ts">
/**
 * 分镜制作 tab：视频预览、出镜角色、Prompt 编辑、AI 重绘 / 生成视频、任务轮询。
 * 业务逻辑（选中面板、重绘、视频、轮询、保存分镜）全部在组件内部；
 * panels / 公共参数来自父级 props，面板对象直接原地修改（父级与其他 tab 同步可见）。
 */
import { watch, nextTick, ref, computed, onMounted, onUnmounted } from "vue";
import Player from 'xgplayer';
import 'xgplayer/dist/index.min.css';
import VoicePicker from '@/components/VoicePicker.vue'
import CharacterSelect from '@/components/CharacterSelect.vue'
import { personaImage } from '@/utils/personas'
import { type Segment } from '@/utils/segments'
import type { VoiceItem } from '@/api/voices'
import type { PersonaItem } from '@/api/personas'
import { worksApi } from '@/api/works'
import { chaptersApi, type PanelPatch, type ShotAssetVersionItem } from '@/api/chapters'
import { storyboardPanels } from '@/utils/storyboard-panels'
import type { ShotCharacterRef, VideoGenMode } from '@/utils/storyboard'
import { get } from '@/api/request'

import ModelPicker from '@/components/ModelPicker.vue'
import DialoguePlayback from '@/components/DialoguePlayback.vue'
import ImageViewer from '@/components/ImageViewer.vue'
import StoryboardAssetBinding from '@/components/StoryboardAssetBinding.vue'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/composables/useAuth'

// ── 接口 ──
interface Role {
  id?: number
  name?: string
}

interface Panel {
  environment?: string
  transition?: string
  start_prompt?: string
  end_prompt?: string
  negative_prompt?: string
  sound_effect?: string
  sceneIdx?: number
  shotIdx?: number
  scene_id?: number | null
  prop_ids?: number[]
  id: number // 分镜 ID
  scene: string // 场景描述
  subject_motion?: string | null // 主体运动
  key_prop_action?: string | null // 道具动作
  videoPrompt?: string // 视频 Prompt
  roles: Role[] // 出镜角色
  segments: Segment[] // 分镜内容（文本、图片、音频）
  durShort: number // 分镜时长（秒）
  panelIdx?: number // 分镜索引（从 0 开始）
  shot_size?: string // 分镜尺寸（如 '16:9'）
  camera_angle?: string // 相机角度（如 '0°'）
  camera_movement?: string // 相机移动（如 '0°'）
  firstFrameUrl?: string // 第一帧图片 URL
  lastFrameUrl?: string // 最后一帧图片 URL
  finalVideoUrl?: string // 最终视频 URL
  /** 关键帧模式：single(主流单帧驱动，推荐) | dual(传统首尾双帧) | video_tail(承接上一镜视频末帧) */
  frame_mode?: 'single' | 'dual' | 'video_tail'
  /** 跨镜不可逆状态账本（如：木门已敞开） */
  world_state?: string
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
  panelStatus?: string // 分镜状态（如 'done'）
  redrawRun?: { id: string; cost: number; status: 'charged' | 'done' | 'refunded' }
  /** 任务失败/被重置时的原因（服务端写入） */
  taskError?: string
  _task?: 'redraw' | 'video' // 任务类型（如 'redraw' / 'video'）
  _editingScene?: boolean // 是否正在编辑场景（如重绘 / 视频生成）
}

// ── Props / Emits ──
const props = defineProps<{
  panels: Panel[] // 分镜列表

  voices: VoiceItem[] // 语音列表
  voiceOptions: string[] // 语音选项（如 'doubao-seedance-2-0-mini-260615'）
  narrationVoice: string // 语音 ID
  characters: PersonaItem[] // 角色列表
  assets: PersonaItem[]
  workId: number // 作品 ID
  chapterId: number // 章节 ID
  styleId: number | null // 作品画风 ID
  narrationVoiceId: number | null // 音频 ID
  /** 作品级开关：生成分镜视频时是否把上一镜成片作为参考视频（0=否 1=是） */
  usePrevVideo?: number
  /** 作品级默认关键帧模式：single(主流单帧驱动) | dual(传统首尾双帧) */
  frameMode?: 'single' | 'dual' | 'video_tail'
  /** AI 图片模型（VideoStoryboard header 选择，用于 AI 重绘分镜） */
  model: string
  /** AI 文本模型（闭环一致性校验，需要支持图片输入） */
  textModel: string

  modelResolution: string
  modelCost: number
}>()

interface RegisteredAction {
  label: string
  run: () => void
  confirm?: {
    open: boolean
    selectedCount: number
    quality?: string
    resolution?: string
    title?: string
    cost: number
    generating: boolean
    close: () => void
    submit: () => void
  }
}

const emit = defineEmits<{
  'update:narrationVoice': [value: string]
  /** 切换"参考上一镜成片"作品级开关（由父级持久化到 works） */
  'update:usePrevVideo': [value: number]
  /** 切换作品级关键帧模式（single | dual） */
  'update:frameMode': [value: 'single' | 'dual' | 'video_tail']
  /** 向 VideoStoryboard header 注册本步骤主操作（AI 重绘分镜） */
  'register-action': [action: RegisteredAction | null]
}>()

const panels = ref<Panel[]>([])
watch(() => props.panels, configs => {
  panels.value = storyboardPanels(configs)
}, { immediate: true })
const totalDuration = computed(() => panels.value.reduce((sum, panel) => sum + panel.durShort, 0))
const { show: showToast } = useToast()
const { refreshUser } = useAuth()

// ── 作品画风由「小说故事」步骤选择（本 tab 只读取，用于重绘） ──
const videoModel = ref('')
const videoCost = ref(0)
const videoResolution = ref('')
const videoConfirm = ref(false)
const dialoguePlayer = ref<InstanceType<typeof DialoguePlayback>>()
const scenes = computed(() => props.assets.filter(asset => asset.source_type === 'scene' && asset.chapters_id === props.chapterId))
const propAssets = computed(() => props.assets.filter(asset => asset.source_type === 'prop'))
const transitionOptions = ref<string[]>([])
const savingTransition = ref(false)
onMounted(async () => {
  try {
    const enums = await get<{ transition: string[] }>('/settings/chapter/enums')
    transitionOptions.value = enums.transition || []
  } catch (error: any) { showToast(error.message || '加载镜头切换选项失败', 'error') }
})

async function updateTransition(event: Event) {
  const panel = selectedPanelData.value
  const select = event.target as HTMLSelectElement
  if (!panel || panel.sceneIdx === undefined || savingTransition.value) return
  const transition = select.value
  if (!transitionOptions.value.includes(transition)) return
  savingTransition.value = true
  try {
    await chaptersApi.updateScene(props.workId, props.chapterId, panel.sceneIdx, { transition })
    Object.assign(props.panels[panel.sceneIdx], { transition })
    panels.value.filter(row => row.sceneIdx === panel.sceneIdx).forEach(row => { row.transition = transition })
  } catch (error: any) {
    select.value = panel.transition || ''
    showToast(error.message || '保存镜头切换方式失败', 'error')
  } finally { savingTransition.value = false }
}
function confirmVideo() {
  if (!selectedPanelData.value || isGenerating.value) return
  if (!videoModel.value) { showToast('请选择视频模型', 'info'); return }
  if (!selectedPanelData.value.firstFrameUrl) { showToast('请先生成分镜主关键帧（首帧）', 'info'); return }
  videoConfirm.value = true
}

// ── 选中分镜（内部状态，默认选中第一个） ──
const selectedPanel = ref<number | null>(null)
const selectedPanelData = computed(() => panels.value.find(p => p.id === selectedPanel.value) || null)

/** 当前分镜的有效关键帧模式（默认主流单关键帧模式 'single'） */
const activeFrameMode = computed<'single' | 'dual'>(() => {
  const p = selectedPanelData.value
  if (p?.frame_mode === 'dual') return 'dual'
  if (p?.frame_mode === 'single' || p?.frame_mode === 'video_tail') return 'single'
  return props.frameMode === 'dual' ? 'dual' : 'single'
})

/** 上一镜数据（用于一键承接上一镜视频末帧/画面） */
const prevPanelData = computed<Panel | null>(() => {
  const p = selectedPanelData.value
  if (!p) return null
  const idx = panels.value.indexOf(p)
  return idx > 0 ? panels.value[idx - 1] : null
})

function setFrameMode(mode: 'single' | 'dual') {
  const p = selectedPanelData.value
  emit('update:frameMode', mode)
  if (!p || isGenerating.value) return
  p.frame_mode = mode
  if (mode === 'single') {
    p.lastFrameUrl = ''
  }
  void saveEdit(p, { frame_mode: mode })
}

const inheritingPrevFrame = ref(false)
async function onInheritPrevFrame(preferVideoTail = true) {
  const p = selectedPanelData.value
  if (!p || !prevPanelData.value || inheritingPrevFrame.value || isGenerating.value) return
  const panelIdx = p.panelIdx ?? panels.value.indexOf(p)
  if (panelIdx <= 0) return
  inheritingPrevFrame.value = true
  try {
    const res = await chaptersApi.inheritPrevFrame({
      workId: props.workId,
      chapterId: props.chapterId,
      panelIdx,
      source: preferVideoTail ? 'video_tail' : 'prev_frame',
    })
    p.firstFrameUrl = res.firstFrameUrl
    p.lastFrameUrl = ''
    p.frame_mode = res.sourceUsed === 'video_tail' ? 'video_tail' : 'single'
    const source = p.sceneIdx !== undefined && p.shotIdx !== undefined
      ? (props.panels[p.sceneIdx] as any)?.shots?.[p.shotIdx]
      : props.panels.find((item, index) => (item.panelIdx ?? index) === p.panelIdx)
    if (source) {
      source.firstFrameUrl = res.firstFrameUrl
      source.lastFrameUrl = ''
      source.frame_mode = p.frame_mode
    }
    showToast(
      res.sourceUsed === 'video_tail'
        ? '已截取上一镜视频真实末帧作为本镜首帧（100% 像素级无缝衔接）'
        : '已复用上一镜关键帧作为本镜首帧',
      'success',
    )
  } catch (err: any) {
    showToast(err.message || '承接上一镜画面失败', 'error')
  } finally {
    inheritingPrevFrame.value = false
  }
}

/**
 * 重置卡住的视频任务：进程重启/服务发版会让分镜一直停在"生成中"，既不能重试也拿不到结果。
 * 重置会退回本次预扣积分并解锁该分镜（服务端在同一事务里完成），这里同步本地状态。
 */
const resettingVideo = ref(false)
async function resetStuckVideo() {
  const panel = selectedPanelData.value
  if (!panel || !props.workId || !props.chapterId || resettingVideo.value) return
  resettingVideo.value = true
  try {
    await chaptersApi.resetFrameVideo(props.workId, props.chapterId, panel.panelIdx ?? 0)
    panel.panelStatus = 'error'
    panel._task = undefined
    panel.taskError = '已手动重置，可以重新生成'
    showToast('已重置该分镜的视频任务，可以重新生成', 'success')
  } catch (error: any) {
    showToast(error.message || '重置失败', 'error')
  } finally { resettingVideo.value = false }
}

/** 切换"参考上一镜成片"开关（作品级；持久化交给父级写入 works.use_prev_video） */
function toggleUsePrevVideo(next: boolean) {
  emit('update:usePrevVideo', next ? 1 : 0)
}

const selectedFrameImages = computed(() => {
  const panel = selectedPanelData.value
  if (!panel) return []
  return [
    { src: panel.firstFrameUrl || '', title: activeFrameMode.value === 'single' ? '主关键帧（首帧）' : '首帧图' },
    ...(activeFrameMode.value === 'dual' ? [{ src: panel.lastFrameUrl || '', title: '尾帧图' }] : []),
  ].filter(image => image.src)
})
const redrawConfirm = ref(false)
const redrawSubmitting = ref(false)

const redrawQuote = ref<{ linked: boolean; cost: number; frameMode?: 'single' | 'dual' | 'video_tail' } | null>(null)
const redrawQuoting = ref(false)
let redrawQuoteKey = ''
function currentRedrawQuoteKey() {
  return JSON.stringify([selectedPanel.value, props.chapterId, props.workId, props.model, props.modelResolution, activeFrameMode.value])
}
async function openRedrawConfirm() {
  const panel = selectedPanelData.value
  if (!panel || redrawQuoting.value) return
  if (panel.panelStatus === 'generating' || redrawSubmitting.value)
    return showToast('分镜正在重绘中，请稍后', 'info')
  const promptText = (panel.image_prompt || panel.start_prompt || panel.scene || '').trim()
  if (!promptText)
    return showToast('请先填写画面提示词', 'info')
  if (!panel.start_prompt?.trim()) panel.start_prompt = promptText
  if (!panel.image_prompt?.trim()) panel.image_prompt = promptText
  if (activeFrameMode.value === 'dual' && !panel.end_prompt?.trim()) {
    panel.end_prompt = promptText
  }
  if (!props.model) return showToast('请先在顶部选择图片模型', 'info')
  if (!props.modelResolution) return showToast('请选择图片分辨率', 'info')
  if (!props.styleId) return showToast('请先在「小说故事」步骤选择作品画风', 'info')
  const quoteKey = currentRedrawQuoteKey()
  redrawQuoting.value = true
  try {
    const quote = await chaptersApi.quoteRedrawFrame({
      workId: props.workId,
      chapterId: props.chapterId,
      panelIdx: panel.panelIdx ?? panels.value.indexOf(panel),
      resolution: props.modelResolution,
      frameMode: activeFrameMode.value,
    }, props.model)
    if (quoteKey !== currentRedrawQuoteKey()) return
    redrawQuote.value = quote
    redrawQuoteKey = quoteKey
    redrawConfirm.value = true
  } catch (error: any) { showToast(error.message || '查询重绘积分失败', 'error') }
  finally { redrawQuoting.value = false }
}

function submitRedraw() {
  const panel = selectedPanelData.value
  if (!panel) return
  redrawConfirm.value = false
  if (redrawQuoteKey !== currentRedrawQuoteKey()) { void openRedrawConfirm(); return }
  void onRedrawPanel(panels.value.indexOf(panel))
}

function registerRedrawAction() {
  const isSingle = activeFrameMode.value === 'single'
  emit('register-action', {
    label: redrawSubmitting.value ? '分镜重绘中...' : 'AI 重绘分镜',
    run: openRedrawConfirm,
    confirm: {
      open: redrawConfirm.value,
      selectedCount: 1,
      resolution: props.modelResolution,
      title: isSingle
        ? '主流单关键帧模式：仅生成 1 张主关键帧（积分减半，动作由视频自然演进），失败全额退款'
        : '首尾双帧模式：首尾帧各生成 1 张，按实际出图结算，失败全额退款',
      cost: redrawQuote.value?.cost ?? 0,
      generating: redrawSubmitting.value,
      close: () => { redrawConfirm.value = false },
      submit: submitRedraw,
    },
  })
}

watch(() => panels.value, (list) => {
  if (!list.some(panel => panel.id === selectedPanel.value)) {
    selectedPanel.value = list[0]?.id ?? null
  }
}, { immediate: true })

onMounted(registerRedrawAction)
watch([
  redrawQuote,
  redrawConfirm,
  redrawSubmitting,
  selectedPanel,
  activeFrameMode,
  () => props.model,

  () => props.modelResolution,
  () => props.modelCost,
], registerRedrawAction)

// ── 播放器 ──
let player: Player | null = null

// 模板只调用方法，播放器实例由脚本管理，避免模板将初始 null 收窄为 never。
function pauseVideo() {
  player?.pause()
}

function initPlayer(videoUrl: string, posterUrl: string) {
  const el = document.getElementById('mse-video')
  if (!el || el.offsetParent === null) {
    return
  }
  if (player) {
    try { player.destroy() } catch { /* ignore */ }
    player = null
  }
  player = new Player({
    id: 'mse-video',
    url: videoUrl,
    volume: 0.3,
    poster: posterUrl,
    playsinline: true,
    height: '100%',
    width: '100%',
  })
  player.on('play', () => dialoguePlayer.value?.stop())
}

function getPosterForPanel(panel: Panel | null): string {
  if (panel?.firstFrameUrl) return panel.firstFrameUrl
  return ''
}

// 播放器：监听最终视频 URL 变化（合并成一个 watch，immediate 保证刷新后能初始化）
watch(
  () => panels.value.find(p => p.id === selectedPanel.value)?.finalVideoUrl,
  async (newUrl) => {
    if (newUrl) {
      await nextTick()
      initPlayer(newUrl, getPosterForPanel(selectedPanelData.value))
    } else if (player) {
      try { player.destroy() } catch { /* ignore */ }
      player = null
    }
  },
  { immediate: true }
)

// 是否处于生成中（加载）状态
const isGenerating = computed(() => selectedPanelData.value?.panelStatus === 'generating')

// ── 增量保存当前分镜；不回传图片、视频、状态和任务数据 ──
function editablePanelData(p: Panel): PanelPatch {
  return {
    environment: p.scene,
    roles: p.roles.flatMap(r => r.id == null ? [] : [{ id: r.id }]),
    durShort: p.durShort || 5,
    shot_size: p.shot_size || '',
    camera_angle: p.camera_angle || '',
    camera_movement: p.camera_movement || '',
    start_prompt: p.start_prompt || p.image_prompt || '',
    end_prompt: p.end_prompt || '',
    negative_prompt: p.negative_prompt || '',
    sound_effect: p.sound_effect || '',
    frame_mode: p.frame_mode || activeFrameMode.value,
    world_state: p.world_state || '',
    segments: p.segments || [],
    videoPrompt: p.videoPrompt || p.motion_prompt || '',
    plot_description: p.plot_description || p.scene || '',
    image_prompt: p.image_prompt || p.start_prompt || '',
    motion_prompt: p.motion_prompt || p.videoPrompt || '',
    scene_tags: Array.isArray(p.scene_tags) ? p.scene_tags.join(',') : (p.scene_tags || ''),
    lighting: p.lighting || '',
    emotion: p.emotion || '',
    character_action: p.character_action || '',
    character_refs: p.character_refs || [],
    reference_frame_url: p.reference_frame_url || '',
    gen_mode: p.gen_mode || (p.frame_mode === 'dual' ? 'frames2video' : 'singleImage2video'),
    model_params: p.model_params || {},
  }
}

async function savePanel(panel: Panel, changes: PanelPatch = editablePanelData(panel)) {
  if (!props.workId || !props.chapterId) return
  if (panel.sceneIdx !== undefined && panel.shotIdx !== undefined) {
    const scene = props.panels[panel.sceneIdx] as any
    const patch = {
      ...('roles' in changes ? { roles: changes.roles } : {}),
      ...('durShort' in changes ? { durShort: changes.durShort } : {}),
      ...('videoPrompt' in changes ? { videoPrompt: changes.videoPrompt } : {}),
      ...('start_prompt' in changes ? { start_prompt: changes.start_prompt } : {}),
      ...('end_prompt' in changes ? { end_prompt: changes.end_prompt } : {}),
      ...('negative_prompt' in changes ? { negative_prompt: changes.negative_prompt } : {}),
      ...('sound_effect' in changes ? { sound_effect: changes.sound_effect } : {}),
      ...('frame_mode' in changes ? { frame_mode: changes.frame_mode } : {}),
      ...('world_state' in changes ? { world_state: changes.world_state } : {}),
      ...('plot_description' in changes ? { plot_description: changes.plot_description } : {}),
      ...('image_prompt' in changes ? { image_prompt: changes.image_prompt } : {}),
      ...('motion_prompt' in changes ? { motion_prompt: changes.motion_prompt } : {}),
      ...('scene_tags' in changes ? { scene_tags: changes.scene_tags } : {}),
      ...('lighting' in changes ? { lighting: changes.lighting } : {}),
      ...('emotion' in changes ? { emotion: changes.emotion } : {}),
      ...('character_action' in changes ? { character_action: changes.character_action } : {}),
      ...('character_refs' in changes ? { character_refs: changes.character_refs } : {}),
      ...('reference_frame_url' in changes ? { reference_frame_url: changes.reference_frame_url } : {}),
      ...('gen_mode' in changes ? { gen_mode: changes.gen_mode } : {}),
      ...('model_params' in changes ? { model_params: changes.model_params } : {}),
    }
    await chaptersApi.updateShot(props.workId, props.chapterId, panel.sceneIdx, panel.shotIdx, patch)
    Object.assign(scene.shots[panel.shotIdx], patch)
    return
  }
  const panelIdx = panel.panelIdx ?? panels.value.indexOf(panel)
  if (panelIdx < 0) throw new Error('无法定位分镜')
  await chaptersApi.updatePanel(props.workId, props.chapterId, panelIdx, changes)
  const source = props.panels.find((p, index) => (p.panelIdx ?? index) === panelIdx)
  if (source) Object.assign(source, changes)
}

async function saveEdit(panel: Panel, changes: PanelPatch) {
  try { await savePanel(panel, changes) }
  catch (error: any) {
    const source = storyboardPanels(props.panels).find(p => p.panelIdx === panel.panelIdx)
    if (source) Object.assign(panel, source)
    showToast(error.message || '保存分镜失败', 'error')
  }
}

function syncTaskState(panel: Panel) {
  const source = panel.sceneIdx !== undefined && panel.shotIdx !== undefined
    ? (props.panels[panel.sceneIdx] as any)?.shots?.[panel.shotIdx]
    : props.panels.find((p, index) => (p.panelIdx ?? index) === panel.panelIdx)
  if (source) Object.assign(source, { panelStatus: panel.panelStatus, _task: panel._task, redrawRun: panel.redrawRun })
}

// ── AI 重绘分镜（per-panel 异步非阻塞） ──
async function onRedrawPanel(panelIdx: number) {
  if (!props.workId || !props.chapterId) return
  const p = panels.value[panelIdx]
  if (!p) return
  // 防止重复提交：已经是 generating 状态则不重复发起
  if (p.panelStatus === 'generating' || redrawSubmitting.value)
    return showToast('分镜正在重绘中，请稍后', 'info')

  // 报价是必填参数（服务端据此拦截参数变化后的旧报价），缺失时不发起请求
  const expectedCost = redrawQuote.value?.cost
  if (typeof expectedCost !== 'number') return showToast('请先确认重绘积分', 'info')

  const previousStatus = p.panelStatus
  redrawSubmitting.value = true
  p._task = 'redraw' // 标记为「重绘分镜」任务
  try {
    await savePanel(p) // 持久化当前分镜的用户编辑
    const params = {
      workId: props.workId, // 作品 ID
      chapterId: props.chapterId, // 章节 ID
      panelIdx: p.panelIdx ?? panelIdx, // 分镜索引
      styleId: props.styleId!, // 图风格 ID
      expectedCost,
      resolution: props.modelResolution,
      frameMode: activeFrameMode.value,
    }
    const started = await chaptersApi.redrawFrame(params, props.model)
    // 后端已完成原子扣费并将分镜标记为 generating。
    p.panelStatus = 'generating'
    p.redrawRun = { id: started.runId, cost: started.cost, status: 'charged' }
    syncTaskState(p)
    await refreshUser()
    startPanelPoll()
  } catch (e: any) {
    showToast(e.message || '分镜重绘失败', 'error')
    p.panelStatus = previousStatus
    await refreshUser()
  } finally {
    redrawSubmitting.value = false
  }
}

// ── AI 生成分镜视频（TTS + Seedance）──
const submittingVideo = ref(false)
async function onGenerateVideo() {
  if (submittingVideo.value || isGenerating.value || !videoModel.value) return
  const p = selectedPanelData.value
  if (!p || !props.workId || !props.chapterId) return
  videoConfirm.value = false
  submittingVideo.value = true
  const previousStatus = p.panelStatus
  try {
    // 先保存编辑，再由服务端原子领取任务和扣费，不能提前把 generating 写入数据库。
    await savePanel(p)
    p.panelStatus = 'generating'
    p._task = 'video'
    const token = localStorage.getItem('token') || ''
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/agent/frame-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, aiModel: videoModel.value },
      body: JSON.stringify({
        workId: props.workId, // 作品 ID
        chapterId: props.chapterId, // 章节 ID
        panelIdx: p.panelIdx ?? panels.value.indexOf(p), // 分镜索引
        narrationVoiceId: props.narrationVoiceId, // 语音 ID
        resolution: videoResolution.value || undefined, // 视频档位（请求与计费同源）
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.code !== 200) throw new Error(body.message || `HTTP ${res.status}`)
    syncTaskState(p)
    startPanelPoll()
  } catch (err: any) {
    p.panelStatus = previousStatus
    showToast(err.message || '视频生成失败', 'error')
    // 请求结果不确定时从服务端重新同步，不写回旧状态。
    startPanelPoll()
  } finally { submittingVideo.value = false }
}

// ── 分镜轮询：每秒拉取章节数据，更新各 panel 状态 ──
let panelPollTimer: ReturnType<typeof setInterval> | null = null
let panelPollCount = 0
let polling = false
let disposed = false
const POLL_MAX = 600 // 最大轮询次数（600 × 1.5s ≈ 15 分钟）：视频生成等长任务需要足够窗口，重绘通常 1～2 分钟

function startPanelPoll() {
  if (panelPollTimer) return // 已在轮询中
  panelPollCount = 0
  panelPollTimer = setInterval(async () => {
    if (polling || disposed) return
    panelPollCount++
    if (!props.workId || !props.chapterId) { stopPanelPoll(); return }

    // 轮询超时：后端可能已崩溃，任务丢失，标记为 error
    if (panelPollCount > POLL_MAX) {
      console.warn('分镜轮询超时，停止自动刷新')
      stopPanelPoll()
      showToast('任务仍在后台执行，完成后刷新页面即可看到结果', 'info')
      return
    }

    polling = true
    try {
      // 拉取最新章节数据
      const data: any = await worksApi.detail(props.workId)
      if (disposed) return
      const all: any[] = []
      if (data.volumes) for (const v of data.volumes) if (v.chapters) all.push(...v.chapters)
      if (data.unlinkedChapters) all.push(...data.unlinkedChapters)
      const ch = all.find((c: any) => c.id === props.chapterId)
      if (!ch?.content_configs) { stopPanelPoll(); return }

      const configs = storyboardPanels(ch.content_configs)
      let hasGenerating = false
      configs.forEach((c: any, i: number) => {
        const panel = panels.value.find((p, index) => (p.panelIdx ?? index) === (c.panelIdx ?? i))
        if (!panel) return
        const newStatus = c.panelStatus || 'idle'
        // 只从服务端同步状态（不覆盖本地编辑中的字段）
        if (newStatus === 'error' && panel.panelStatus !== 'error') showToast(c.taskError || '分镜生成失败', 'error')
        panel.panelStatus = newStatus
        panel.redrawRun = c.redrawRun
        panel._task = c._task
        if (newStatus === 'generating') hasGenerating = true
        if (c.segments) panel.segments = c.segments
        if (c.videoPrompt !== undefined) panel.videoPrompt = c.videoPrompt
        // 同步 URL 和 prompt（服务端可能有更新）
        if (c.firstFrameUrl !== undefined) panel.firstFrameUrl = c.firstFrameUrl
        if (c.lastFrameUrl !== undefined) panel.lastFrameUrl = c.lastFrameUrl
        if (c.finalVideoUrl !== undefined) panel.finalVideoUrl = c.finalVideoUrl
        for (const field of ['start_prompt', 'end_prompt', 'negative_prompt', 'sound_effect', 'frame_mode', 'world_state'] as const) {
          if (c[field] !== undefined) (panel as any)[field] = c[field]
        }
        const source = panel.sceneIdx !== undefined && panel.shotIdx !== undefined
          ? (props.panels[panel.sceneIdx] as any)?.shots?.[panel.shotIdx]
          : props.panels.find((p, index) => (p.panelIdx ?? index) === panel.panelIdx)
        if (source) for (const key of ['panelStatus', 'redrawRun', '_task', 'segments', 'videoPrompt', 'firstFrameUrl', 'lastFrameUrl', 'finalVideoUrl', 'start_prompt', 'end_prompt', 'negative_prompt', 'sound_effect', 'frame_mode', 'world_state'] as const) {
          if (c[key] !== undefined) source[key] = c[key]
        }
      })
      // 没有 generating 的分镜时停止轮询
      if (!hasGenerating) {
        stopPanelPoll()
        void refreshUser() // 生成失败退款或成功扣费后同步顶部积分
      }
    } catch {
      // 网络抖动不覆盖服务端任务状态。
    } finally { polling = false }
  }, 1500)
}

function stopPanelPoll() {
  if (panelPollTimer) { clearInterval(panelPollTimer); panelPollTimer = null }
}

// 页面进入时若服务端存在生成中的任务，自动启动轮询
watch(
  () => panels.value,
  (list) => {
    if (list.some(p => p.panelStatus === 'generating')) startPanelPoll()
  },
  { immediate: true },
)

// ── 出镜角色 ──
const showRolePicker = ref(false)
const pickedRoleIds = ref<number[]>([])

function openRolePicker() {
  pickedRoleIds.value = (selectedPanelData.value?.roles || [])
    .map(r => r.id)
    .filter((id): id is number => id != null)
  showRolePicker.value = true
}

function confirmRolePicker() {
  const panel = selectedPanelData.value
  if (!panel) return
  panel.roles = pickedRoleIds.value.map(id => ({ id }))
  void saveEdit(panel, { roles: panel.roles.flatMap(r => r.id == null ? [] : [{ id: r.id }]) })
  showRolePicker.value = false
}

function roleImage(r: Role): string {
  if (r.id == null) return ''
  const char = props.characters.find(c => c.id === r.id)
  return personaImage(char)
}

function getRoleName(r: Role): string {
  if (r.name) return r.name
  if (r.id == null) return ''
  const char = props.characters.find(c => c.id === r.id)
  return char?.name ?? ''
}

function removeRole(id: number) {
  const panel = selectedPanelData.value
  if (!panel) return
  panel.roles = (panel.roles || []).filter(r => r.id !== id)
  void saveEdit(panel, { roles: panel.roles.flatMap(r => r.id == null ? [] : [{ id: r.id }]) })
}

// ── 详情编辑（事件回调中避免直接引用可能为 null 的 selectedPanelData） ──
function updateDur(v: number) {
  if (!(v > 0)) return
  const p = selectedPanelData.value
  if (!p) return
  const clamped = Math.max(3, Math.min(15, Math.round(v)))
  p.durShort = clamped
  void saveEdit(p, { durShort: clamped })

}
function updateShotText(
  field:
    | 'start_prompt'
    | 'end_prompt'
    | 'negative_prompt'
    | 'sound_effect'
    | 'world_state'
    | 'plot_description'
    | 'image_prompt'
    | 'motion_prompt'
    | 'lighting'
    | 'emotion'
    | 'character_action'
    | 'reference_frame_url',
  value: string,
) {
  const p = selectedPanelData.value
  if (!p || isGenerating.value) return
  ;(p as any)[field] = value
  if (field === 'image_prompt') p.start_prompt = value
  if (field === 'start_prompt') p.image_prompt = value
  if (field === 'motion_prompt') p.videoPrompt = value
  void saveEdit(p, { [field]: value } as PanelPatch)
}
// 更新分镜视频提示词
function updateVideoPrompt(v: string) {
  const p = selectedPanelData.value
  if (!p) return
  p.videoPrompt = v
  p.motion_prompt = v
  void saveEdit(p, { videoPrompt: v, motion_prompt: v })
}

// ── LibTV 分镜表视图 / 批量操作 / 版本管理 / 模型能力 ──
const viewMode = ref<'card' | 'table'>('card')
const VIDEO_GEN_MODE_LABELS: Record<VideoGenMode, string> = {
  text2video: '文生视频 (T2V)',
  singleImage2video: '首帧图生视频 (I2V)',
  frames2video: '首尾帧生视频 (F2V)',
  image2video: '多图参考生视频',
  video2video: '视频续写/参考 (V2V)',
  videoEdit2video: '视频编辑',
  audio2video: '音频驱动视频 (A2V)',
  mixed2video: '多模态混合生视频',
}
const availableVideoModes = ref<VideoGenMode[]>([
  'text2video',
  'singleImage2video',
  'frames2video',
  'image2video',
  'video2video',
  'audio2video',
  'mixed2video',
])

watch(videoModel, async (m) => {
  if (!m) return
  try {
    const cap = await chaptersApi.getModelCapabilities(m)
    if (Array.isArray(cap?.modes) && cap.modes.length) {
      availableVideoModes.value = cap.modes
    }
  } catch {
    // 保持默认模式列表
  }
}, { immediate: true })

function updatePanelGenMode(panel: Panel, mode: VideoGenMode) {
  panel.gen_mode = mode
  if (mode === 'frames2video') panel.frame_mode = 'dual'
  else if (mode === 'singleImage2video') panel.frame_mode = 'single'
  void saveEdit(panel, { gen_mode: mode, frame_mode: panel.frame_mode })
}

function updateRowImagePrompt(panel: Panel, value: string) {
  panel.image_prompt = value
  panel.start_prompt = value
  void saveEdit(panel, { image_prompt: value, start_prompt: value })
}

function updateRowMotionPrompt(panel: Panel, value: string) {
  panel.motion_prompt = value
  panel.videoPrompt = value
  void saveEdit(panel, { motion_prompt: value, videoPrompt: value })
}

// ── 批量勾选与进度条 (F3) ──
const batchSelectedIdxes = ref<number[]>([])
const batchRunning = ref(false)
const batchProgress = ref({ completed: 0, total: 0, label: '' })

function toggleBatchSelectAll(checked: boolean) {
  if (checked) {
    batchSelectedIdxes.value = panels.value.map((p, i) => p.panelIdx ?? i)
  } else {
    batchSelectedIdxes.value = []
  }
}

async function runRowNode(panel: Panel, nodeType: 'image' | 'video' | 'audio') {
  if (!props.workId || !props.chapterId) return
  const panelIdx = panel.panelIdx ?? panels.value.indexOf(panel)
  if (nodeType === 'image' && !props.model) return showToast('请先在顶部选择图片模型', 'info')
  if (nodeType === 'video' && !videoModel.value) return showToast('请先选择视频模型', 'info')
  try {
    await savePanel(panel)
    panel.panelStatus = 'generating'
    panel._task = nodeType === 'image' ? 'redraw' : 'video'
    const res = await chaptersApi.runPipelineNode({
      workId: props.workId,
      chapterId: props.chapterId,
      panelIdx,
      nodeType,
      model: nodeType === 'image' ? props.model : nodeType === 'video' ? videoModel.value : undefined,
      resolution: nodeType === 'image' ? props.modelResolution : videoResolution.value,
      styleId: props.styleId,
      frameMode: panel.frame_mode || activeFrameMode.value,
      genMode: panel.gen_mode,
      narrationVoiceId: props.narrationVoiceId,
    })
    if (res.status === 'failed') {
      panel.panelStatus = 'error'
      showToast(res.error || '节点执行失败', 'error')
    } else {
      if (nodeType === 'image' && res.url) {
        panel.firstFrameUrl = res.url
        panel.videoNeedsRerun = Boolean(panel.finalVideoUrl)
      } else if (nodeType === 'video' && res.url) {
        panel.finalVideoUrl = res.url
        panel.videoNeedsRerun = false
      } else if (nodeType === 'audio' && res.url) {
        panel.ttsAudioUrl = res.url
      }
      panel.panelStatus = 'done'
      showToast(`分镜 #${panel.id} ${nodeType === 'image' ? '出图' : nodeType === 'video' ? '出视频' : '配音'}完成 (v${res.version || 1})`, 'success')
      startPanelPoll()
    }
  } catch (err: any) {
    panel.panelStatus = 'error'
    showToast(err.message || '节点执行失败', 'error')
  }
}

async function runBatchNodes(nodeType: 'image' | 'video' | 'audio') {
  if (batchRunning.value || !props.workId || !props.chapterId) return
  const targets = batchSelectedIdxes.value.length
    ? [...batchSelectedIdxes.value]
    : panels.value.map((p, i) => p.panelIdx ?? i)
  if (!targets.length) return showToast('请先选择要处理的分镜', 'info')
  if (nodeType === 'image' && !props.model) return showToast('请先在顶部选择图片模型', 'info')
  if (nodeType === 'video' && !videoModel.value) return showToast('请先选择视频模型', 'info')

  batchRunning.value = true
  const typeLabel = nodeType === 'image' ? '批量生图' : nodeType === 'video' ? '批量生视频' : '批量配音'
  batchProgress.value = { completed: 0, total: targets.length, label: typeLabel }
  try {
    const res = await chaptersApi.runPipelineBatch({
      workId: props.workId,
      chapterId: props.chapterId,
      nodeType,
      panelIdxes: targets,
      concurrency: 2,
      model: nodeType === 'image' ? props.model : nodeType === 'video' ? videoModel.value : undefined,
      resolution: nodeType === 'image' ? props.modelResolution : videoResolution.value,
      styleId: props.styleId,
      narrationVoiceId: props.narrationVoiceId,
    })
    batchProgress.value.completed = res.completed
    showToast(`${typeLabel}完成：成功 ${res.completed}/${res.total}`, res.failed > 0 ? 'info' : 'success')
    startPanelPoll()
  } catch (err: any) {
    showToast(err.message || `${typeLabel}失败`, 'error')
  } finally {
    batchRunning.value = false
  }
}

// ── 版本对比抽屉 (F2) ──
const versionDrawerOpen = ref(false)
const versionDrawerPanel = ref<Panel | null>(null)
const versionDrawerTab = ref<'first_frame' | 'video' | 'tts'>('first_frame')
const versionList = ref<ShotAssetVersionItem[]>([])
const versionLoading = ref(false)

const filteredVersions = computed(() =>
  versionList.value.filter(v => v.asset_type === versionDrawerTab.value),
)

async function openVersionDrawer(panel: Panel, tab: 'first_frame' | 'video' | 'tts' = 'first_frame') {
  versionDrawerPanel.value = panel
  versionDrawerTab.value = tab
  versionDrawerOpen.value = true
  versionLoading.value = true
  try {
    const res = await chaptersApi.getNodeVersions({
      workId: props.workId,
      chapterId: props.chapterId,
      panelIdx: panel.panelIdx ?? panels.value.indexOf(panel),
    })
    versionList.value = res.versions || []
  } catch (err: any) {
    showToast(err.message || '加载历史版本失败', 'error')
  } finally {
    versionLoading.value = false
  }
}

async function switchAssetVersion(ver: ShotAssetVersionItem) {
  const panel = versionDrawerPanel.value
  if (!panel) return
  try {
    const res = await chaptersApi.selectNodeVersion({
      workId: props.workId,
      chapterId: props.chapterId,
      panelIdx: panel.panelIdx ?? panels.value.indexOf(panel),
      assetType: ver.asset_type,
      assetId: ver.id,
      version: ver.version,
    })
    versionList.value.forEach(item => {
      if (item.asset_type === ver.asset_type) {
        item.is_current = item.id === ver.id ? 1 : 0
      }
    })
    if (ver.asset_type === 'first_frame') {
      panel.firstFrameUrl = ver.url
      if (panel.finalVideoUrl) {
        panel.videoNeedsRerun = true
        showToast(`已切换至首帧 v${ver.version}，下游视频已标记为「需重跑」`, 'info')
      } else {
        showToast(`已切换至首帧 v${ver.version}`, 'success')
      }
    } else if (ver.asset_type === 'video') {
      panel.finalVideoUrl = ver.url
      panel.videoNeedsRerun = false
      showToast(`已切换至视频 v${ver.version}`, 'success')
    } else if (ver.asset_type === 'tts') {
      panel.ttsAudioUrl = ver.url
      showToast(`已切换至配音 v${ver.version}`, 'success')
    }
    if (res.shot) {
      Object.assign(panel, {
        firstFrameUrl: res.shot.firstFrameUrl ?? panel.firstFrameUrl,
        finalVideoUrl: res.shot.finalVideoUrl ?? panel.finalVideoUrl,
        videoNeedsRerun: res.shot.videoNeedsRerun ?? panel.videoNeedsRerun,
      })
    }
  } catch (err: any) {
    showToast(err.message || '切换版本失败', 'error')
  }
}

// ── 单镜视频高清超分 ──
const upscalingPanelIdx = ref<number | null>(null)
async function onUpscalePanelVideo(panel: Panel, targetResolution: '1080p' | '2k' | '4k' = '1080p') {
  if (!panel.finalVideoUrl || upscalingPanelIdx.value !== null) return
  const panelIdx = panel.panelIdx ?? panels.value.indexOf(panel)
  upscalingPanelIdx.value = panelIdx
  try {
    const res = await chaptersApi.upscaleVideo({
      workId: props.workId,
      chapterId: props.chapterId,
      panelIdx,
      sourceUrl: panel.finalVideoUrl,
      targetResolution,
    })
    panel.finalVideoUrl = res.url
    showToast(`视频已超分至 ${targetResolution.toUpperCase()} (v${res.version || 1})`, 'success')
  } catch (err: any) {
    showToast(err.message || '视频超分失败', 'error')
  } finally {
    upscalingPanelIdx.value = null
  }
}

watch(selectedPanel, () => { videoConfirm.value = false; redrawConfirm.value = false; dialoguePlayer.value?.stop() })
onUnmounted(() => {
  disposed = true
  emit('register-action', null)
  stopPanelPoll()
  player?.destroy()
  player = null
})
</script>

<template>
  <div class="flex-1 min-h-0 flex">
    <!-- ═══ 左栏：分镜列表 ═══ -->
    <div class="w-56 shrink-0 border-r border-base-200 bg-base-100 flex flex-col">
      <div class="px-4 py-3 border-b border-base-200 space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold">
            分镜列表
            <p class="text-[10px] text-base-content/40">{{ panels.length }} 个分镜 · 共 {{ totalDuration }}s</p>
          </h3>
          <div class="join">
            <button type="button" class="btn btn-xs join-item"
              :class="viewMode === 'card' ? 'btn-primary' : 'btn-ghost'"
              @click="viewMode = 'card'">卡片</button>
            <button type="button" class="btn btn-xs join-item"
              :class="viewMode === 'table' ? 'btn-primary' : 'btn-ghost'"
              @click="viewMode = 'table'">分镜表</button>
          </div>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-for="p in panels" :key="p.id"
          class="cursor-pointer border-b border-base-200/50 transition-colors duration-150 hover:bg-base-300"
          :class="selectedPanel === p.id ? 'bg-primary/10 border-l-2 border-l-primary hover:bg-primary/20' : ''"
          @click="selectedPanel = p.id">
          <div class="flex items-center gap-3 px-4 pt-3">
            <span class="text-[10px] font-mono font-bold text-base-content/40 shrink-0">V-{{ String(p.id).padStart(2,
              '0') }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium truncate">{{ p.scene || '未命名分镜' }}</p>
            </div>
            <span v-if="p.panelStatus === 'generating'" class="loading loading-spinner loading-xs text-primary shrink-0"
              title="AI 生成中" />
            <span v-else-if="p.panelStatus === 'error'" class="shrink-0 tooltip tooltip-left" data-tip="生成失败，点击重试">
              <svg class="w-4 h-4 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </span>
          </div>
          <div class="px-4 pb-3 pt-1.5">
            <div class="grid *:[grid-area:1/1] rounded-box overflow-hidden max-w-full">
              <figure class="aspect-video bg-base-300 rounded-lg relative overflow-hidden">
                <div v-if="p.panelStatus === 'generating'"
                  class="w-full h-full flex flex-col items-center justify-center gap-1 text-primary">
                  <span class="loading loading-spinner loading-md" />
                  <span class="text-[10px]">AI 生成中...</span>
                </div>
                <template v-else-if="p.firstFrameUrl">
                  <img :src="p.firstFrameUrl" alt="首帧" class="w-full h-full object-cover" />
                </template>
                <div v-else-if="p.panelStatus === 'error'"
                  class="w-full h-full flex flex-col items-center justify-center gap-1 text-error">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span class="text-[10px]">生成失败</span>
                </div>
                <div v-else class="w-full h-full flex items-center justify-center text-base-content/20 text-[10px]">未生成
                </div>
              </figure>

            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ 中栏：分镜表视图 (LibTV) 或 视频预览 ═══ -->
    <div v-if="viewMode === 'table'" class="flex-1 min-w-0 flex flex-col bg-base-100">
      <!-- 顶部批量操作工具栏 (F3) -->
      <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-base-200 bg-base-100">
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" class="checkbox checkbox-xs checkbox-primary"
              :checked="panels.length > 0 && batchSelectedIdxes.length === panels.length"
              @change="toggleBatchSelectAll(($event.target as HTMLInputElement).checked)" />
            <span>全选 ({{ batchSelectedIdxes.length }}/{{ panels.length }})</span>
          </label>
          <button type="button" class="btn btn-xs btn-primary" :disabled="batchRunning" @click="runBatchNodes('image')">
            批量生成图片
          </button>
          <button type="button" class="btn btn-xs btn-secondary" :disabled="batchRunning" @click="runBatchNodes('video')">
            批量生成视频
          </button>
          <button type="button" class="btn btn-xs btn-accent" :disabled="batchRunning" @click="runBatchNodes('audio')">
            批量生成配音
          </button>
          <div v-if="batchRunning" class="flex items-center gap-2 ml-2 text-xs text-primary">
            <span class="loading loading-spinner loading-xs"></span>
            <span>{{ batchProgress.label }} {{ batchProgress.completed }}/{{ batchProgress.total }}</span>
            <progress class="progress progress-primary w-24" :value="batchProgress.completed" :max="batchProgress.total || 1"></progress>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-48 rounded bg-base-100">
            <ModelPicker v-model="videoModel" v-model:resolution="videoResolution"
              v-model:cost="videoCost" model-type="video" :confirm-open="videoConfirm" :confirm-selected-count="1"
              :confirm-cost="videoCost" :confirm-resolution="videoResolution"
              confirm-title="确认生成分镜视频" :confirm-generating="isGenerating || submittingVideo"
              @confirm-close="videoConfirm = false" @confirm-submit="onGenerateVideo" />
          </div>
        </div>
      </div>

      <!-- LibTV 标准分镜表格 (F1) -->
      <div class="flex-1 overflow-auto">
        <table class="table table-xs table-pin-rows w-full">
          <thead>
            <tr class="bg-base-200 text-[11px]">
              <th class="w-16">镜号</th>
              <th class="w-14">时长</th>
              <th class="w-28">景别/机位/运镜</th>
              <th class="min-w-[180px]">画面提示词 (image_prompt)</th>
              <th class="min-w-[180px]">运动提示词 (motion_prompt)</th>
              <th class="w-28">角色参考</th>
              <th class="w-24">参考帧/首帧</th>
              <th class="w-32">台词 / 音效</th>
              <th class="w-36">生成模式 (gen_mode)</th>
              <th class="w-24">状态 / 版本</th>
              <th class="w-36">单镜节点操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, idx) in panels" :key="p.id"
              class="hover:bg-base-200/50 align-top"
              :class="selectedPanel === p.id ? 'bg-primary/5' : ''"
              @click="selectedPanel = p.id">
              <!-- 镜号 + 勾选 -->
              <td>
                <label class="flex items-center gap-1.5 cursor-pointer" @click.stop>
                  <input type="checkbox" class="checkbox checkbox-xs checkbox-primary"
                    :value="p.panelIdx ?? idx" v-model="batchSelectedIdxes" />
                  <span class="font-mono font-bold text-xs">
                    {{ p.sceneIdx !== undefined && p.shotIdx !== undefined ? `${p.sceneIdx + 1}-${p.shotIdx + 1}` : `V-${String(p.id).padStart(2, '0')}` }}
                  </span>
                </label>
              </td>
              <!-- 时长 -->
              <td>
                <span class="badge badge-xs badge-ghost font-mono">{{ p.durShort || 5 }}s</span>
              </td>
              <!-- 景别/机位/运镜 + 灯光/情绪 -->
              <td>
                <div class="flex flex-col gap-0.5 text-[10px]">
                  <span v-if="p.shot_size" class="badge badge-xs badge-soft badge-primary">{{ p.shot_size }}</span>
                  <span v-if="p.camera_angle" class="text-base-content/70">{{ p.camera_angle }}</span>
                  <span v-if="p.camera_movement" class="text-base-content/60">{{ p.camera_movement }}</span>
                  <span v-if="p.lighting" class="text-warning/80">💡 {{ p.lighting }}</span>
                  <span v-if="p.emotion" class="text-info/80">🎭 {{ p.emotion }}</span>
                </div>
              </td>
              <!-- 画面提示词 (image_prompt ?? start_prompt ?? scene) -->
              <td @click.stop>
                <textarea
                  class="textarea textarea-bordered textarea-xs w-full text-[11px] leading-snug"
                  rows="3"
                  :value="p.image_prompt || p.start_prompt || p.scene || ''"
                  placeholder="静态首帧构图提示词..."
                  @change="updateRowImagePrompt(p, ($event.target as HTMLTextAreaElement).value)"
                ></textarea>
              </td>
              <!-- 运动提示词 (motion_prompt ?? subject_motion ?? videoPrompt) -->
              <td @click.stop>
                <textarea
                  class="textarea textarea-bordered textarea-xs w-full text-[11px] leading-snug"
                  rows="3"
                  :value="p.motion_prompt || p.subject_motion || p.videoPrompt || ''"
                  placeholder="in→path→out 动态运动提示词..."
                  @change="updateRowMotionPrompt(p, ($event.target as HTMLTextAreaElement).value)"
                ></textarea>
              </td>
              <!-- 角色参考 -->
              <td>
                <div class="flex flex-wrap gap-1">
                  <template v-if="p.character_refs && p.character_refs.length">
                    <span v-for="(cref, ci) in p.character_refs" :key="ci"
                      class="badge badge-xs badge-outline gap-1" :title="cref.description || cref.name">
                      <img v-if="cref.image_url" :src="cref.image_url" class="w-3 h-3 rounded-full object-cover" />
                      {{ cref.name }}
                    </span>
                  </template>
                  <template v-else-if="p.roles.length">
                    <span v-for="r in p.roles" :key="r.id" class="badge badge-xs badge-outline">
                      {{ getRoleName(r) }}
                    </span>
                  </template>
                  <span v-else class="text-[10px] text-base-content/30">-</span>
                </div>
              </td>
              <!-- 参考帧/首帧缩略图 -->
              <td>
                <div class="w-20 aspect-video rounded bg-base-300 overflow-hidden relative">
                  <img v-if="p.firstFrameUrl || p.reference_frame_url"
                    :src="p.firstFrameUrl || p.reference_frame_url"
                    class="w-full h-full object-cover" />
                  <span v-else class="flex items-center justify-center h-full text-[9px] text-base-content/30">无首帧</span>
                </div>
              </td>
              <!-- 台词 / 音效 -->
              <td>
                <div class="text-[10px] space-y-0.5 max-w-[140px]">
                  <p v-for="(seg, si) in p.segments.slice(0, 2)" :key="si" class="truncate" :title="seg.text">
                    <strong v-if="seg.speaker">{{ seg.speaker }}:</strong> {{ seg.text }}
                  </p>
                  <p v-if="p.sound_effect" class="text-base-content/50 truncate" :title="p.sound_effect">
                    🔊 {{ p.sound_effect }}
                  </p>
                </div>
              </td>
              <!-- 生成模式 (gen_mode) -->
              <td @click.stop>
                <select class="select select-bordered select-xs w-full text-[11px]"
                  :value="p.gen_mode || (p.frame_mode === 'dual' ? 'frames2video' : 'singleImage2video')"
                  @change="updatePanelGenMode(p, ($event.target as HTMLSelectElement).value as VideoGenMode)">
                  <option v-for="m in availableVideoModes" :key="m" :value="m">
                    {{ VIDEO_GEN_MODE_LABELS[m] || m }}
                  </option>
                </select>
              </td>
              <!-- 状态三色点 + 版本抽屉入口 -->
              <td @click.stop>
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-1.5" title="图片 / 视频 / 配音 状态">
                    <span class="w-2 h-2 rounded-full" :class="p.firstFrameUrl ? 'bg-success' : 'bg-base-300'" title="首帧图"></span>
                    <span class="w-2 h-2 rounded-full" :class="p.finalVideoUrl ? (p.videoNeedsRerun ? 'bg-warning' : 'bg-success') : 'bg-base-300'" title="分镜视频"></span>
                    <span class="w-2 h-2 rounded-full" :class="p.ttsAudioUrl || p.segments.some(s => s.audioUrl) ? 'bg-success' : 'bg-base-300'" title="配音"></span>
                  </div>
                  <span v-if="p.videoNeedsRerun" class="badge badge-xs badge-warning">视频需重跑</span>
                  <button type="button" class="btn btn-ghost btn-xs px-1 text-[10px] justify-start"
                    @click="openVersionDrawer(p, 'first_frame')">
                    版本历史 ▾
                  </button>
                </div>
              </td>
              <!-- 行级单镜节点操作 -->
              <td @click.stop>
                <div class="flex flex-wrap gap-1">
                  <button type="button" class="btn btn-xs btn-outline btn-primary"
                    :disabled="p.panelStatus === 'generating'"
                    @click="runRowNode(p, 'image')">
                    出图
                  </button>
                  <button type="button" class="btn btn-xs btn-outline btn-secondary"
                    :disabled="p.panelStatus === 'generating'"
                    @click="runRowNode(p, 'video')">
                    出视频
                  </button>
                  <button type="button" class="btn btn-xs btn-outline btn-accent"
                    :disabled="p.panelStatus === 'generating'"
                    @click="runRowNode(p, 'audio')">
                    配音
                  </button>
                  <button v-if="p.finalVideoUrl" type="button" class="btn btn-xs btn-ghost"
                    :disabled="upscalingPanelIdx === (p.panelIdx ?? idx)"
                    title="FFmpeg Lanczos 超分至 1080P"
                    @click="onUpscalePanelVideo(p, '1080p')">
                    {{ upscalingPanelIdx === (p.panelIdx ?? idx) ? '超分中' : '超分' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ═══ 中栏：视频预览（卡片视图） ═══ -->
    <div v-else class="flex-1 min-w-0 flex flex-col bg-[#000000]">
      <div class="flex items-center justify-between px-5 py-3 border-b border-base-200 bg-base-100">
        <span class="text-sm font-bold flex items-center gap-1">
          分镜预览 <span class="text-primary">{{ selectedPanelData ? String(selectedPanelData.id).padStart(2, '0') : '--'
            }}</span>
          <span class="text-base-content/40 font-normal">/ {{ String(panels.length).padStart(2, '0') }}</span>
        </span>
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-xs text-base-content/50 font-medium">旁白：</span>
          <div class="w-28">
            <VoicePicker :model-value="narrationVoice" :options="voiceOptions" :voices="voices" label="旁白"
              @update:model-value="(v: string) => emit('update:narrationVoice', v)" />
          </div>
        </div>
      </div>

      <div class="relative w-full flex-1 min-h-0 flex flex-col items-center justify-center p-4">
        <!-- 视频模型与生成操作浮于预览右上角，不占用画面布局高度。 -->
        <div
          class="absolute top-7 right-7 z-40 flex flex-wrap items-center justify-end gap-2 max-w-[calc(100%-3.5rem)]">
          <div class="w-52 max-w-full min-w-0 rounded bg-base-100">
            <ModelPicker v-model="videoModel" v-model:resolution="videoResolution"
              v-model:cost="videoCost" model-type="video" :confirm-open="videoConfirm" :confirm-selected-count="1"
              :confirm-cost="videoCost" :confirm-resolution="videoResolution"
              confirm-title="确认生成分镜视频" :confirm-generating="isGenerating || submittingVideo"
              @confirm-close="videoConfirm = false" @confirm-submit="onGenerateVideo" />
          </div>
          <button class="btn btn-sm btn-soft btn-primary"
            :disabled="!selectedPanelData || isGenerating || submittingVideo || !videoModel"
            @click="confirmVideo">
            <span v-if="isGenerating" class="loading loading-spinner loading-xs"></span>
            <span v-else class="iconfont icon-a-zhinengti" aria-hidden="true"></span>
            AI 分镜视频
          </button>
        </div>
        <div class="w-full h-full bg-black rounded-xl relative flex items-center justify-center">
          <!-- 有最终视频：播放器 -->
          <div v-if="selectedPanelData?.finalVideoUrl" id="mse-video" class="w-full h-full"></div>
          <!-- 无最终视频：只展示首帧图片（生成中时模糊） -->
          <img v-else-if="selectedPanelData?.firstFrameUrl" :src="selectedPanelData.firstFrameUrl" alt="首帧"
            :class="selectedPanelData?.panelStatus === 'generating' ? 'blur-md opacity-40 scale-105' : ''"
            class="w-full h-full object-contain transition-all duration-500" />
          <div v-else class="text-sm">暂无画面</div>

          <!-- AI 生成分镜视频中：加载遮罩（毛玻璃模糊背景，覆盖播放器） -->
          <div v-if="selectedPanelData?.panelStatus === 'generating' && selectedPanelData?._task === 'video'"
            class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 pointer-events-none backdrop-blur-md bg-black/40">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <span class="text-sm text-white/80 font-medium">AI 生成分镜视频中...</span>
            <button class="btn btn-xs btn-ghost text-white/50 hover:text-white/90 pointer-events-auto"
              :disabled="resettingVideo" @click.stop="resetStuckVideo">
              {{ resettingVideo ? '重置中…' : '一直没反应？点此重置' }}
            </button>
          </div>


        </div>
      </div>
      <div v-if="selectedPanelData?.segments.length" class="shrink-0 px-4 py-3 border-t">
        <DialoguePlayback :key="selectedPanelData.id" ref="dialoguePlayer" :segments="selectedPanelData.segments"
          :characters="characters" @play="pauseVideo" />
      </div>
    </div>

    <!-- ═══ 右栏：分镜详情 ═══ -->
    <div class="w-[400px] shrink-0 border-l border-base-200 bg-base-100 flex flex-col">
      <template v-if="selectedPanelData">
        <div class="shrink-0 px-5 pt-5 pb-3 border-b border-base-200">
          <div class="flex items-center justify-between">
            <span class="text-sm font-bold">分镜描述</span>
            <span class="badge badge-sm badge-primary font-mono font-bold">V-{{ String(selectedPanelData.id).padStart(2,
              '0') }}</span>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <!-- 出镜角色 / 场景 / 道具 -->
          <div class="space-y-3">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">出镜角色</span>
                <button class="btn btn-ghost btn-xs btn-circle tooltip tooltip-left" data-tip="添加出镜角色"
                  :disabled="!characters.length || isGenerating" @click="openRolePicker">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <div class="flex flex-wrap gap-3">
                <template v-if="selectedPanelData.roles.length">
                  <div v-for="r in selectedPanelData.roles" :key="r.id"
                    class="relative flex flex-col items-center gap-1.5 w-18 group/role">
                    <button
                      class="absolute -top-1.5 -right-1.5 z-10 btn btn-xs btn-circle btn-error opacity-0 group-hover/role:opacity-100 transition-opacity tooltip tooltip-top"
                      data-tip="移除角色" :disabled="isGenerating" @click.stop="removeRole(r.id!)">
                      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <div class="avatar">
                      <div class="w-18 h-18 rounded-xl bg-base-200 overflow-hidden flex items-center justify-center">
                        <img v-if="roleImage(r)" :src="roleImage(r)" alt="角色形象" class="w-full h-full object-contain" />
                        <span v-else class="text-xl font-bold text-base-content/40">{{ getRoleName(r).slice(0, 1)
                          }}</span>
                      </div>
                    </div>
                    <span class="text-[11px] font-medium text-base-content/70 truncate w-full text-center"
                      :title="getRoleName(r)">{{ getRoleName(r) }}</span>
                  </div>
                </template>
                <span v-else class="text-[10px] text-base-content/25 italic">暂无</span>
              </div>
            </div>
            <div>
              <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">环境描写</span>
              <p class="text-[11px] text-base-content/60 leading-snug whitespace-pre-wrap">{{ selectedPanelData.environment || '-' }}</p>
            </div>
            <div>
              <span
                class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">画面描述</span>
              <p class="text-[11px] text-base-content/60 leading-snug">{{ selectedPanelData.scene || '-' }}</p>
            </div>
            <div>
              <label for="storyboard-transition" class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">本场 → 下一场的转场</label>
              <select id="storyboard-transition" :value="selectedPanelData.transition || ''"
                :disabled="isGenerating || savingTransition || !transitionOptions.length || selectedPanelData.sceneIdx === undefined"
                class="select select-bordered select-sm w-full text-xs rounded-lg" @change="updateTransition">
                <option value="" disabled>请选择切换方式</option>
                <option v-if="selectedPanelData.transition && !transitionOptions.includes(selectedPanelData.transition)"
                  :value="selectedPanelData.transition" disabled>{{ selectedPanelData.transition }}</option>
                <option v-for="option in transitionOptions" :key="option" :value="option">{{ option }}</option>
              </select>
            </div>
            <div v-if="selectedPanelData.subject_motion?.trim()">
              <span
                class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">主体运动</span>
              <p class="text-[11px] text-base-content/60 leading-snug whitespace-pre-wrap">{{ selectedPanelData.subject_motion }}</p>
            </div>
            <div v-if="selectedPanelData.key_prop_action?.trim()">
              <span
                class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">道具动作</span>
              <p class="text-[11px] text-base-content/60 leading-snug whitespace-pre-wrap">{{ selectedPanelData.key_prop_action }}</p>
            </div>
            <div>
              <span
                class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">跨镜不可逆状态锁（防止动作重做）</span>
              <input type="text" :value="selectedPanelData.world_state || ''" :disabled="isGenerating"
                class="input input-bordered input-xs w-full text-xs rounded-lg"
                placeholder="例如：木门已敞开（本镜继承该状态，禁止重置）"
                @change="updateShotText('world_state', ($event.target as HTMLInputElement).value)" />
            </div>
            <div>
              <span
                class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">镜头语言</span>
              <div class="flex flex-wrap gap-1.5">
                <div class="badge badge-sm badge-soft badge-primary">景别 {{ selectedPanelData.shot_size }}</div>·
                <div class="badge badge-sm badge-soft badge-primary">机位 {{ selectedPanelData.camera_angle }}</div>·
                <div class="badge badge-sm badge-soft badge-primary">运镜 {{ selectedPanelData.camera_movement }}</div>
                <div
                  v-if="!selectedPanelData.shot_size && !selectedPanelData.camera_angle && !selectedPanelData.camera_movement"
                  class="text-[10px] text-base-content/25 italic">暂无</div>
              </div>
            </div>
            <div>
              <span
                class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">道具</span>
              <StoryboardAssetBinding :assets="propAssets" :ids="selectedPanelData.prop_ids || []" multiple readonly />
            </div>
          </div>

          <div>
            <span class="text-xs text-base-content/50 block mb-2">场景</span>
            <StoryboardAssetBinding :assets="scenes"
              :ids="selectedPanelData.scene_id ? [selectedPanelData.scene_id] : []" readonly />

            <!-- ═══ 市场主流关键帧模式切换 & 跨镜无缝承接 ═══ -->
            <div class="mt-3 p-2.5 rounded-lg bg-base-200/60 border border-base-300 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] font-semibold text-base-content/60 uppercase tracking-wider">关键帧生成模式</span>
                <div class="join">
                  <button type="button" class="btn btn-xs join-item"
                    :class="activeFrameMode === 'single' ? 'btn-primary' : 'btn-ghost'"
                    :disabled="isGenerating"
                    title="市场主流模式：每镜仅生成 1 张主关键帧（积分省 50%），动作由视频模型自然演进，彻底消除首尾帧对不齐与动作重置"
                    @click="setFrameMode('single')">
                    主流单关键帧（推荐）
                  </button>
                  <button type="button" class="btn btn-xs join-item"
                    :class="activeFrameMode === 'dual' ? 'btn-primary' : 'btn-ghost'"
                    :disabled="isGenerating"
                    title="传统首尾双帧模式：同时约束起点与终点构图，适合特定高难度定点变形镜头"
                    @click="setFrameMode('dual')">
                    首尾双帧
                  </button>
                </div>
              </div>
              <p class="text-[10px] text-base-content/50 leading-relaxed">
                {{ activeFrameMode === 'single'
                  ? '单张主关键帧 + 视频动作演进（I2V）：避免首尾两张静态图对不齐导致画面闪烁或开门动作重做，重绘积分减半。'
                  : '首尾双帧插值：同时生成首帧与尾帧两张图，若首尾构图跨度过大易出现伪影。' }}
              </p>
              <div v-if="prevPanelData && (prevPanelData.finalVideoUrl || prevPanelData.lastFrameUrl || prevPanelData.firstFrameUrl)"
                class="flex flex-wrap items-center gap-1.5 pt-1 border-t border-base-300/60">
                <button v-if="prevPanelData.finalVideoUrl" type="button"
                  class="btn btn-xs btn-outline btn-primary flex-1"
                  :disabled="isGenerating || inheritingPrevFrame"
                  title="用 FFmpeg 从上一镜已生成的视频截取真实最后一帧作为本镜首帧，100% 像素级无缝衔接（如上一镜门已打开，本镜直接从门开状态继续）"
                  @click="onInheritPrevFrame(true)">
                  <span v-if="inheritingPrevFrame" class="loading loading-spinner loading-xs"></span>
                  截取上一镜视频末帧作首帧
                </button>
                <button v-if="prevPanelData.lastFrameUrl || prevPanelData.firstFrameUrl" type="button"
                  class="btn btn-xs btn-ghost"
                  :disabled="isGenerating || inheritingPrevFrame"
                  title="直接复用上一镜的关键帧图片作为本镜首帧"
                  @click="onInheritPrevFrame(false)">
                  复用上一镜画面
                </button>
              </div>
            </div>

            <div class="grid gap-2 mt-3" :class="activeFrameMode === 'dual' ? 'grid-cols-2' : 'grid-cols-1'">
              <div class="min-w-0">
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-[10px] font-semibold text-base-content/40">
                    {{ activeFrameMode === 'single' ? '主关键帧（首帧图）' : '首帧图' }}
                  </span>
                  <span v-if="selectedPanelData.frame_mode === 'video_tail'"
                    class="badge badge-xs badge-success badge-soft">承接上镜视频末帧</span>
                </div>
                <figure class="aspect-video rounded-lg overflow-hidden bg-base-200 border border-base-300">
                  <ImageViewer v-if="selectedPanelData.firstFrameUrl" :src="selectedPanelData.firstFrameUrl"
                    :images="selectedFrameImages" :title="activeFrameMode === 'single' ? '主关键帧（首帧）' : '首帧图'" class="w-full h-full">
                    <img :src="selectedPanelData.firstFrameUrl" alt="分镜首帧" class="w-full h-full object-contain" />
                  </ImageViewer>
                  <div v-else
                    class="w-full h-full flex items-center justify-center text-[10px] text-base-content/30">
                    未生成关键帧
                  </div>
                </figure>
              </div>
              <div v-if="activeFrameMode === 'dual'" class="min-w-0">
                <span class="text-[10px] font-semibold text-base-content/40 block mb-1.5">尾帧图</span>
                <figure class="aspect-video rounded-lg overflow-hidden bg-base-200 border border-base-300">
                  <ImageViewer v-if="selectedPanelData.lastFrameUrl" :src="selectedPanelData.lastFrameUrl"
                    :images="selectedFrameImages" title="尾帧图" class="w-full h-full">
                    <img :src="selectedPanelData.lastFrameUrl" alt="分镜尾帧" class="w-full h-full object-contain" />
                  </ImageViewer>
                  <div v-else
                    class="w-full h-full flex items-center justify-center text-[10px] text-base-content/30">
                    未生成尾帧
                  </div>
                </figure>
              </div>
            </div>
          </div>
          <div>
            <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">音效</span>
            <textarea :value="selectedPanelData.sound_effect || ''" :disabled="isGenerating"
              class="textarea textarea-bordered textarea-sm w-full text-xs leading-relaxed rounded-lg resize-none"
              rows="2" placeholder="音效..." @change="updateShotText('sound_effect', ($event.target as HTMLTextAreaElement).value)"></textarea>
          </div>
          <label class="form-control w-full max-w-[100px]">
            <div class="label p-0 mb-1"><span
                class="label-text text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">转视频时长（秒）</span>
            </div>
            <input type="number" :value="selectedPanelData.durShort || 5" min="3" max="15" :disabled="isGenerating"
              class="input input-bordered input-sm text-sm rounded-lg"
              @change="(e: any) => updateDur(parseInt(e.target.value))" />
          </label>
          <label class="label cursor-pointer justify-start gap-2 p-0"
            title="打开后，生成某一镜时会把它的上一镜成片一起发给视频模型，让运动方向与节奏接得上；供应商限制「输入 + 输出 ≤ 30 秒」，超长会自动裁上一镜的末段。作品级开关，对所有分镜生效">
            <input type="checkbox" class="toggle toggle-xs toggle-primary"
              :checked="Number(usePrevVideo || 0) === 1"
              @change="toggleUsePrevVideo(($event.target as HTMLInputElement).checked)" />
            <span class="label-text text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">
              参考上一镜视频（本作品）
            </span>
          </label>

          <div class="divider my-2"></div>

          <!-- LibTV 生成模式与多版本/超分入口 -->
          <div class="p-2.5 rounded-lg bg-base-200/50 border border-base-300 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-semibold text-base-content/60 uppercase tracking-wider">视频生成模式 (gen_mode)</span>
              <button type="button" class="btn btn-xs btn-outline"
                @click="openVersionDrawer(selectedPanelData, 'first_frame')">
                多版本历史 (shot_assets)
              </button>
            </div>
            <select class="select select-bordered select-xs w-full text-xs"
              :value="selectedPanelData.gen_mode || (selectedPanelData.frame_mode === 'dual' ? 'frames2video' : 'singleImage2video')"
              :disabled="isGenerating"
              @change="updatePanelGenMode(selectedPanelData, ($event.target as HTMLSelectElement).value as VideoGenMode)">
              <option v-for="m in availableVideoModes" :key="m" :value="m">
                {{ VIDEO_GEN_MODE_LABELS[m] || m }}
              </option>
            </select>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <span class="text-[10px] text-base-content/40 block mb-0.5">灯光 (lighting)</span>
                <input type="text" class="input input-bordered input-xs w-full text-xs"
                  :value="selectedPanelData.lighting || ''" :disabled="isGenerating"
                  placeholder="如：逆光冷调"
                  @change="updateShotText('lighting', ($event.target as HTMLInputElement).value)" />
              </div>
              <div>
                <span class="text-[10px] text-base-content/40 block mb-0.5">情绪 (emotion)</span>
                <input type="text" class="input input-bordered input-xs w-full text-xs"
                  :value="selectedPanelData.emotion || ''" :disabled="isGenerating"
                  placeholder="如：压抑紧绷"
                  @change="updateShotText('emotion', ($event.target as HTMLInputElement).value)" />
              </div>
            </div>
            <div v-if="selectedPanelData.finalVideoUrl" class="flex items-center justify-between pt-1 border-t border-base-300/60">
              <span class="text-[10px] text-base-content/50">单镜视频高清超分：</span>
              <div class="join">
                <button type="button" class="btn btn-xs join-item btn-ghost"
                  :disabled="upscalingPanelIdx !== null"
                  @click="onUpscalePanelVideo(selectedPanelData, '1080p')">1080P</button>
                <button type="button" class="btn btn-xs join-item btn-ghost"
                  :disabled="upscalingPanelIdx !== null"
                  @click="onUpscalePanelVideo(selectedPanelData, '2k')">2K</button>
                <button type="button" class="btn btn-xs join-item btn-ghost"
                  :disabled="upscalingPanelIdx !== null"
                  @click="onUpscalePanelVideo(selectedPanelData, '4k')">4K</button>
              </div>
            </div>
          </div>

          <div>
            <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">
              画面提示词 (image_prompt / 静态首帧构图)
            </span>
            <textarea :value="selectedPanelData.image_prompt || selectedPanelData.start_prompt || ''" :disabled="isGenerating"
              class="textarea w-full"
              rows="3" placeholder="关键帧（首帧）静态画面构图提示词..." @change="updateShotText('image_prompt', ($event.target as HTMLTextAreaElement).value)"></textarea>
          </div>
          <div v-if="activeFrameMode === 'dual'">
            <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">尾帧提示词</span>
            <textarea :value="selectedPanelData.end_prompt || ''" :disabled="isGenerating"
              class="textarea w-full"
              rows="3" placeholder="尾帧提示词..." @change="updateShotText('end_prompt', ($event.target as HTMLTextAreaElement).value)"></textarea>
          </div>

          <div>
            <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">
              运动提示词 (motion_prompt / in→path→out 动态演进)
            </span>
            <textarea :disabled="isGenerating"
              class="textarea w-full"
              rows="5" :value="selectedPanelData.motion_prompt || selectedPanelData.videoPrompt || ''" placeholder="分镜生视频动态提示词..."
              @change="(e: any) => updateVideoPrompt(e.target.value)"></textarea>
          </div>
          <div>
            <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider block mb-1.5">负面提示词</span>
            <textarea :value="selectedPanelData.negative_prompt || ''" :disabled="isGenerating"
              class="textarea w-full"
              rows="3" placeholder="负面提示词..." @change="updateShotText('negative_prompt', ($event.target as HTMLTextAreaElement).value)"></textarea>
          </div>
        </div>

      </template>
      <template v-else>
        <div class="flex-1 flex items-center justify-center text-base-content/20 text-sm">选择分镜查看详情</div>
      </template>
    </div>

    <CharacterSelect :open="showRolePicker" :characters="characters" :selected-ids="pickedRoleIds"
      @update:open="showRolePicker = $event" @update:selected-ids="pickedRoleIds = $event"
      @confirm="confirmRolePicker" />

    <!-- ═══ 版本对比与切换抽屉 (F2) ═══ -->
    <div v-if="versionDrawerOpen" class="fixed inset-0 z-50 flex justify-end bg-black/40" @click.self="versionDrawerOpen = false">
      <div class="w-[460px] max-w-full h-full bg-base-100 border-l border-base-300 flex flex-col shadow-2xl">
        <div class="px-5 py-3.5 border-b border-base-200 flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold">
              分镜资产多版本历史
              <span v-if="versionDrawerPanel" class="text-primary font-mono ml-1">
                #{{ versionDrawerPanel.id }}
              </span>
            </h3>
            <p class="text-[10px] text-base-content/50">每次重绘/生视频均保留历史版本，可随时一键回退或切换</p>
          </div>
          <button type="button" class="btn btn-ghost btn-xs btn-circle" @click="versionDrawerOpen = false">✕</button>
        </div>

        <div class="px-5 py-2 border-b border-base-200 flex items-center gap-2">
          <button type="button" class="btn btn-xs"
            :class="versionDrawerTab === 'first_frame' ? 'btn-primary' : 'btn-ghost'"
            @click="versionDrawerTab = 'first_frame'">
            关键帧图片
          </button>
          <button type="button" class="btn btn-xs"
            :class="versionDrawerTab === 'video' ? 'btn-primary' : 'btn-ghost'"
            @click="versionDrawerTab = 'video'">
            分镜视频
          </button>
          <button type="button" class="btn btn-xs"
            :class="versionDrawerTab === 'tts' ? 'btn-primary' : 'btn-ghost'"
            @click="versionDrawerTab = 'tts'">
            配音音频
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-if="versionLoading" class="flex items-center justify-center py-12 text-xs text-base-content/50">
            <span class="loading loading-spinner loading-sm mr-2"></span>加载版本记录中...
          </div>
          <div v-else-if="!filteredVersions.length" class="text-center py-12 text-xs text-base-content/40">
            暂无该类型的历史版本记录
          </div>
          <div v-else v-for="ver in filteredVersions" :key="ver.id"
            class="p-3 rounded-xl border transition-colors"
            :class="ver.is_current === 1 ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-200/40'">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="badge badge-sm font-mono" :class="ver.is_current === 1 ? 'badge-primary' : 'badge-ghost'">
                  v{{ ver.version }}
                </span>
                <span v-if="ver.is_current === 1" class="badge badge-xs badge-success">当前启用</span>
                <span v-if="ver.model" class="text-[10px] text-base-content/50">{{ ver.model }}</span>
                <span v-if="ver.gen_mode" class="badge badge-xs badge-outline">{{ ver.gen_mode }}</span>
              </div>
              <button v-if="ver.is_current !== 1 && ver.status === 'completed' && ver.url"
                type="button" class="btn btn-xs btn-primary"
                @click="switchAssetVersion(ver)">
                设为当前版本
              </button>
            </div>
            <div v-if="ver.url" class="rounded-lg overflow-hidden bg-black aspect-video mb-2">
              <img v-if="ver.asset_type === 'first_frame' || ver.asset_type === 'last_frame'"
                :src="ver.url" class="w-full h-full object-contain" />
              <video v-else-if="ver.asset_type === 'video'" :src="ver.url" controls class="w-full h-full object-contain"></video>
              <div v-else class="flex items-center justify-center h-full p-3">
                <audio :src="ver.url" controls class="w-full"></audio>
              </div>
            </div>
            <p v-if="ver.prompt" class="text-[10px] text-base-content/60 line-clamp-2">{{ ver.prompt }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import type { Segment } from '@/utils/segments'
import { chaptersApi, type PanelPatch } from '@/api/chapters'
import { get } from '@/api/request'
import { listTasks } from '@/api/task'
import { useWorkflowTimeline, type TimelineStep } from '@/composables/useWorkflowTimeline'
import { useTaskRecovery } from '@/composables/useTaskRecovery'
import WorkflowTimeline from '@/components/WorkflowTimeline.vue'
import DialogueEditor from '@/components/DialogueEditor.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import StoryboardAssetBinding from '@/components/StoryboardAssetBinding.vue'
import type { PersonaItem } from '@/api/personas'
import type { StoryScene, ShotPatch } from '@/utils/storyboard'
import { dialogueToSegments, segmentsToDialogue } from '@/utils/storyboard-panels'

interface CharacterItem { id?: number; name: string; images?: { url?: string }[] }

interface Panel {
  scene_id?: number | null
  prop_ids?: number[]
  refImageUrl?: string[]
  videoPrompt?: string
  id: number
  scene: string
  roles: { id?: number; name?: string }[]
  segments: Segment[]
  durShort: number
  panelIdx?: number
  shot_size?: string
  camera_angle?: string
  camera_movement?: string
  /** 镜头级切换方式：本镜 → 下一镜（为空时按场景级兜底） */
  transition?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  finalVideoUrl?: string
  panelStatus?: string
  _editingScene?: boolean
  sceneIdx?: number
  shotIdx?: number
}

// ── props：父级拥有且多个 tab 共用的数据（分镜、角色、作品/章节信息） ──
const props = defineProps<{
  panels: Panel[]
  characters: CharacterItem[]
  assets: PersonaItem[]
  workId: number
  chapterId: number
  chapterContent: string
  /** AI 文本模型（VideoStoryboard header 选择） */
  model: string
  /** 当前文本模型单次消耗积分 */
  modelCost?: number
}>()

// AI 提取完成后，父级需要从服务端重新拉取 panels（panels 由多个 tab 共用）
const emit = defineEmits<{
  'load-panels': []
  /** 向 VideoStoryboard header 注册本步骤主操作（AI 提取分镜） */
  'register-action': [action: { label: string; run: () => void } | null]
}>()
const { show: showToast } = useToast()
const sceneGroups = computed(() => props.panels as unknown as StoryScene[])
const hasSceneGroups = computed(() => props.panels.length > 0 && props.panels.every(p => Array.isArray((p as unknown as StoryScene).shots)))
// 新数据仅在数据层展平，继续使用原表格和对白编辑器。
const tablePanels = ref<Panel[]>([])
watch(() => props.panels, () => {
  tablePanels.value = hasSceneGroups.value ? sceneGroups.value.flatMap((scene, sceneIdx) =>
    scene.shots.map((shot, shotIdx) => ({
      id: 0, sceneIdx, shotIdx, scene: shot.content, roles: (shot.roles || []).map(role => ({ ...role, id: Number(role.id) })), durShort: shot.durShort || 5,
      scene_id: scene.scene_id == null ? null : Number(scene.scene_id),
      prop_ids: (scene.prop_ids || []).map(Number),
      shot_size: shot.shot_size, camera_angle: shot.camera_angle, camera_movement: shot.camera_movement,
      transition: shot.transition || '',
      segments: dialogueToSegments(shot.dialogue),
    })),
  ).map((panel, index) => ({ ...panel, id: index + 1 })) : props.panels
}, { immediate: true })
const scenes = computed(() => props.assets.filter(asset => asset.source_type === 'scene' && asset.chapters_id === props.chapterId))
const propAssets = computed(() => props.assets.filter(asset => asset.source_type === 'prop' && asset.work_id === props.workId))

// 注册主操作：AI 提取分镜
onMounted(() => emit('register-action', { label: 'AI 提取分镜', run: openBreakdownConfirm }))
onUnmounted(() => emit('register-action', null))

// ── 时长统计（按展平后的分镜累加，分组与扁平两种形态都覆盖） ──
const totalDuration = computed(() =>
  tablePanels.value.reduce((sum, p) => sum + (Number(p.durShort) || 5), 0),
)

// ── AI 提取分镜（请求逻辑 + 时间链状态全部在组件内部） ──
const breakingDown = ref(false)
const tl = useWorkflowTimeline()
const showBreakdownConfirm = ref(false)
const breakdownConfirmMessage = computed(() => [
  `文本模型：${props.model || '未选择'}`,
  `本次预计消耗：${props.modelCost || 0} 积分`,
  '将根据当前章节内容重新拆分分镜，并保存到本章节。',
].join('\n'))

function openBreakdownConfirm() {
  if (breakingDown.value) return
  if (!props.workId || !props.chapterId || !props.chapterContent?.trim()) {
    showToast('章节内容为空，无法提取分镜', 'info')
    return
  }
  if (!props.model) {
    showToast('请先在顶部选择文本模型', 'info')
    return
  }
  showBreakdownConfirm.value = true
}

function confirmBreakdown() {
  showBreakdownConfirm.value = false
  onBreakdown()
}

// ── AI 提取分镜（请求逻辑 + 时间链状态全部在组件内部） ──
async function onBreakdown() {
  if (breakingDown.value) return
  if (!props.workId || !props.chapterId || !props.chapterContent) return
  if (!props.model) {
    showToast('请先在顶部选择文本模型', 'info')
    return
  }
  // taskId 由服务端首条事件下发（用于流中断后对账）；errored 避免失败提示重复
  let taskId = ''
  let errored = false
  breakingDown.value = true
  tl.restore(STORYBOARD_STEPS.map(step => ({ ...step })))
  try {
    const token = localStorage.getItem('token') || ''
    const base = import.meta.env.VITE_API_BASE_URL || '/api'
    const res = await fetch(`${base}/agent/storyboard-breakdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, aiModel: props.model },
      body: JSON.stringify({ text: props.chapterContent, workId: props.workId, chapterId: props.chapterId }),
    })
    if (!res.ok) throw new Error(`提取分镜请求失败（${res.status}）`)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No stream')
    const decoder = new TextDecoder()
    let buffer = ''
    let streamFinished = false
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6)
        if (payload === '[DONE]') {
          streamFinished = true
          break
        }
        let chunk: any
        try { chunk = JSON.parse(payload) } catch { continue }
        if (chunk.error || chunk.type === 'error' || chunk.type === 'failed' || chunk.type === 'workflow-step-error')
          throw new Error(chunk.error || chunk.payload?.message || chunk.message || chunk.result || '分镜提取失败')
        if (chunk.type === 'task' && typeof chunk.taskId === 'string') { taskId = chunk.taskId; continue }
        if (chunk.type === 'workflow-step-start') tl.setRunning(chunk.payload?.stepName || chunk.payload?.id)
        else if (chunk.type === 'workflow-step-result') tl.setDone(chunk.payload?.stepName || chunk.payload?.id)
      }
      if (streamFinished) break
    }
    // 工作流完成后通知父级从服务端重新加载分镜数据
    emit('load-panels')
  } catch (e: any) {
    errored = true
    tl.setFailed()
    showToast(e.message || '提取分镜失败', 'error')
    console.error('提取分镜失败:', e.message)
  } finally {
    breakingDown.value = false
    // 长任务（十几分钟）的 SSE 连接可能中途断开，而弹窗只在全部完成/失败时才自动隐藏：
    // 这里以服务端任务状态对账，避免分镜其实已保存、弹窗却永久停在“进行中”
    if (!tl.allDone()) await reconcileBreakdown(taskId, errored)
  }
}

/**
 * 流结束后的对账：服务端任务已完成时补齐步骤状态（弹窗随即自动隐藏）；
 * 失败时标记失败；仍在后台执行时明确告知可稍后刷新查看。
 */
async function reconcileBreakdown(taskId: string, alreadyReported: boolean) {
  try {
    const tasks = await listTasks()
    const task = taskId ? tasks.find(t => t.taskId === taskId) : tasks.find(t => t.type === 'novelScript')
    if (!task) return
    if (task.status === 'done') {
      tl.finishAll()
      emit('load-panels')
      return
    }
    if (task.status === 'failed') {
      tl.setFailed()
      if (!alreadyReported) showToast('分镜提取失败，请重试', 'error')
      return
    }
    showToast('任务仍在后台执行，完成后刷新页面即可看到结果', 'info')
  } catch { /* 对账失败不影响主流程 */ }
}

// 页面刷新 / 跳转后的 storyboard 任务恢复
const STORYBOARD_STEPS: TimelineStep[] = [
  { name: "write-chapter-script-step", label: "章节剧本化改写中...", status: "wait" },
  { name: "extract-novel-script-step", label: "提取小说剧本中...", status: "wait" },
  { name: "save-novel-script-step", label: "保存剧本中...", status: "wait" },
]
useTaskRecovery(
  () => { }, // 本工作流无流式正文
  () => {
    tl.hide()
    emit('load-panels') // 恢复完成时，分镜数据可能已由后端创建，通知父级刷新
  },
  (meta) => { tl.restore(meta.steps || []) },
  (id) => { tl.setRunning(id) },
  (id) => { tl.setDone(id) },
  {
    types: ['novelScript'],
    onStepProgress: (name, label) => {
      const step = tl.steps.value.find(s => s.name === name)
      if (step) step.label = label
    },
    steps: STORYBOARD_STEPS,
    onError: (err) => {
      tl.setFailed()
      showToast(err.message || '提取分镜失败', 'error')
    },
  },
)

// ── 增量保存单个分镜，避免把生成结果和历史记录整章回传 ──
function editablePanelData(p: Panel): PanelPatch {
  return {
    environment: p.scene,
    videoPrompt: p.videoPrompt || '',
    roles: p.roles.flatMap(r => r.id == null ? [] : [{ id: r.id }]),
    durShort: p.durShort || 5,
    shot_size: p.shot_size || '',
    camera_angle: p.camera_angle || '',
    camera_movement: p.camera_movement || '',
    segments: p.segments || [],
  }
}

async function savePanel(panel: Panel, changes: PanelPatch = editablePanelData(panel)) {
  if (!props.workId || !props.chapterId) return
  if (panel.sceneIdx !== undefined && panel.shotIdx !== undefined) {
    const scene = sceneGroups.value[panel.sceneIdx]
    const patch: ShotPatch = {}
    if ('environment' in changes) patch.content = changes.environment
    for (const field of ['shot_size', 'camera_angle', 'camera_movement', 'transition'] as const) {
      if (field in changes) patch[field] = changes[field]
    }
    if ('segments' in changes) patch.dialogue = segmentsToDialogue(panel.segments)
    try {
      await chaptersApi.updateShot(props.workId, props.chapterId, panel.sceneIdx, panel.shotIdx, patch)
      Object.assign(scene.shots[panel.shotIdx], patch)
    } catch (error: any) {
      showToast(error.message || '保存分镜失败', 'error')
      emit('load-panels')
    }
    return
  }
  const panelIdx = panel.panelIdx ?? props.panels.indexOf(panel)
  if (panelIdx < 0) throw new Error('无法定位分镜')
  await chaptersApi.updatePanel(props.workId, props.chapterId, panelIdx, changes)
}

// ── 删除分镜（服务端按数据形态分发到 scenes/shots 或 panels，并重排其后索引） ──
const showRemoveConfirm = ref(false)
const removeTarget = ref<Panel | null>(null)
const removing = ref(false)

function askRemovePanel(panel: Panel) {
  removeTarget.value = panel
  showRemoveConfirm.value = true
}

const removeConfirmMessage = computed(() => {
  const p = removeTarget.value
  if (!p) return ''
  const text = (p.scene || '').trim()
  const brief = text.length > 40 ? `${text.slice(0, 40)}…` : text
  return `确定删除镜号 ${p.id}${brief ? `（${brief}）` : ''} 吗？删除后不可恢复，其余镜头编号会自动前移。`
})

async function confirmRemovePanel() {
  const p = removeTarget.value
  if (!p || removing.value) return
  removing.value = true
  try {
    await chaptersApi.removeStoryboardPanel({
      workId: props.workId,
      chapterId: props.chapterId,
      sceneIdx: p.sceneIdx,
      shotIdx: p.shotIdx,
      panelIdx: p.panelIdx,
    })
    showToast('已删除该镜头', 'success')
    showRemoveConfirm.value = false
    removeTarget.value = null
    emit('load-panels')
  } catch (e: any) {
    console.error('删除分镜失败', e)
    showToast(e.message || '删除分镜失败', 'error')
  } finally {
    removing.value = false
  }
}

// ── 时长调整（内部修改并持久化） ──
function adjustDur(idx: number, delta: number) {
  const p = tablePanels.value[idx]
  if (!p) return
  // 分组与扁平两种形态都能定位到分镜：savePanel 内部按 sceneIdx/shotIdx 或 panelIdx 分流
  p.durShort = Math.max(3, Math.min(15, (p.durShort || 5) + delta))
  void savePanel(p, { durShort: p.durShort })
}

// ── 镜头语言枚举（景别/机位/运镜，来自 GET /chapter/enums） ──
interface ShotEnums { shot_size: string[]; camera_angle: string[]; camera_movement: string[]; transition: string[] }
const shotSizeOptions = ref<string[]>([])
const cameraAngleOptions = ref<string[]>([])
const cameraMovementOptions = ref<string[]>([])
const transitionOptions = ref<string[]>([])

async function loadShotEnums() {
  try {
    const enums = await get<ShotEnums>('/settings/chapter/enums')
    shotSizeOptions.value = enums.shot_size || []
    cameraAngleOptions.value = enums.camera_angle || []
    cameraMovementOptions.value = enums.camera_movement || []
    transitionOptions.value = enums.transition || []
  } catch (e: any) {
    console.error('加载镜头语言枚举失败:', e?.message || e)
  }
}
onMounted(loadShotEnums)

// 修改镜头语言并持久化
function onShotSizeChange(p: Panel, v: string) { p.shot_size = v; void savePanel(p, { shot_size: v }) }
function onCameraAngleChange(p: Panel, v: string) { p.camera_angle = v; void savePanel(p, { camera_angle: v }) }
function onCameraMovementChange(p: Panel, v: string) { p.camera_movement = v; void savePanel(p, { camera_movement: v }) }
/** 镜头级切换方式：本镜 → 下一镜（合成时优先于场景级转场） */
function onTransitionChange(p: Panel, v: string) { p.transition = v; void savePanel(p, { transition: v }) }
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="w-[95vw] mx-auto space-y-4">
      <!-- 分镜表格 -->
      <div class="overflow-x-auto rounded-xl border border-base-200">
      <table class="table table-sm table-zebra w-full min-w-[1280px]">
        <thead>
          <tr class="text-[10px] uppercase tracking-widest text-base-content/40 bg-base-200/40">
            <th class="w-14">镜号（{{ tablePanels.length }}个）</th>
            <th class="w-20">时长（{{ totalDuration }}s）</th>
            <th class="w-28">景别</th>
            <th class="w-32">机位</th>
            <th class="w-28">运镜</th>
            <th class="w-28">切换（→下一镜）</th>
            <th class="min-w-[200px]">画面描述（点击编辑）</th>
            <th class="min-w-[140px]">场景</th>
            <th class="min-w-[140px]">道具</th>
            <th class="min-w-[240px]">对白 · 旁白</th>
            <th class="w-16">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in tablePanels" :key="p.id" class="align-top transition-colors duration-150 hover:bg-base-300">
            <!-- 镜号 -->
            <td>
              <span class="badge badge-sm text-primary">{{ p.id }}</span>
            </td>
            <!-- 时长 -->
            <td>
              <div class="flex items-center gap-1">
                <button
                  class="btn btn-ghost btn-xs w-6 h-6 min-h-0 p-0 rounded-lg text-base-content/50 hover:text-primary hover:bg-primary/10"
                  @click.stop="adjustDur(i, -1)">−</button>
                <span class="text-sm font-mono font-bold text-primary tabular-nums">{{ p.durShort || 5 }}s</span>
                <button
                  class="btn btn-ghost btn-xs w-6 h-6 min-h-0 p-0 rounded-lg text-base-content/50 hover:text-primary hover:bg-primary/10"
                  @click.stop="adjustDur(i, 1)">+</button>
              </div>
            </td>
            <!-- 景别 -->
            <td>
              <select :value="p.shot_size || ''" class="select select-bordered select-xs w-full text-xs"
                @change="onShotSizeChange(p, ($event.target as HTMLSelectElement).value)">
                <option value="">—</option>
                <option v-for="opt in shotSizeOptions" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </td>
            <!-- 机位 -->
            <td>
              <select :value="p.camera_angle || ''" class="select select-bordered select-xs w-full text-xs"
                @change="onCameraAngleChange(p, ($event.target as HTMLSelectElement).value)">
                <option value="">—</option>
                <option v-for="opt in cameraAngleOptions" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </td>
            <!-- 运镜 -->
            <td>
              <select :value="p.camera_movement || ''" class="select select-bordered select-xs w-full text-xs"
                @change="onCameraMovementChange(p, ($event.target as HTMLSelectElement).value)">
                <option value="">—</option>
                <option v-for="opt in cameraMovementOptions" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </td>
            <!-- 切换方式（本镜 → 下一镜）：留空则合成时按"跨场景用场景转场、同场景硬切"兜底 -->
            <td>
              <select :value="p.transition || ''" class="select select-bordered select-xs w-full text-xs"
                :title="p.transition ? `本镜 → 下一镜：${p.transition}` : '未设置：跨场景用场景转场、同场景硬切'"
                @change="onTransitionChange(p, ($event.target as HTMLSelectElement).value)">
                <option value="">自动</option>
                <option v-for="opt in transitionOptions" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </td>
            <!-- 画面描述（点击编辑） -->
            <td class="max-w-[250px]">
              <textarea v-if="p._editingScene" v-model="p.scene"
                class="textarea textarea-bordered textarea-xs w-full text-sm bg-base-100 text-base-content" rows="2"
                @blur="p._editingScene = false; savePanel(p, { environment: p.scene })"
                @keydown.escape="p._editingScene = false"></textarea>
              <span v-else
                class="text-sm text-base-content/80 cursor-pointer hover:text-primary transition-colors block whitespace-pre-wrap"
                @click="p._editingScene = true">{{ p.scene || '—' }}</span>
            </td>
            <!-- 对白 / 旁白（DialogueEditor：@ 选角色或旁白，可编辑） -->
            <td>
              <StoryboardAssetBinding :assets="scenes" :ids="p.scene_id ? [p.scene_id] : []" readonly />
            </td>

            <td>
              <StoryboardAssetBinding :assets="propAssets" :ids="p.prop_ids || []" multiple readonly />
            </td>
            <td class="relative">
              <DialogueEditor :segments="p.segments || []" :characters="characters"
                @save="savePanel(p, { segments: p.segments || [] })" />
            </td>
            <!-- 删除本镜头 -->
            <td>
              <button class="btn btn-ghost btn-xs text-error hover:bg-error/10"
                :disabled="p.panelStatus === 'generating'"
                :title="p.panelStatus === 'generating' ? '生成中，请等待完成后再删除' : '删除该镜头'"
                @click.stop="askRemovePanel(p)">删除</button>
            </td>
          </tr>
          <tr v-if="!tablePanels.length">
            <td colspan="11" class="text-center py-10 text-base-content/25 italic text-sm">暂无分镜，点击右上角「AI 提取分镜」自动拆分</td>
          </tr>
        </tbody>
      </table>
      </div>

    </div>
  </div>

  <!-- 时间链：分镜拆分的 workflow 进度提示 -->
  <WorkflowTimeline />

  <ConfirmModal v-model:open="showBreakdownConfirm" title="确认提取分镜" :message="breakdownConfirmMessage"
    confirm-text="确认提取" @confirm="confirmBreakdown" />

  <ConfirmModal v-model:open="showRemoveConfirm" title="确认删除分镜" :message="removeConfirmMessage"
    confirm-text="删除" @confirm="confirmRemovePanel" />
</template>

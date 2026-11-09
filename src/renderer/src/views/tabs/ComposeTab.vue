<script setup lang="ts">
/**
 * 作品合成 tab：把勾选的分镜视频按顺序重编码拼接为一个成品 MP4。
 *
 * 数据自己拉取（worksApi.detail），"可勾选"规则与后端一致：只有未生成视频的段不可选
 * （场景最后一个镜头同样参与视频生成——它的尾帧是按本镜动作演完的终态单独出图的）。
 * 合成是后台任务（POST /agent/compose，携带勾选的 panelIdxes）：这里按 taskId 轮询进度、展示成品与下载。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import { worksApi } from '@/api/works'
import { chaptersApi } from '@/api/chapters'
import { listTasks } from '@/api/task'
import { useToast } from '@/composables/useToast'

interface ComposePanel {
  id: number
  panelIdx: number
  sceneIdx: number
  label: string
  content: string
  durShort: number
  finalVideoUrl: string
  firstFrameUrl: string
  /** 所属场景的转场（本场景 → 下一场景） */
  sceneTransition: string
  /** 镜头级切换方式（本镜 → 下一镜）；为空表示按场景级兜底 */
  transition: string
  /** LibTV 时间线：原片截取起点 (s) */
  sourceOffset: number
  /** LibTV 时间线：原片截取时长 (s) */
  sourceDuration: number
  /** LibTV 时间线：单段音量增益 (-60 ~ +20 dB) */
  decibel: number
  /** 不可勾选的原因；无则不限制 */
  blocked?: 'no-video'
}

const props = defineProps<{
  workId: number
  chapterId: number
  workTitle: string
  chapterTitle: string
}>()

const emit = defineEmits<{
  'register-action': [action: { label: string; run: () => void } | null]
}>()

const { show: showToast } = useToast()

// ── 章节数据：分镜清单 + 已有成品 ──
const loading = ref(true)
const panels = ref<ComposePanel[]>([])
const composedUrl = ref('')

async function loadChapter() {
  if (!props.workId || !props.chapterId) return
  try {
    const data: any = await worksApi.detail(props.workId)
    const all: any[] = []
    if (data?.volumes) for (const v of data.volumes) if (v.chapters) all.push(...v.chapters)
    if (data?.unlinkedChapters) all.push(...data.unlinkedChapters)
    const chapter = all.find((c: any) => c.id === props.chapterId)
    if (!chapter) return
    composedUrl.value = String(chapter.composed_video_url || '')
    const configs = Array.isArray(chapter.content_configs) ? chapter.content_configs : []
    const flattened: ComposePanel[] = []
    configs.forEach((scene: any, sceneIdx: number) => {
      const sceneTransition = String(scene?.transition || '')
      if (!Array.isArray(scene?.shots)) {
        const panelIdx = flattened.length
        const url = String(scene?.finalVideoUrl || '')
        flattened.push({
          id: panelIdx + 1, panelIdx, sceneIdx, label: `V-${String(panelIdx + 1).padStart(2, '0')}`,
          content: String(scene?.scene || scene?.environment || ''), durShort: Number(scene?.durShort) || 5,
          finalVideoUrl: url, firstFrameUrl: String(scene?.firstFrameUrl || ''), sceneTransition,
          transition: String(scene?.transition || ''),
          sourceOffset: 0,
          sourceDuration: Number(scene?.durShort) || 5,
          decibel: 0,
          ...(url ? {} : { blocked: 'no-video' as const }),
        })
        return
      }
      scene.shots.forEach((shot: any) => {
        const panelIdx = flattened.length
        const url = String(shot?.finalVideoUrl || '')
        flattened.push({
          id: panelIdx + 1, panelIdx, sceneIdx, label: `V-${String(panelIdx + 1).padStart(2, '0')}`,
          content: String(shot?.content || ''), durShort: Number(shot?.durShort) || 5,
          finalVideoUrl: url, firstFrameUrl: String(shot?.firstFrameUrl || ''), sceneTransition,
          transition: String(shot?.transition || ''),
          sourceOffset: 0,
          sourceDuration: Number(shot?.durShort) || 5,
          decibel: 0,
          ...(url ? {} : { blocked: 'no-video' as const }),
        })
      })
    })
    panels.value = flattened
    // 默认勾选所有可合成的段（有视频且不是场景最后一镜）
    selectedIdxes.value = flattened.filter(p => !p.blocked).map(p => p.panelIdx)
  } catch (e: any) {
    showToast(e.message || '加载章节失败', 'error')
  } finally { loading.value = false }
}

// ── 勾选状态 ──
const selectedIdxes = ref<number[]>([])
const selectablePanels = computed(() => panels.value.filter(p => !p.blocked))
const selectedPanels = computed(() => panels.value.filter(p => !p.blocked && selectedIdxes.value.includes(p.panelIdx)))
const selectedDuration = computed(() => selectedPanels.value.reduce((sum, p) => sum + p.durShort, 0))
const missingCount = computed(() => panels.value.filter(p => p.blocked === 'no-video').length)

function selectAll() {
  if (composing.value) return
  selectedIdxes.value = selectablePanels.value.map(p => p.panelIdx)
}
function clearAll() {
  if (composing.value) return
  selectedIdxes.value = []
}

// ── 输出设置（与后端 /agent/compose 的取值一致）──
const resolution = ref('1080p')
const fps = ref(30)
const RESOLUTIONS = ['720p', '1080p', '4K'] as const
const FPS_OPTIONS = [24, 30, 60] as const

// ── LibTV 双轨音量控制 (F4) ──
const videoAudioMuted = ref(false)
const videoAudioVolume = ref(100)
const audioTrackMuted = ref(false)
const audioTrackVolume = ref(100)
const upscalingComposed = ref(false)

async function upscaleComposedVideo(targetRes: '1080p' | '2k' | '4k' = '2k') {
  if (!composedUrl.value || upscalingComposed.value || composing.value) return
  upscalingComposed.value = true
  try {
    const res = await chaptersApi.upscaleVideo({
      workId: props.workId,
      chapterId: props.chapterId,
      sourceUrl: composedUrl.value,
      targetResolution: targetRes,
    })
    composedUrl.value = res.url
    showToast(`成片已超分至 ${targetRes.toUpperCase()} (${res.width}x${res.height})`, 'success')
  } catch (e: any) {
    showToast(e.message || '成片超分失败', 'error')
  } finally {
    upscalingComposed.value = false
  }
}

// ── 合成任务 ──
const composing = ref(false)
const progress = ref(0)
const stageLabel = ref('')
/** 上次成功合成时的「勾选 + 设置」签名：与当前不一致即提示需要重新合成 */
const composedKey = ref('')
let taskId = ''
let timer: ReturnType<typeof setInterval> | null = null
let disposed = false

const currentKey = computed(() => JSON.stringify({
  idxes: [...selectedIdxes.value].sort((a, b) => a - b), resolution: resolution.value, fps: fps.value,
}))
const outputStale = computed(() => !!composedUrl.value && !!composedKey.value && composedKey.value !== currentKey.value)

/** 任务的 stepsConfig 里带着 { label, percent }（后端逐段上报） */
function parseProgress(task: any): { percent: number; label: string } | null {
  try {
    const steps = JSON.parse(String(task?.stepsConfig || '[]'))
    const step = Array.isArray(steps) ? steps[0] : null
    if (!step) return null
    return { percent: Math.max(0, Math.min(100, Number(step.percent) || 0)), label: String(step.label || '') }
  } catch { return null }
}

async function refresh() {
  if (!taskId) return
  let tasks: any[] = []
  try { tasks = await listTasks() as any[] } catch { return }
  const task = tasks.find((item: any) => item.taskId === taskId)
  if (!task) return
  const parsed = parseProgress(task)
  if (parsed) { progress.value = parsed.percent; stageLabel.value = parsed.label }
  if (task.status === 'done') {
    stopPoll()
    composing.value = false
    progress.value = 100
    stageLabel.value = '合成完成'
    composedUrl.value = String(task.result || composedUrl.value)
    composedKey.value = currentKey.value
    showToast('作品合成完成', 'success')
  } else if (task.status === 'failed') {
    stopPoll()
    composing.value = false
    stageLabel.value = ''
    showToast(task.result || '作品合成失败', 'error')
  }
}

function startPoll() {
  if (timer) return
  void refresh()
  timer = setInterval(() => { if (!disposed) void refresh() }, 2500)
}

function stopPoll() {
  if (timer) { clearInterval(timer); timer = null }
}

async function startCompose() {
  if (composing.value || !props.workId || !props.chapterId) return
  if (!selectedIdxes.value.length) return showToast('请至少勾选一个分镜', 'info')
  composing.value = true
  progress.value = 0
  stageLabel.value = '已提交合成任务……'
  try {
    const res = await chaptersApi.compose(props.workId, props.chapterId, {
      resolution: resolution.value,
      fps: fps.value,
      panelIdxes: [...selectedIdxes.value],
      clips: selectedPanels.value.map(p => ({
        sourceNodeId: `shot_${p.panelIdx}_video`,
        panelIdx: p.panelIdx,
        url: p.finalVideoUrl,
        duration: p.sourceDuration || p.durShort,
        sourceOffset: p.sourceOffset || 0,
        sourceDuration: p.sourceDuration || p.durShort,
        decibel: p.decibel || 0,
        transitionAfter: p.transition || p.sceneTransition || undefined,
      })),
      videoAudioMuted: videoAudioMuted.value,
      videoAudioVolume: videoAudioVolume.value / 100,
      audioTrackMuted: audioTrackMuted.value,
      audioTrackVolume: audioTrackVolume.value / 100,
    })
    taskId = res.taskId
    startPoll()
  } catch (e: any) {
    composing.value = false
    stageLabel.value = ''
    showToast(e.message || '开始合成失败', 'error')
  }
}

// ── 成品播放器 ──
let player: Player | null = null
function initPlayer(url: string) {
  const el = document.getElementById('compose-video')
  if (!el) return
  if (player) { try { player.destroy() } catch { /* 忽略销毁异常 */ } player = null }
  player = new Player({ id: 'compose-video', url, volume: 0.6, playsinline: true, height: '100%', width: '100%' })
}

watch(composedUrl, async (url) => {
  if (!url || composing.value) return
  await nextTick()
  initPlayer(url)
})

// ── header 主操作 ──
function registerAction() {
  emit('register-action', {
    label: composing.value ? '合成中…' : (composedUrl.value ? '重新合成' : '开始合成'),
    run: startCompose,
  })
}
watch([composing, composedUrl], registerAction)

onMounted(async () => {
  emit('register-action', { label: '开始合成', run: startCompose })
  await loadChapter()
  // 刷新/跳转后恢复：后台还有 running 的合成任务就继续轮询
  try {
    const tasks = await listTasks() as any[]
    const running = tasks.find((item: any) => item.type === 'compose' && item.status === 'running')
    if (running) {
      taskId = running.taskId
      composing.value = true
      startPoll()
    } else if (!composedUrl.value) {
      const done = tasks.find((item: any) => item.type === 'compose' && item.status === 'done' && item.result)
      if (done) composedUrl.value = String(done.result)
    }
  } catch { /* 任务列表不可用不影响页面 */ }
})

onUnmounted(() => {
  disposed = true
  stopPoll()
  emit('register-action', null)
  if (player) { try { player.destroy() } catch { /* 忽略 */ } player = null }
})
</script>

<template>
  <div class="flex-1 min-h-0 flex">
    <!-- ═══ 左：合成清单（可任意勾选） ═══ -->
    <div class="w-72 shrink-0 border-r border-base-200 bg-base-100 flex flex-col">
      <div class="px-4 py-3 border-b border-base-200">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold">合成清单</h3>
          <div class="flex items-center gap-0.5">
            <button class="btn btn-ghost btn-xs" :disabled="composing" @click="selectAll">全选</button>
            <button class="btn btn-ghost btn-xs" :disabled="composing" @click="clearAll">清空</button>
          </div>
        </div>
        <p class="text-[10px] text-base-content/40">
          已选 {{ selectedPanels.length }}/{{ selectablePanels.length }} 段 · 约 {{ selectedDuration }}s
        </p>
      </div>

      <div v-if="missingCount" class="px-4 py-2 bg-error/10 border-b border-error/20">
        <p class="text-[11px] text-error leading-snug">
          有 {{ missingCount }} 个分镜还没有视频（未勾选也无法合成），可先在「分镜制作」生成后再来合成。
        </p>
      </div>

      <div class="flex-1 overflow-y-auto">
        <template v-for="(p, i) in panels" :key="p.panelIdx">
          <!-- 场景分隔：跨场景处才会插转场 -->
          <div v-if="i === 0 || panels[i - 1]!.sceneIdx !== p.sceneIdx"
            class="px-4 pt-3 pb-1 flex items-center gap-2">
            <span class="text-[10px] font-semibold text-base-content/40">场景 {{ p.sceneIdx + 1 }}</span>
            <span class="flex-1 h-px bg-base-200"></span>
            <span class="text-[10px] text-base-content/30">{{ p.sceneTransition || '—' }}</span>
          </div>

          <label class="flex items-center gap-3 px-4 py-2 border-b border-base-200/60"
            :class="p.blocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-base-200/60'">
            <input type="checkbox" class="checkbox checkbox-sm checkbox-primary shrink-0" :value="p.panelIdx"
              v-model="selectedIdxes" :disabled="!!p.blocked || composing" />
            <span class="text-[10px] font-mono font-bold shrink-0 w-8"
              :class="p.blocked ? 'text-base-content/30' : 'text-primary'">{{ p.label }}</span>
            <img v-if="p.firstFrameUrl" :src="p.firstFrameUrl" alt="首帧"
              class="w-10 h-6 object-cover rounded shrink-0 bg-base-200" />
            <span v-else class="w-10 h-6 rounded bg-base-200 shrink-0" />
            <span class="text-[11px] flex-1 truncate text-base-content/60">{{ p.content || '未命名分镜' }}</span>
            <span v-if="p.transition && !p.blocked" class="badge badge-xs badge-ghost shrink-0"
              :title="`本镜 → 下一镜：${p.transition}`">{{ p.transition }}</span>
            <span class="text-[10px] shrink-0 tabular-nums" :class="p.blocked ? 'text-error' : 'text-success'">
              {{ p.blocked ? '缺视频' : `${p.durShort}s` }}
            </span>
          </label>
        </template>

        <p v-if="!loading && !panels.length" class="text-center text-xs text-base-content/40 py-10">
          本章还没有分镜，先去「分镜拆分」提取
        </p>
        <div v-if="loading" class="flex items-center justify-center py-10 text-xs text-base-content/40">
          <span class="loading loading-spinner loading-sm mr-2"></span>加载中…
        </div>
      </div>
    </div>

    <!-- ═══ 中：成品预览 / 合成进度 ═══ -->
    <div class="flex-1 min-w-0 flex flex-col bg-[#000000]">
      <div class="flex items-center justify-between px-5 py-3 border-b border-base-200 bg-base-100">
        <span class="text-sm font-bold">
          成品预览
          <span class="font-normal text-base-content/40 text-xs ml-1">{{ chapterTitle }}</span>
        </span>
        <span v-if="composedUrl && !composing" class="badge badge-sm badge-success badge-soft">已合成</span>
      </div>

      <div class="relative flex-1 min-h-0 flex items-center justify-center p-4">
        <!-- 勾选/设置变化后的提示 -->
        <div v-if="outputStale && !composing"
          class="absolute top-4 left-1/2 -translate-x-1/2 z-20 badge badge-warning badge-soft whitespace-nowrap">
          勾选或输出设置已变化，请重新合成
        </div>

        <!-- 合成中 -->
        <div v-if="composing" class="flex flex-col items-center gap-3">
          <div class="radial-progress text-primary" :style="`--value:${progress}`" role="progressbar">
            {{ progress }}%
          </div>
          <span class="text-sm text-base-content/70">{{ stageLabel || '正在合成…' }}</span>
          <span class="text-[11px] text-base-content/40">按勾选的 {{ selectedIdxes.length }} 段重编码拼接，请勿关闭页面</span>
        </div>
        <!-- 成品播放 -->
        <div v-else-if="composedUrl" class="w-full h-full bg-black rounded-xl overflow-hidden">
          <div id="compose-video" class="w-full h-full"></div>
        </div>
        <!-- 空态 -->
        <div v-else class="flex flex-col items-center gap-2 text-base-content/30">
          <span class="text-5xl">🎬</span>
          <p class="text-sm">勾选左侧分镜，点击右上角「开始合成」</p>
        </div>
      </div>
    </div>

    <!-- ═══ 右：输出设置 ═══ -->
    <div class="w-72 shrink-0 border-l border-base-200 bg-base-100 flex flex-col">
      <div class="px-4 py-3 border-b border-base-200">
        <h3 class="text-sm font-bold">输出设置</h3>
      </div>
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <span class="text-[11px] text-base-content/50 block mb-1.5">分辨率</span>
          <div class="flex gap-1.5">
            <button v-for="item in RESOLUTIONS" :key="item" class="btn btn-sm flex-1 rounded-lg"
              :class="resolution === item ? 'btn-primary' : 'btn-ghost border border-base-300'"
              :disabled="composing" @click="resolution = item">{{ item }}</button>
          </div>
        </div>

        <div>
          <span class="text-[11px] text-base-content/50 block mb-1.5">帧率</span>
          <div class="flex gap-1.5">
            <button v-for="item in FPS_OPTIONS" :key="item" class="btn btn-sm flex-1 rounded-lg"
              :class="fps === item ? 'btn-primary' : 'btn-ghost border border-base-300'"
              :disabled="composing" @click="fps = item">{{ item }}fps</button>
          </div>
        </div>

        <div class="rounded-xl bg-base-200/50 p-3 space-y-1">
          <!-- LibTV 双轨音量控制 (F4) -->
          <div class="space-y-2 pb-2 border-b border-base-300/60">
            <p class="text-[11px] font-semibold text-base-content/70">双轨音量调节 (LibTV)</p>
            <div class="space-y-1">
              <div class="flex items-center justify-between text-[10px]">
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" class="checkbox checkbox-xs" v-model="videoAudioMuted" :disabled="composing" />
                  <span>视频原声静音</span>
                </label>
                <span class="font-mono">{{ videoAudioMuted ? '静音' : `${videoAudioVolume}%` }}</span>
              </div>
              <input type="range" min="0" max="200" v-model.number="videoAudioVolume"
                :disabled="composing || videoAudioMuted" class="range range-xs range-primary" />
            </div>
            <div class="space-y-1">
              <div class="flex items-center justify-between text-[10px]">
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" class="checkbox checkbox-xs" v-model="audioTrackMuted" :disabled="composing" />
                  <span>配音/音频轨静音</span>
                </label>
                <span class="font-mono">{{ audioTrackMuted ? '静音' : `${audioTrackVolume}%` }}</span>
              </div>
              <input type="range" min="0" max="200" v-model.number="audioTrackVolume"
                :disabled="composing || audioTrackMuted" class="range range-xs range-secondary" />
            </div>
          </div>

          <!-- LibTV 时间线片段微调 (sourceOffset / sourceDuration / decibel) -->
          <div v-if="selectedPanels.length" class="space-y-2 pb-2 border-b border-base-300/60">
            <p class="text-[11px] font-semibold text-base-content/70">
              时间线片段裁剪 ({{ selectedPanels.length }} 段)
            </p>
            <div class="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              <div v-for="clip in selectedPanels" :key="clip.panelIdx"
                class="p-2 rounded-lg bg-base-100 border border-base-300 space-y-1">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="font-mono font-bold text-primary">{{ clip.label }}</span>
                  <span class="text-base-content/50 truncate max-w-[140px]">{{ clip.content }}</span>
                </div>
                <div class="grid grid-cols-3 gap-1 text-[10px]">
                  <label class="flex flex-col">
                    <span class="text-base-content/40">入点(s)</span>
                    <input type="number" step="0.5" min="0" :max="Math.max(0, clip.durShort - 0.5)"
                      v-model.number="clip.sourceOffset"
                      class="input input-bordered input-xs px-1 text-[10px]" />
                  </label>
                  <label class="flex flex-col">
                    <span class="text-base-content/40">时长(s)</span>
                    <input type="number" step="0.5" min="0.5" :max="clip.durShort"
                      v-model.number="clip.sourceDuration"
                      class="input input-bordered input-xs px-1 text-[10px]" />
                  </label>
                  <label class="flex flex-col">
                    <span class="text-base-content/40">增益(dB)</span>
                    <input type="number" step="1" min="-60" max="20"
                      v-model.number="clip.decibel"
                      class="input input-bordered input-xs px-1 text-[10px]" />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- 成片高清超分 (HD Upscale) -->
          <div v-if="composedUrl && !composing" class="space-y-1.5 pb-2 border-b border-base-300/60">
            <p class="text-[11px] font-semibold text-base-content/70">成片高清超分 (HD Upscale)</p>
            <div class="flex gap-1.5">
              <button type="button" class="btn btn-xs btn-outline flex-1"
                :disabled="upscalingComposed" @click="upscaleComposedVideo('1080p')">1080P</button>
              <button type="button" class="btn btn-xs btn-outline btn-primary flex-1"
                :disabled="upscalingComposed" @click="upscaleComposedVideo('2k')">2K 超分</button>
              <button type="button" class="btn btn-xs btn-outline btn-secondary flex-1"
                :disabled="upscalingComposed" @click="upscaleComposedVideo('4k')">4K 超分</button>
            </div>
          </div>

          <p class="text-[11px] font-semibold text-base-content/60">转场规则（自动）</p>
          <p class="text-[10px] text-base-content/50 leading-snug">
            跨场景时按「分镜拆分」里设置的转场自动插入过渡（淡入淡出 / 叠化 / 闪白 / 黑场等）；
            同场景内的镜头保持硬切；片头与片尾自动淡入淡出。
          </p>
          <p class="text-[10px] text-base-content/40 leading-snug">
            具体实现取决于服务器 ffmpeg 版本：4.3 以上为交叉转场（真叠化），更低版本会降级为「淡出 → 淡入」过场。
          </p>
        </div>

        <div class="rounded-xl bg-base-200/50 p-3 space-y-1">
          <p class="text-[11px] font-semibold text-base-content/60">合成说明</p>
          <p class="text-[10px] text-base-content/50 leading-snug">
            按左边勾选的顺序合成（每段都自带配音），重编码拼接为一个 MP4；勾选可以任意组合、跨场景也会自动处理转场。
          </p>
        </div>

        <button class="btn btn-primary w-full rounded-lg" :disabled="composing || !selectedPanels.length"
          @click="startCompose">
          <span v-if="composing" class="loading loading-spinner loading-xs"></span>
          {{ composing ? '合成中…' : `${composedUrl ? '重新合成' : '开始合成'}（${selectedPanels.length} 段）` }}
        </button>
        <a v-if="composedUrl && !composing" class="btn btn-outline w-full rounded-lg" :href="composedUrl"
          target="_blank" rel="noopener" download>下载成品</a>
      </div>
    </div>
  </div>
</template>

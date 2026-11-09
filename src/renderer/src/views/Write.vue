<script setup lang="ts">
import WorkflowTimeline from '@/components/WorkflowTimeline.vue'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { useWorkflowTimeline, type TimelineStep } from '@/composables/useWorkflowTimeline'
import { useTaskRecovery } from '@/composables/useTaskRecovery'
import { useAuth } from '@/composables/useAuth'
import { worksApi } from '@/api/works'
import { chaptersApi } from '@/api/chapters'
import { streamAiNovel } from '@/api/stream'
import type { WorkItem } from '@/api/works'
import type { ChapterItem } from '@/api/chapters'
import NovelEditor from '@/components/NovelEditor.vue'
import OutlineSidebar, { type SidebarTab } from '@/components/OutlineSidebar.vue'
import ModelPicker from '@/components/ModelPicker.vue'
import PointsBadge from '@/components/PointsBadge.vue'

const route = useRoute()
const { theme, themes, setTheme } = useTheme()
const timeline = useWorkflowTimeline()
const modelValue = ref('') // 选中的文本模型
const { refreshUser } = useAuth() // AI 生成消耗积分后刷新导航栏积分

// ── 编辑器引用 ──
const editorRef = ref<InstanceType<typeof NovelEditor> | null>(null)

// 从编辑器同步的状态（用于顶部栏展示）
const wordCount = ref(0)
const saving = ref(false)
const saveStatus = ref<'saved' | 'saving' | 'success'>('saved')
const readingTime = computed(() => Math.max(1, Math.ceil(wordCount.value / 350)))

// --- Left sidebar tabs ---
const leftTab = ref<SidebarTab>('outline')
const leftOpen = ref(true)
const rightOpen = ref(false)

// --- Work & Chapter data ---
const workId = ref<number>(Number(route.query.workId) || 0) // 作品ID
const work = ref<WorkItem | null>(null) // 作品数据
const currentChapterId = ref<number | null>(null) // 当前章节ID
const chapterTitle = ref('') // 当前章节标题
const chapterContent = ref('') // 当前章节内容
const chapters = ref<ChapterItem[]>([]) // 所有章节数据
const loadingWork = ref(false) // 是否正在加载作品数据
const pendingChapterId = ref<number | null>(null) // 待加载章节ID

// 本地记录每个作品最后打开的章节，刷新页面后恢复
const LAST_CHAPTER_KEY_PREFIX = 'ai-comic-write:last-chapter:'
function lastChapterStorageKey(wid: number): string {
  return `${LAST_CHAPTER_KEY_PREFIX}${wid}`
}
// 读取本地记录的最后打开章节ID
function readLastChapterId(wid: number): number | null {
  const raw = localStorage.getItem(lastChapterStorageKey(wid))
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}
// 保存本地记录的最后打开章节ID
function saveLastChapterId(wid: number, chapterId: number): void {
  if (!wid || !chapterId) return
  localStorage.setItem(lastChapterStorageKey(wid), String(chapterId))
}

// 从 API 加载作品+章节数据
async function loadWorkData() {
  if (!workId.value) return
  loadingWork.value = true
  try {
    const data: any = await worksApi.detail(workId.value)
    work.value = data
    // 展平 volumes.chapters 和 unlinkedChapters
    const allChapters: ChapterItem[] = []
    if (data.volumes) {
      for (const vol of data.volumes) {
        if (vol.chapters) allChapters.push(...vol.chapters)
      }
    }
    if (data.unlinkedChapters) allChapters.push(...data.unlinkedChapters)
    chapters.value = allChapters

    // 优先恢复上次打开的章节；没有记录或记录失效时，默认打开第一卷第一章
    const savedId = readLastChapterId(workId.value)
    const targetId = savedId && allChapters.some(c => c.id === savedId)
      ? savedId
      : allChapters[0]?.id ?? null

    if (targetId && targetId !== currentChapterId.value) {
      await openChapter(targetId)
    }
  } catch (e: any) {
    console.error('加载作品失败:', e.message)
  } finally {
    loadingWork.value = false
  }
}

// AI 生成完成后，后端工具已更新作品标题/简介/卷名/章节名，重新拉取一次以刷新侧栏与标题
// （immediate：页面恢复/生成先完成时，contentFinalized 可能已在挂载前置为 true，否则 watch 永不触发）
watch(() => timeline.contentFinalized.value, async (v) => {
  if (!v) return
  await loadWorkData()
  const current = chapters.value.find(c => c.id === currentChapterId.value)
  if (current) chapterTitle.value = current.title
}, { immediate: true })

// ── AI 生成新卷章 / 下一章 ──
const aiGenerating = ref(false)
let aiStreamAbort: (() => void) | null = null

// 新卷章时间链（已有作品，跳过“创建小说”步骤）
const NEXT_VOLUME_STEPS_CONFIG: TimelineStep[] = [
  { name: 'create-volumes-chapter', label: '创建新卷章', status: 'wait' },
  { name: 'generate-chapter-content', label: 'AI 生成内容', status: 'wait' },
]

// 当前卷下续写下一章时间链
const NEXT_CHAPTER_STEPS_CONFIG: TimelineStep[] = [
  { name: 'create-chapter', label: '创建新章节', status: 'wait' },
  { name: 'generate-chapter-content', label: 'AI 生成内容', status: 'wait' },
]

// 步骤完成时产出的新章节 ID → 刷新卷章列表并选中新章节
// （主动发起与刷新后恢复共用）
watch(() => timeline.pendingSelectChapterId.value, async (chapterId) => {
  if (!chapterId) return
  timeline.pendingSelectChapterId.value = null
  await loadWorkData()
  openChapter(chapterId)
})

// 页面刷新 / 跳转后的 aiNovel 任务恢复（Write 页才需要重连 AI 小说工作流）
// 时间链直接使用任务持久化的 stepsConfig，不写死步骤，新卷章/下一章两种模式都能恢复
useTaskRecovery(
  // token 回显：AI 小说流式正文
  (text) => {
    console.log('恢复流式内容', text)
    timeline.setContent(text)
  },
  // 流结束（[DONE]）：恢复编辑器可用状态并隐藏时间链
  () => {
    console.log('恢复任务完成')
    timeline.contentFinalized.value = true
    timeline.hide()
  },
  // 元信息：恢复时间链（useTaskRecovery 已解析 stepsConfig 为 meta.steps）+ workId
  (meta) => {
    console.log('任务恢复开始', meta)
    timeline.restore(meta.steps || [])
    if (meta.workId) timeline.targetWorkId.value = meta.workId
  },
  // 步骤开始
  (id) => { timeline.setRunning(id) },
  // 步骤完成
  (id, output) => {
    console.log('恢复步骤完成', id, output)
    timeline.setDone(id)
    if ((id === 'create-volumes-chapter' || id === 'create-chapter') && output?.chaptersId) {
      timeline.pendingSelectChapterId.value = output.chaptersId
    }
    // 内容生成完成：写入权威完整内容（与主动发起模式对齐，避免恢复停留在无格式的流式累积文本）
    if (id === 'generate-chapter-content' && output?.content) {
      timeline.setFinalContent(output.content)
      timeline.contentFinalized.value = true
    }
  },
  { types: ['aiNovel'] },
)

/** 发起 AI 生成：stepsConfig 决定走新卷章还是当前卷续写下一章 */
function startAiGenerate(stepsConfig: TimelineStep[], volumeId?: number, chapterId?: number): void {
  if (!workId.value || aiGenerating.value) return
  if (!modelValue.value) {
    alert('请先选择模型')
    return
  }
  // 续写上下文：优先取指定章节（即侧栏当前选中的章节，需属于该卷）；
  // 否则下一章取该卷最后一章、新卷章取全书最后一章
  let prevCh: ChapterItem | null = null
  if (chapterId) {
    const hit = chapters.value.find(c => c.id === chapterId)
    if (hit && (!volumeId || hit.volume_id === volumeId)) prevCh = hit
  }
  if (!prevCh) {
    prevCh = volumeId
      ? chapters.value.filter(c => c.volume_id === volumeId).pop() ?? null
      : chapters.value[chapters.value.length - 1] ?? null
  }
  aiGenerating.value = true
  timeline.start(stepsConfig)
  const stream = streamAiNovel(
    modelValue.value, // 选择的模型
    {
      description: work.value?.description || work.value?.content || '',
      length: (['长篇', '短篇', '剧本', '视频'] as const).includes(work.value?.type as any)
        ? (work.value?.type as string)
        : '长篇',
      audience: work.value?.audience || '全频',
      pov: work.value?.pov || '第三人称',
      genre: work.value?.genre || '',
      stepsConfig: JSON.stringify(stepsConfig),
      workId: workId.value,
      volumeId,
      previousChapterId: prevCh?.id ?? undefined,
      previousVolumeId: prevCh?.volume_id ?? undefined,
    },
    {
      onChunk(text) { timeline.setContent(text) },
      onStepStart(id) { timeline.setRunning(id) },
      onStepDone(id, output) {
        console.log('AI 生成步骤完成', id, output)
        timeline.setDone(id)
        // 新章节创建完成：刷新列表并选中新章节（新卷章 / 下一章共用）
        if ((id === 'create-volumes-chapter' || id === 'create-chapter') && output?.chaptersId) {
          timeline.pendingSelectChapterId.value = output.chaptersId
        }
        // 内容生成完成：写入权威完整内容
        if (id === 'generate-chapter-content' && output?.content) {
          timeline.setFinalContent(output.content)
          timeline.contentFinalized.value = true
        }
      },
      onDone() {
        aiGenerating.value = false
        refreshUser() // 生成完成，刷新积分
      },
      onError(err) {
        aiGenerating.value = false
        refreshUser() // 生成失败会退款，刷新积分
        timeline.hide()
        alert('生成失败: ' + err.message)
      },
    },
  )
  aiStreamAbort = stream.abort
}

/** 基于当前选中的章节 AI 续写下一章（父组件根据章节解析所属卷） */
function generateNextChapter(chapterId: number | null): void {
  if (!chapterId) return
  const ch = chapters.value.find(c => c.id === chapterId)
  if (!ch) return
  startAiGenerate(NEXT_CHAPTER_STEPS_CONFIG, ch.volume_id ?? undefined, chapterId)
}

/** AI 生成新卷章 */
function generateNextVolume(): void {
  startAiGenerate(NEXT_VOLUME_STEPS_CONFIG)
}

// 离开页面时断开本页 SSE，避免连接残留（与 Home 页行为一致）
onUnmounted(() => {
  if (aiStreamAbort) {
    aiStreamAbort()
    aiStreamAbort = null
  }
})

// 侧边栏用：卷列表（含章节，交由 OutlineSidebar 渲染）
const volumes = computed(() => {
  const data: any = work.value
  if (!data?.volumes) return []
  return data.volumes.map((vol: any) => ({
    id: vol.id,
    name: vol.title,
    stats: `${vol.chapters?.length || 0}章`,
    chapters: (vol.chapters || []).map((ch: ChapterItem) => ({
      id: ch.id,
      title: ch.title,
      words: ch.word_count || 0,
      active: ch.id === currentChapterId.value,
    })),
  }))
})

// 切换章节
async function openChapter(id: number) {
  const ch = chapters.value.find(c => c.id === id)
  if (!ch) return
  currentChapterId.value = ch.id
  chapterTitle.value = ch.title
  chapterContent.value = ch.content || ''
  saveLastChapterId(workId.value, ch.id)

  // 编辑器还未挂载（例如首次加载数据时），先记下待加载章节，挂载后再载入
  if (!editorRef.value) {
    pendingChapterId.value = ch.id
  }
}

// 编辑器挂载后，如果还有待加载的章节，则立即载入（补全加载动作，避免待加载章节永不打开）
watch(() => editorRef.value, (ed) => {
  if (!ed || pendingChapterId.value === null) return
  const id = pendingChapterId.value
  pendingChapterId.value = null
  openChapter(id)
})

// ── 编辑器事件处理 ──
function onWordCountChange(count: number) {
  wordCount.value = count
}

function onSaveStateChange(state: { saving: boolean; status: 'saved' | 'saving' | 'success' }) {
  saving.value = state.saving
  saveStatus.value = state.status
}

function onEditorSaved(payload: { chapterId: number; wordCount: number }) {
  // 更新本地章节列表字数
  const ch = chapters.value.find(c => c.id === payload.chapterId)
  if (ch) ch.word_count = payload.wordCount
}

function save(): void {
  editorRef.value?.save()
}

// ── 卷/章节管理（OutlineSidebar 提交后执行 API + 本地更新） ──

// 重命名卷
async function renameVolume(payload: { id: number; title: string }): Promise<void> {
  if (!workId.value) return
  try {
    await chaptersApi.updateVolume(workId.value, payload.id, { title: payload.title })
    const vol = volumes.value.find((v: any) => v.id === payload.id)
    if (vol) vol.name = payload.title
  } catch (e: any) { alert(e.message || '保存失败') }
}

// 重命名章节
async function renameChapter(payload: { id: number; title: string }): Promise<void> {
  if (!workId.value) return
  try {
    await chaptersApi.update(workId.value, payload.id, { title: payload.title })
    const ch = chapters.value.find(c => c.id === payload.id)
    if (ch) ch.title = payload.title
  } catch (e: any) { alert(e.message || '保存失败') }
}

// 删除卷/章节（统一走 chaptersApi 封装，删除成功后重新加载数据刷新侧栏）
async function handleDelete(payload: { type: 'volume' | 'chapter'; id: number }): Promise<void> {
  if (!workId.value) return
  try {
    if (payload.type === 'volume') {
      await chaptersApi.removeVolume(workId.value, payload.id)
    } else {
      await chaptersApi.remove(workId.value, payload.id)
    }
    await loadWorkData()
  } catch (e: any) { alert(e.message || '删除失败') }
}

async function addChapterToVolume(volumeId: number) {
  if (!workId.value) return
  try {
    const no = chapters.value.filter(c => c.volume_id === volumeId).length + 1
    const res = await chaptersApi.create(workId.value, { title: `第${no}章 未命名`, volume_id: volumeId, chapter_no: no } as any)
    await loadWorkData()
    if (res.id) openChapter(res.id)
  } catch (e: any) { alert(e.message || '创建失败') }
}


async function createVolume() {
  if (!workId.value) return
  try {
    // 找到新卷的第一章并打开
    const res = await chaptersApi.createVolume(workId.value)
    await loadWorkData()
    const ch = chapters.value.find(c => c.volume_id === res.volumeId); if (ch) openChapter(ch.id)
  } catch (e: any) {
    alert(e.message || '创建失败')
  }
}


onMounted(() => {
  if (workId.value) loadWorkData()
})
</script>

<template>
  <!-- 任务时间线 -->
  <WorkflowTimeline />

  <div class="h-screen flex flex-col" :data-theme="theme">
    <!-- ===== 顶部工具栏 ===== -->
    <header class="h-14 flex-none border-b border-base-200 bg-base-100 flex items-center justify-between px-4 z-20">
      <div class="flex items-center gap-2 min-w-0">
        <button class="btn btn-ghost btn-xs btn-square shrink-0" @click="$router.back()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <svg class="icon" aria-hidden="true">
          <use xlink:href="#icon-fengmian"></use>
        </svg>
        <h1 class="text-sm font-bold truncate max-w-[200px] lg:max-w-md">{{ chapterTitle }}</h1>
      </div>

      <div class="flex items-center gap-2 text-sm shrink-0">
        <div class="hidden sm:flex items-center gap-1 text-base-content/50">
          <svg class="icon" aria-hidden="true">
            <use xlink:href="#icon-zishu"></use>
          </svg>
          <span class="text-xs">字数</span>
          <span class="font-mono ml-1 text-primary font-bold">{{ wordCount.toLocaleString() }}</span>
          <span class="text-xs">字</span>
        </div>
        <div class="hidden md:flex items-center gap-1 text-base-content/50">
          <svg class="icon" aria-hidden="true">
            <use xlink:href="#icon-shijian"></use>
          </svg>
          <span class="text-xs">预计 {{ readingTime }} 分钟</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="flex h-2 w-2 rounded-full" :class="saving ? 'bg-warning animate-pulse' : 'bg-success'"></span>
          <span class="text-xs" :class="saving ? 'text-warning' : 'text-success'">
            {{ saving ? '保存中...' : saveStatus === 'success' ? '已保存' : '已保存云端' }}
          </span>
        </div>
        <PointsBadge />

        <div class="w-36 hidden md:block">
          <ModelPicker v-model="modelValue" modelType="text" />
        </div>
        <select class="select select-ghost select-xs text-xs w-28" :value="theme"
          @change="setTheme(($event.target as HTMLSelectElement).value)">
          <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
        <button class="btn btn-primary btn-xs" @click="save" :disabled="saving">
          {{ saving ? '保存中...' : '立即保存' }}
        </button>
      </div>
    </header>

    <!-- ===== 主体三栏布局 ===== -->
    <div class="flex-1 flex min-h-0 overflow-hidden relative">

      <!-- ===== 左侧栏：大纲管理 / 作品信息 / 草稿箱（封装组件，含折叠按钮） ===== -->
      <OutlineSidebar v-model:left-open="leftOpen" :volumes="volumes" :work="work" :chapters="chapters"
        :current-chapter-id="currentChapterId" v-model:left-tab="leftTab" :ai-generating="aiGenerating"
        @open-chapter="openChapter" @create-volume="createVolume" @add-chapter="addChapterToVolume"
        @rename-volume="renameVolume" @rename-chapter="renameChapter" @delete="handleDelete"
        @ai-generate-chapter="generateNextChapter" @ai-generate-next-volume="generateNextVolume" />

      <!-- ===== 中间：编辑器 ===== -->
      <div class="flex-1 flex flex-col min-h-0 relative">
        <NovelEditor ref="editorRef" :work-id="workId" :chapter-id="currentChapterId"
          v-model:chapter-title="chapterTitle" @word-count-change="onWordCountChange"
          @save-state-change="onSaveStateChange" @saved="onEditorSaved" :content="chapterContent" />

        <!-- 加载遮罩：仅遮挡不卸载编辑器，避免 AI 流式累积内容（NovelEditor 内部 fullMarkdown）
             因 v-if 卸载重建而丢失，导致流结束时编辑器内容被清空 -->
        <div v-if="loadingWork" class="absolute inset-0 z-10 flex items-center justify-center bg-base-200/60">
          <div class="flex flex-col items-center gap-4 text-base-content/40">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <span class="text-sm">加载作品中...</span>
          </div>
        </div>
      </div>

      <!-- ===== 右侧栏：AI 助手（预留） ===== -->
      <aside v-show="rightOpen"
        class="w-[300px] lg:w-[340px] flex-none border-l border-base-200 bg-base-100 flex flex-col">
        <div class="flex-1 flex items-center justify-center text-base-content/30 text-sm">
          AI 助手开发中...
        </div>
      </aside>
    </div>
  </div>
</template>

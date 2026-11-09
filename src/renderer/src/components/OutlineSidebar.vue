<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { ChapterItem } from '@/api/chapters'
import type { WorkItem } from '@/api/works'
import AppModal from '@/components/AppModal.vue'

// ── Props / Emits ──
/** 大纲列表条目（Write.vue 侧 computed 产出的视图模型） */
interface ChapterVM { id: number; title: string; words: number; active: boolean }
interface VolumeVM { id: number; name: string; stats: string; chapters: ChapterVM[] }
export type SidebarTab = 'info' | 'outline' | 'drafts'

const props = defineProps<{
  /** 卷列表（含章节，供大纲 tab 渲染） */
  volumes: VolumeVM[]
  /** 作品信息（供作品信息 tab 渲染） */
  work: WorkItem | null
  /** 全部章节（作品信息 tab 展示章节数） */
  chapters: ChapterItem[]
  /** 当前打开的章节 ID（大纲中高亮） */
  currentChapterId: number | null
  /** 当前左侧栏 tab（v-model） */
  leftTab: SidebarTab
  /** 左侧栏是否展开（v-model:left-open） */
  leftOpen: boolean
  /** AI 生成新卷章进行中（禁用按钮） */
  aiGenerating?: boolean
}>()

const emit = defineEmits<{
  'update:leftTab': [value: SidebarTab]
  /** 展开/收起左侧栏（v-model:left-open） */
  'update:leftOpen': [value: boolean]
  /** 切换章节 */
  'open-chapter': [id: number]
  /** 新建卷 */
  'create-volume': []
  /** 在指定卷下新建章节 */
  'add-chapter': [volumeId: number]
  /** 重命名卷（父组件负责 API 与本地更新） */
  'rename-volume': [payload: { id: number; title: string }]
  /** 重命名章节（父组件负责 API 与本地更新） */
  'rename-chapter': [payload: { id: number; title: string }]
  /** 删除卷/章节（父组件负责 API 与刷新） */
  'delete': [payload: { type: 'volume' | 'chapter'; id: number }]
  /** AI 续写新章（基于当前选中的章节，父组件负责解析所属卷并调用工作流与时间链） */
  'ai-generate-chapter': [chapterId: number | null]
  /** AI 生成新卷章（父组件负责调用工作流与时间链） */
  'ai-generate-next-volume': []
}>()

// ── 卷折叠状态（本地 UI 状态） ──
const volumeOpenState = reactive<Record<number, boolean>>({})

// ── 卷/章节重命名（本地编辑态） ──
const editingVolumeId = ref<number | null>(null) // 当前重命名的卷 ID
const editVolumeTitle = ref('') // 当前重命名的卷标题
const editingChapterId = ref<number | null>(null) // 当前重命名的章节 ID
const editChapterTitle = ref('') // 当前重命名的章节标题

// 开始重命名卷：记录编辑态并聚焦输入框
function startEditVolume(vol: { id: number; name: string }) {
  editingVolumeId.value = vol.id
  editVolumeTitle.value = vol.name
  requestAnimationFrame(() => {
    const el = document.getElementById('vol-input-' + vol.id) as HTMLInputElement
    if (el) { el.focus(); el.select() }
  })
}

// 结束重命名卷：提交给父组件（API 调用 + 本地列表更新）
function finishEditVolume(volumeId: number) {
  const title = editVolumeTitle.value.trim()
  editingVolumeId.value = null
  if (title) emit('rename-volume', { id: volumeId, title })
}

// 开始重命名章节
function startEditChapter(ch: { id: number; title: string }) {
  editingChapterId.value = ch.id
  editChapterTitle.value = ch.title
  requestAnimationFrame(() => {
    const el = document.getElementById('ch-input-' + ch.id) as HTMLInputElement
    if (el) { el.focus(); el.select() }
  })
}

// 结束重命名章节
function finishEditChapter(chapterId: number) {
  const title = editChapterTitle.value.trim()
  editingChapterId.value = null
  if (title) emit('rename-chapter', { id: chapterId, title })
}

// 切换章节：提交给父组件（API 调用 + 本地列表更新）
function selectChapter(ch: ChapterVM) {
  emit('open-chapter', ch.id)
}

//// ── 删除确认（本地弹窗状态，确认后交给父组件执行） ──
const deleteTarget = ref<{ type: 'volume' | 'chapter'; id: number; title: string } | null>(null)

function confirmDeleteVolume(vol: { id: number; name: string }) {
  deleteTarget.value = { type: 'volume', id: vol.id, title: vol.name }
}
function confirmDeleteChapter(ch: { id: number; title: string }) {
  deleteTarget.value = { type: 'chapter', id: ch.id, title: ch.title }
}

// 确认删除：关闭弹窗并提交父组件（API + loadWorkData 刷新）
function handleDelete(): void {
  if (!deleteTarget.value) return
  const target = deleteTarget.value
  deleteTarget.value = null
  emit('delete', { type: target.type, id: target.id })
}
</script>

<template>
  <aside v-show="leftOpen" class="w-[260px] lg:w-[280px] flex-none border-r border-base-200 bg-base-100 flex flex-col">
    <!-- Tabs -->
    <div class="h-11 flex border-b border-base-200 text-sm">
      <button v-for="tab in (['info', 'outline', 'drafts'] as const)" :key="tab"
        class="flex-1 flex items-center justify-center hover:bg-base-200 transition-colors text-xs font-medium"
        :class="leftTab === tab ? 'border-b-2 border-primary text-primary' : 'text-base-content/50'"
        @click="$emit('update:leftTab', tab)">{{ { info: '作品信息', outline: '正文大纲', drafts: '草稿箱' }[tab] }}</button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-3">

      <!-- 大纲 -->
      <div v-if="leftTab === 'outline'" class="flex flex-col h-full">
        <div class="flex items-center justify-between px-2 pb-3">
          <span class="text-[10px] font-bold text-base-content/30 uppercase tracking-widest">细纲管理</span>
          <button class="btn btn-ghost btn-xs btn-circle" @click="$emit('create-volume')" title="新建一卷">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
              stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <ul class="menu menu-sm w-full gap-1 p-0 flex-1">
          <li v-for="vol in volumes" :key="vol.name" class="mb-1">
            <details :open="volumeOpenState[vol.id] ?? true"
              @toggle="volumeOpenState[vol.id] = ($event.target as HTMLDetailsElement).open" class="group">
              <summary class="font-semibold text-sm py-2 flex items-center">
                <span v-if="editingVolumeId !== vol.id" class="truncate flex-1 min-w-0">{{ vol.name }}</span> <input
                  v-else :id="'vol-input-' + vol.id" v-model="editVolumeTitle"
                  class="input input-xs input-ghost w-24 -ml-1" @blur="finishEditVolume(vol.id)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()" @click.stop />
                <button class="btn btn-ghost btn-xs btn-square ml-auto shrink-0" @click.stop="startEditVolume(vol)"
                  title="重命名卷">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button class="btn btn-ghost btn-xs btn-square shrink-0" @click.stop="$emit('add-chapter', vol.id)"
                  title="在此卷下添加章节">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9 13h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </button>
                <button class="btn btn-ghost btn-xs btn-square shrink-0 text-error mr-1"
                  @click.stop="confirmDeleteVolume(vol)" title="删除卷">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </summary>
              <ul class="mt-1 ml-1">
                <li v-for="ch in vol.chapters" :key="ch.id" class="mb-0.5">
                  <a class="text-xs py-1.5 group flex items-center gap-1"
                    :class="ch.active ? 'active bg-primary/10 text-primary font-medium' : 'text-base-content/60'"
                    @click="selectChapter(ch)">
                    <span v-if="editingChapterId !== ch.id" class="truncate flex-1">{{ ch.title }}</span> <input v-else
                      :id="'ch-input-' + ch.id" v-model="editChapterTitle" class="input input-xs input-ghost flex-1"
                      @blur="finishEditChapter(ch.id)" @keydown.enter="($event.target as HTMLInputElement).blur()"
                      @click.stop /> <button class="btn btn-ghost btn-xs btn-square shrink-0"
                      @click.stop="startEditChapter(ch)" title="重命名"> <svg xmlns="http://www.w3.org/2000/svg"
                        class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg> </button> <button class="btn btn-ghost btn-xs btn-square shrink-0 text-error"
                      @click.stop="confirmDeleteChapter(ch)" title="删除章节"> <svg xmlns="http://www.w3.org/2000/svg"
                        class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg> </button>
                    <span v-if="ch.words > 0" class="badge badge-ghost badge-xs ml-auto font-normal opacity-40">{{
                      (ch.words / 1000).toFixed(1) }}k</span>
                  </a>
                </li>
                <li v-if="!vol.chapters.length">
                  <span class="text-[10px] text-base-content/20 italic px-4 py-2">暂无章节</span>
                </li>
              </ul>
            </details>
          </li>

          <!-- AI 续写新章（基于当前选中的章节） -->
          <li class="pt-2 mt-1">
            <button
              class="btn btn-dash btn-primary btn-sm w-full gap-1 text-primary/70 hover:text-primary hover:bg-primary/5"
              :disabled="aiGenerating || !currentChapterId"
              @click="$emit('ai-generate-chapter', currentChapterId)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              <span>{{ aiGenerating ? 'AI 生成中...' : (currentChapterId ? 'AI 续写新章' : '请先选择章节') }}</span>
            </button>
          </li>
        </ul>

        <button class="btn btn-primary btn-sm btn-wide" :disabled="aiGenerating"
          @click="$emit('ai-generate-next-volume')">
          <svg v-if="aiGenerating" class="loading loading-spinner loading-xs"></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"
            stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <span>{{ aiGenerating ? 'AI 生成中...' : 'AI 生成新卷章' }}</span>
        </button>
      </div>

      <!-- 作品信息 -->
      <div v-if="leftTab === 'info'" class="card bg-base-100">
        <figure>
          <img v-if="work?.cover_url" class="h-32" :src="work.cover_url" alt="Shoes" />
          <div v-else class="w-full h-32 mx-auto bg-base-300 rounded-lg mb-3 flex items-center justify-center text-4xl">
          </div>
        </figure>
        <div class="card-body items-center" style="padding: 5px;">
          <h2 class="card-title">
            {{ work?.title || '未命名' }}
          </h2>
          <div class="flex grid-cols-3 gap-1">
            <div class="badge badge-xs badge-dash badge-primary">{{ work?.type || '' }}</div>
            <div class="badge badge-xs badge-dash badge-primary">{{ work?.audience || '' }}</div>
            <div class="badge badge-xs badge-dash badge-primary">{{ work?.word_count || 0 }}字</div>
            <div class="badge badge-xs badge-dash badge-primary">{{ chapters.length }}章</div>
          </div>
          <div class="text-xs text-base-content/50 mt-1">简介</div>
          <p>{{ work?.content || '' }}</p>
        </div>
      </div>

      <!-- 草稿箱（占位） -->
      <div v-if="leftTab === 'drafts'" class="space-y-2">
        <div
          class="p-3 rounded border border-dashed border-base-300 hover:border-primary cursor-pointer text-center text-xs text-base-content/40 py-6 transition-colors">
          <div class="text-2xl mb-1">📤</div>
          <div>点击或拖拽章节到此暂存</div>
        </div>
        <div class="p-3 rounded hover:bg-base-200 cursor-pointer border-b border-base-200">
          <div class="text-sm font-medium">第四章 废弃工厂的对峙</div>
          <div class="text-[10px] text-base-content/40 mt-1">最后编辑：10分钟前 · 1,200字</div>
        </div>
      </div>
    </div>
  </aside>

  <!-- 侧栏折叠按钮 -->
  <button v-show="leftOpen"
    class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 btn btn-circle btn-xs bg-base-200/80 hover:bg-base-300 border border-base-300 shadow-sm z-10 text-base-content/50 hover:text-base-content"
    style="left:268px" @click="$emit('update:leftOpen', false)" title="收起大纲">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M15 19l-7-7 7-7" />
    </svg>
  </button>
  <button v-show="!leftOpen"
    class="absolute top-1/2 -translate-y-1/2 translate-x-1/2 btn btn-circle btn-xs bg-base-200/80 hover:bg-base-300 border border-base-300 shadow-sm z-10 text-base-content/50 hover:text-base-content"
    style="left:0px" @click="$emit('update:leftOpen', true)" title="展开大纲">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7" />
    </svg>
  </button>

  <!-- 删除确认弹窗 -->
  <AppModal :open="!!deleteTarget" @close="deleteTarget = null">
    <div v-if="deleteTarget" class="modal-box max-w-sm w-full rounded-2xl p-6">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 bg-error/10 text-error rounded-xl flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
            stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div>
          <h3 class="font-bold text-base">删除{{ deleteTarget.type === 'volume' ? '卷' : '章节' }}</h3>
          <p class="text-xs text-base-content/50">此操作不可撤销</p>
        </div>
      </div>
      <div class="bg-base-200 rounded-xl px-4 py-3 mb-2">
        <p class="text-sm font-medium truncate">{{ deleteTarget.title }}</p>
      </div>
      <p v-if="deleteTarget.type === 'volume'" class="text-xs text-error/70 mb-4">⚠ 该卷下的所有章节也会被删除</p>
      <div class="flex gap-2.5">
        <button class="btn btn-ghost flex-1 rounded-xl text-sm" @click="deleteTarget = null">取消</button>
        <button class="btn btn-error flex-1 rounded-xl text-white text-sm" @click="handleDelete">
          确认删除
        </button>
      </div>
    </div>
  </AppModal>
</template>

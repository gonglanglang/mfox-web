<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { deleteTask, listTasksPage, type TaskItem } from '@/api/task'
import AppModal from '@/components/AppModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()

const loading = ref(false)
const detailTask = ref<TaskItem | null>(null)
let timer: number | undefined
/** 递增请求序号：丢弃过期响应，避免轮询/翻页并发时慢响应覆盖新数据 */
let loadSeq = 0

// --- 分页状态 ---
const pageTasks = ref<TaskItem[]>([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

/**
 * 分页器页码序列：总页数 ≤ 7 全显；否则 1 … 当前页±1 … 末页（省略号折叠）
 */
const pageItems = computed<(number | '...')[]>(() => {
  const total = totalPages.value
  const cur = page.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const items: (number | '...')[] = [1]
  const start = Math.max(2, cur - 1)
  const end = Math.min(total - 1, cur + 1)
  if (start > 2) items.push('...')
  for (let i = start; i <= end; i++) items.push(i)
  if (end < total - 1) items.push('...')
  items.push(total)
  return items
})

/** 任务类型 → 中文名称 */
const TYPE_NAMES: Record<string, string> = {
  polish: '小说润色',
  aiNovel: 'AI 小说',
  characterExtract: '角色提取',
  storyboard: '分镜拆分',
  aiImage: '形象图生成',
  frameRedraw: '分镜重绘',
  frameVideo: '分镜视频',
}

function typeName(type: string): string {
  return TYPE_NAMES[type] || type
}

/** 任务输入摘要（extra 展开后的常见字段） */
function summary(t: TaskItem): string {
  const s = t.content || t.description || t.text || ''
  if (!s) return ''
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

/** 题材（genre / audience / pov 等元信息，用于丰富展示；t 可能为 null（详情弹窗关闭时）） */
function genreOf(t: TaskItem | null): string {
  if (!t) return ''
  return (t.genre as string) || (t as any).audience || ''
}

/** 目标读者 */
function audienceOf(t: TaskItem | null): string {
  return t?.targetAudience || t?.audience || ''
}

/** 叙事视角 */
function povOf(t: TaskItem | null): string {
  return (t as any)?.pov || ''
}

/** result 纯文本预览（去掉 Markdown 标记后的前 60 字符，供表格展示） */
function resultPreview(t: TaskItem): string {
  const r = t.result || ''
  if (!r) return ''
  const plain = r
    .replace(/[#*`>_~\[\]()!-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 60 ? plain.slice(0, 60) + '…' : plain
}

/** result 的 Markdown 渲染（供详情弹窗展示，样式见 .md-content） */
const detailHtml = computed(() => {
  const text = detailTask.value?.result || ''
  if (!text) return ''
  return marked.parse(text) as string
})

/** 打开任务详情（渲染 result Markdown） */
function openDetail(t: TaskItem): void {
  detailTask.value = t
}

function fmtTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load(): Promise<void> {
  // 拉取当前页任务；后端支持 ?page=&pageSize= 分页
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await listTasksPage(page.value, pageSize.value)
    if (seq !== loadSeq) return // 过期响应（已翻页/重新加载），丢弃
    pageTasks.value = res.list || []
    total.value = res.total ?? 0
  } catch {
    if (seq !== loadSeq) return
    // 网络错误：保持缓存不变
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** 切换页码（1 到 totalPages 之间） */
function goToPage(p: number): void {
  const target = Math.min(Math.max(1, p), totalPages.value)
  if (target === page.value) return
  page.value = target
}

// --- 删除任务二次确认（替代 window.confirm） ---
const deleteTarget = ref<TaskItem | null>(null)
const deleting = ref(false)
const deleteMessage = computed(() =>
  deleteTarget.value
    ? `确定删除任务「${typeName(deleteTarget.value.type)}」吗？\n删除后不可恢复`
    : '',
)

function askDelete(t: TaskItem): void {
  deleteTarget.value = t
}

async function doDelete(): Promise<void> {
  const t = deleteTarget.value
  if (!t || deleting.value) return
  deleting.value = true
  // 删除前捕获：当前页是否只剩这一条（删除后该页将为空）
  const wasLastOnPage = pageTasks.value.length === 1
  try {
    await deleteTask(t.taskId)
    // 当前页将被删空且不在第一页：回退一页，由 watch(page) 触发一次加载，避免双请求
    if (wasLastOnPage && page.value > 1) {
      page.value -= 1
    } else {
      await load()
    }
    deleteTarget.value = null
  } catch { /* ignore */ }
  deleting.value = false
}

/** 进行中任务跳转到对应页面（任务可能占满全屏，属正常现象） */
function goTo(t: TaskItem): void {
  if (!t.router) return
  router.push(t.router)
  emit('close')
}

function close(): void {
  emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // 打开时回到第一页；page 变化由下方 watch(page) 统一触发加载，避免重复请求
      if (page.value !== 1) page.value = 1
      else load()
    }
  },
)

// 翻页 / 删除后空页回退时重新加载
watch(page, () => {
  if (props.visible) load()
})

onMounted(() => {
  if (props.visible) load()
  timer = window.setInterval(() => {
    if (props.visible) load()
  }, 5000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <AppModal :open="visible" @close="close">
    <!-- 宽度：屏幕 90%，最大 1280px -->
    <div class="modal-box w-[90%] max-w-[1280px] p-0 overflow-hidden">
      <!-- 头部 -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-base-200">
        <h3 class="text-lg font-bold flex items-center gap-2">
          <svg class="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          任务列表
        </h3>
        <button class="btn btn-ghost btn-sm btn-circle" @click="close">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 列表（daisyUI table 表格） -->
      <div class="max-h-[60vh] overflow-y-auto">
        <div v-if="loading && !pageTasks.length"
          class="flex flex-col items-center justify-center py-12 gap-3 text-base-content/50">
          <span class="loading loading-spinner loading-md"></span>
          <span class="text-sm">加载中...</span>
        </div>

        <div v-else-if="!pageTasks.length"
          class="flex flex-col items-center justify-center py-12 gap-2 text-base-content/40">
          <svg class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span class="text-sm">暂无任务</span>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr class="text-xs text-base-content/50">
                <th>任务</th>
                <th>内容</th>
                <th>状态</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in pageTasks" :key="t.taskId" class="hover"
                :class="t.status === 'running' ? 'bg-primary/5' : ''">
                <!-- 任务类型 + 题材 -->
                <td>
                  <div class="flex items-center gap-2 cursor-pointer" @click="goTo(t)">
                    <div class="font-medium whitespace-nowrap">{{ typeName(t.type) }}</div>
                    <span v-if="genreOf(t)" class="badge badge-outline badge-primary badge-xs whitespace-nowrap">{{
                      genreOf(t) }}</span>
                  </div>
                </td>

                <!-- 内容摘要 -->
                <td class="max-w-[16rem]">
                  <!-- <div class="text-xs text-base-content/60 truncate cursor-pointer" :title="summary(t)"
                    @click="goTo(t)">
                    {{ summary(t) || '—' }}
                  </div> -->
                  <div v-if="t.result" class="text-xs text-base-content/40 truncate mt-0.5" :title="resultPreview(t)">
                    {{ resultPreview(t) }}
                  </div>
                </td>

                <!-- 状态：指示灯 + badge -->
                <td>
                  <div class="flex items-center gap-2">
                    <span class="relative flex w-2.5 h-2.5">
                      <span v-if="t.status === 'running'"
                        class="absolute w-full h-full rounded-full bg-success opacity-50 animate-ping"></span>
                      <span class="w-2.5 h-2.5 rounded-full relative"
                        :class="t.status === 'running' ? 'bg-success animate-pulse' : t.status === 'failed' ? 'bg-error' : 'bg-base-300'"></span>
                    </span>
                    <span v-if="t.status === 'running'" class="badge badge-success badge-sm gap-1 whitespace-nowrap">
                      <span class="w-1 h-1 rounded-full bg-white animate-pulse"></span>
                      进行中
                    </span>
                    <span v-else-if="t.status === 'failed'"
                      class="badge badge-error badge-sm gap-1 whitespace-nowrap">失败</span>
                    <span v-else class="badge badge-ghost badge-sm whitespace-nowrap">已完成</span>
                  </div>
                </td>

                <!-- 创建时间 -->
                <td class="text-xs text-base-content/60 whitespace-nowrap">{{ fmtTime(t.createdAt) }}</td>

                <!-- 操作 -->
                <td class="text-right">
                  <div class="flex items-center justify-end gap-1">
                    <button v-if="t.result" class="btn btn-ghost btn-xs" title="查看结果" @click="openDetail(t)">
                      <svg class="icon" aria-hidden="true" style="width: 1rem; height: 1rem;">
                        <use xlink:href="#icon-chakan"></use>
                      </svg>
                    </button>
                    <!-- <button v-if="t.router" class="btn btn-ghost btn-xs" title="跳转到页面" @click="goTo(t)">
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                    </button> -->
                    <button class="btn btn-ghost btn-xs text-error hover:bg-error/10" title="删除任务"
                      @click="askDelete(t)">
                      <svg class="icon" aria-hidden="true" style="width: 1rem; height: 1rem;">
                        <use xlink:href="#icon-shanchu"></use>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 底部：总数 + 分页 + 关闭 -->
      <div class="px-6 py-3 border-t border-base-200 bg-base-100 space-y-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs text-base-content/40 whitespace-nowrap">共 {{ total }} 条 · 任务保留在列表中，需手动删除</span>
          <button class="btn btn-primary btn-sm" @click="close">关闭</button>
        </div>
        <!-- 分页器（对齐 Create.vue 样式：居中 + gap-1，页码保留折叠避免页数过多溢出） -->
        <div class="flex items-center justify-center gap-1 pt-3">
          <button class="join-item btn btn-sm" title="上一页" :disabled="page <= 1"
            @click="goToPage(page - 1)">«</button>
          <template v-for="(item, idx) in pageItems" :key="idx">
            <button v-if="item !== '...'" class="join-item btn btn-sm"
              :class="item === page ? 'btn-primary text-white' : ''" :disabled="item === page"
              @click="goToPage(item)">{{ item }}</button>
            <span v-else class="join-item btn btn-sm no-animation pointer-events-none">…</span>
          </template>
          <button class="join-item btn btn-sm" title="下一页" :disabled="page >= totalPages"
            @click="goToPage(page + 1)">»</button>
        </div>
      </div>
    </div>
  </AppModal>

  <!-- 任务详情弹窗：result 以 Markdown 样式展示 -->
  <AppModal :open="!!detailTask" @close="detailTask = null">
    <div class="modal-box w-11/12 max-w-3xl p-0 overflow-hidden">
      <!-- 头部 -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-base-200">
        <div class="flex items-center gap-2">
          <h3 class="text-lg font-bold">{{ detailTask ? typeName(detailTask.type) : '' }}</h3>
          <span v-if="genreOf(detailTask as TaskItem)" class="badge badge-outline badge-primary badge-sm">{{
            genreOf(detailTask as TaskItem) }}</span>
          <span v-if="detailTask?.status === 'running'" class="badge badge-success badge-sm gap-1">
            <span class="w-1 h-1 rounded-full bg-white animate-pulse"></span>
            进行中
          </span>
          <span v-else-if="detailTask?.status === 'failed'" class="badge badge-error badge-sm">失败</span>
          <span v-else-if="detailTask" class="badge badge-ghost badge-sm">已完成</span>
        </div>
        <button class="btn btn-ghost btn-sm btn-circle" @click="detailTask = null">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 元信息 -->
      <div v-if="detailTask"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 border-b border-base-200 bg-base-100 text-xs text-base-content/50">
        <span v-if="audienceOf(detailTask)">读者：{{ audienceOf(detailTask) }}</span>
        <span v-if="povOf(detailTask)">视角：{{ povOf(detailTask) }}</span>
        <span>创建：{{ fmtTime(detailTask.createdAt) }}</span>
        <span>ID：<code class="text-[10px]">{{ detailTask.taskId.slice(0, 8) }}…</code></span>
      </div>

      <!-- 输入内容 -->
      <div v-if="detailTask && summary(detailTask)" class="px-6 py-3 border-b border-base-200">
        <div class="text-xs font-semibold text-base-content/50 mb-1">输入内容</div>
        <p class="text-sm text-base-content/70 leading-relaxed">{{ summary(detailTask) }}</p>
      </div>

      <!-- result：Markdown 渲染 -->
      <div class="px-6 py-4">
        <div v-if="detailTask?.result" class="text-xs font-semibold text-base-content/50 mb-2">AI 结果</div>
        <div v-if="detailTask?.result" class="bg-base-200 rounded-xl p-5 max-h-[50vh] overflow-y-auto">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <article class="md-content" v-html="detailHtml"></article>
        </div>
        <div v-else class="text-sm text-base-content/40 py-8 text-center">
          {{ detailTask?.status === 'running' ? '任务正在生成中…' : '该任务暂无结果内容' }}
        </div>
      </div>

      <!-- 底部 -->
      <div class="flex items-center justify-end px-6 py-3 border-t border-base-200 bg-base-100">
        <button class="btn btn-primary btn-sm" @click="detailTask = null">关闭</button>
      </div>
    </div>
  </AppModal>

  <!-- 删除任务二次确认 -->
  <ConfirmModal
    :open="!!deleteTarget"
    title="删除任务"
    :message="deleteMessage"
    confirm-text="确认删除"
    cancel-text="取消"
    danger
    :loading="deleting"
    @confirm="doDelete"
    @cancel="deleteTarget = null"
  />
</template>

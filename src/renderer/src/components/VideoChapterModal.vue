<script setup lang="ts">
/**
 * 章节选择弹窗（生成视频入口，daisyUI）
 * 表格展示某作品的全部章节（含卷归属），每行「创作」按钮直接进入该章节的分镜工作台。
 * 封装了「作品详情 → 扁平章节列表（附卷标题）」的组装逻辑，供入口页面复用。
 */
import { ref, watch } from 'vue'
import { worksApi } from '@/api/works'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{
  /** 是否打开 */
  open: boolean
  /** 目标作品 ID */
  workId?: number
  /** 作品标题（弹窗头部展示） */
  workTitle?: string
}>()

const emit = defineEmits<{
  close: []
  /** 点击某章「创作」：进入该章节分镜工作台（参数由父级处理跳转） */
  go: [payload: { workId: number; chapterId: number }]
}>()

interface ChapterRow {
  id: number
  title: string
  volumeTitle: string
  word_count: number
  createdAt: string
  updatedAt: string
}

const loading = ref(false)
const chapters = ref<ChapterRow[]>([])

/** 拉取作品详情并组装扁平章节列表（卷内章节附卷标题；未分卷归「未分卷」） */
async function loadChapters() {
  if (!props.workId) return
  loading.value = true
  chapters.value = []
  try {
    const data: any = await worksApi.detail(props.workId)
    const all: ChapterRow[] = []
    if (data.volumes) {
      for (const vol of data.volumes) {
        if (vol.chapters) {
          all.push(...vol.chapters.map((c: any) => ({
            id: c.id, 
            title: c.title,
            volumeTitle: vol.title,
            word_count: c.word_count || 0,
            createdAt: c.createdAt || '',
            updatedAt: c.updatedAt || ''
          })))
        }
      }
    }
    if (data.unlinkedChapters) {
      all.push(...data.unlinkedChapters.map((c: any) => ({
        id: c.id, title: c.title, volumeTitle: '未分卷', word_count: c.word_count || 0,
      })))
    }
    chapters.value = all
  } catch (e: any) {
    console.error('加载章节失败:', e.message)
  } finally {
    loading.value = false
  }
}

// ── 打开弹窗时拉取章节（显隐由 AppModal 原生 dialog 管理） ──
watch(() => props.open, (v) => {
  if (v) loadChapters()
})

function close() {
  emit('close')
}

function go(ch: ChapterRow) {
  if (!props.workId) return
  emit('go', { workId: props.workId, chapterId: ch.id })
}

/** 时间格式化：完整 ISO → 短日期时间，避免时间列过宽 */
function fmtTime(v: string): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <AppModal :open="open" @close="close">
    <div class="modal-box max-w-4xl w-full rounded-2xl p-0 overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <h3 class="text-lg font-bold truncate">选择创作章节
            <span v-if="workTitle" class="text-sm font-normal text-base-content/50 ml-1">· {{ workTitle }}</span>
          </h3>
          <button class="btn btn-sm btn-ghost btn-circle" @click="close">✕</button>
        </div>

        <!-- Body -->
        <div class="p-4 max-h-[65vh] overflow-y-auto">
          <div v-if="loading" class="flex items-center justify-center py-10">
            <span class="loading loading-spinner text-primary"></span>
          </div>
          <div v-else-if="chapters.length === 0" class="text-center py-10 text-base-content/40 text-sm">
            暂无章节，请先在「文章创作」中创建章节
          </div>
          <div v-else class="overflow-x-auto">
            <table class="table table-xs">
              <thead>
                <tr class="text-xs text-base-content/50">
                  <th class="w-10">#</th>
                  <th>章节</th>
                  <th>卷</th>
                  <th class="text-right">字数</th>
                  <th>创建时间</th>
                  <th>更新时间</th>
                  <th class="w-20 text-right"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(ch, i) in chapters" :key="ch.id" class="hover:bg-base-200/50">
                  <th class="text-base-content/40 font-normal">{{ i + 1 }}</th>
                  <td class="font-medium whitespace-nowrap">{{ ch.title }}</td>
                  <td class="text-base-content/50 whitespace-nowrap">{{ ch.volumeTitle }}</td>
                  <td class="text-right text-base-content/40 whitespace-nowrap">{{ ch.word_count.toLocaleString() }}
                  </td>
                  <td class="text-base-content/50 whitespace-nowrap">{{ fmtTime(ch.createdAt) }}</td>
                  <td class="text-base-content/50 whitespace-nowrap">{{ fmtTime(ch.updatedAt) }}</td>
                  <td class="text-right">
                    <button class="btn btn-primary btn-xs" @click="go(ch)">
                      <svg xmlns="http://www.w3.org/2000/svg" class="size-3" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 3l14 9-14 9V3z" />
                      </svg>
                      创作
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppModal>
</template>

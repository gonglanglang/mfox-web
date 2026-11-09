<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { worksApi } from '@/api'
import { useToast } from '@/composables/useToast'
import type { WorkItem } from '@/api'

import { useAuth } from '@/composables/useAuth'
import { WORK_TYPE_OPTIONS, WORK_TYPE_BADGE, buildFilterTags } from '@/config/constants'
import WorkFormModal from '@/components/WorkFormModal.vue'
import VideoChapterModal from '@/components/VideoChapterModal.vue'
import AppModal from '@/components/AppModal.vue'

const { toast } = useToast()

// --- Types ---
interface Work {
  id: number
  title: string
  date: string
  words: number
  duration: number
  tag: string
  hasVideo: boolean
  cover: string
}

// --- State ---
const currentFilter = ref('全部')
const router = useRouter()
const openMenuId = ref<number | null>(null)

// --- 视频创作章节选择（VideoChapterModal 组件） ---
const videoModalOpen = ref(false)
const videoWorkId = ref<number | undefined>(undefined)
const videoWorkTitle = ref('')

function openVideoModal(work: Work) {
  videoWorkId.value = work.id
  videoWorkTitle.value = work.title
  videoModalOpen.value = true
}

// 点击章节「创作」：关闭弹窗并进入该章节分镜工作台
function onVideoGo(payload: { workId: number; chapterId: number }) {
  videoModalOpen.value = false
  router.push({ name: 'vs-story', params: { workId: payload.workId }, query: { chapterId: payload.chapterId } })
}

// --- Delete confirmation ---
const deleteTarget = ref<{ id: number; title: string } | null>(null)
const deleting = ref(false)

// --- Set cover ---
const coverWork = ref<Work | null>(null)
const coverFileForUpdate = ref<File | null>(null)
const coverPreviewForUpdate = ref('')
const coverLoading = ref(false)
const coverInputForUpdateRef = ref<HTMLInputElement | null>(null)

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await worksApi.remove(deleteTarget.value.id)
    deleteTarget.value = null
    loadWorks()
  } catch (err: any) {
    alert(err.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

// --- 创建/编辑合并弹窗（WorkFormModal 独立组件） ---
const { user, isLoggedIn, openLogin } = useAuth()
const workModalOpen = ref(false)
const workModalMode = ref<'create' | 'edit'>('create')
const workModalWorkId = ref<number | undefined>(undefined)

// 打开创建弹窗（顶部「创建巨作」按钮触发；篇幅长短在弹窗内选择）
function openCreate() {
  if (!isLoggedIn.value) return openLogin()
  workModalMode.value = 'create'
  workModalWorkId.value = undefined
  workModalOpen.value = true
}

// 保存成功：回到第 1 页刷新（新建作品按时间倒序在第 1 页）
function onWorkSaved() {
  currentPage.value = 1
  loadWorks(1)
}

// --- Works data (from API) ---
const worksData = ref<Work[]>([])
const loadingWorks = ref(false)

function mapWork(item: WorkItem): Work {
  return {
    id: item.id,
    title: item.title,
    date: item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : '',
    words: item.word_count || 0,
    duration: item.word_count ? Math.ceil(item.word_count / 200) : 0,
    tag: item.type,
    hasVideo: item.type === '视频',
    cover: item.cover_url || 'https://picsum.photos/seed/default/400/240',
  }
}

function workTypeBadge(type: string): string {
  return (WORK_TYPE_BADGE as Record<string, string>)[type] || 'badge-ghost'
}

// 分页请求序号：用于丢弃过期响应（快速翻页/切筛选时防竞态）
let worksRequestSeq = 0

async function loadWorks(page = currentPage.value) {
  const seq = ++worksRequestSeq
  loadingWorks.value = true
  try {
    const type = currentFilter.value !== '全部' ? currentFilter.value : undefined
    const { list, total } = await worksApi.list({ page, pageSize: PAGE_SIZE, type })
    if (seq !== worksRequestSeq) return // 已有更新的请求，丢弃本次过期响应
    worksData.value = list.map(mapWork)
    totalCount.value = total
    // 页码越界（如删除作品后总页数减少）：只回退一次到最后一页
    if (list.length === 0 && total > 0 && page > 1) {
      const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
      if (lastPage !== page) {
        currentPage.value = lastPage
        loadWorks(lastPage)
      }
    }
  } catch (err: any) {
    if (seq !== worksRequestSeq) return
    console.error('Failed to load works:', err.message)
  } finally {
    if (seq === worksRequestSeq) loadingWorks.value = false
  }
}

// 登录成功后（userInfo 拉取完毕）自动加载作品列表
watch(user, (val) => {
  if (val) loadWorks()
})

onMounted(() => {
  if (user.value) loadWorks()
})

// --- Filters（仅保留 全部/长篇/短篇，删除剧本、视频 tab） ---
const tags = buildFilterTags()
  .filter(t => t.id === '全部' || t.id === '长篇' || t.id === '短篇')
  .map(t => ({
    id: t.id,
    label: t.label,
    icon: t.id === '全部' ? 'icon-quanbu' : (WORK_TYPE_OPTIONS.find(o => o.value === t.id)?.icon || ''),
  }))

// --- 分页（后端分页，每页 20） ---
const PAGE_SIZE = 20
const currentPage = ref(1)
const totalCount = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))

function setPage(p: number) {
  const next = Math.min(Math.max(1, p), totalPages.value)
  if (next === currentPage.value) return
  currentPage.value = next
  loadWorks(next)
}

// 切换筛选条件：回到第一页并重新请求
watch(currentFilter, () => {
  currentPage.value = 1
  loadWorks(1)
})

// --- Methods ---
function formatWords(words: number): string {
  return (words / 10000).toFixed(1) + '万字'
}

function toggleMenu(id: number) {
  openMenuId.value = openMenuId.value === id ? null : id
}

function closeMenu() {
  openMenuId.value = null
}

async function handleMenuAction(action: string, workId?: number) {
  closeMenu()
  const work = worksData.value.find(w => w.id === workId)
  if (!work) return

  if (action === 'delete') {
    deleteTarget.value = { id: work.id, title: work.title }
  } else if (action === 'edit') {
    // 编辑：打开合并弹窗（WorkFormModal）edit 模式
    workModalMode.value = 'edit'
    workModalWorkId.value = work.id
    workModalOpen.value = true
  } else if (action === 'cover') {
    coverWork.value = work
    coverPreviewForUpdate.value = (work.cover && work.cover !== 'https://picsum.photos/seed/default/400/240') ? work.cover : ''
  }
}

function onCoverFileForUpdateChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  coverFileForUpdate.value = file
  coverPreviewForUpdate.value = URL.createObjectURL(file)
}

function clearCoverForUpdate() {
  coverFileForUpdate.value = null
  coverPreviewForUpdate.value = ''
  if (coverInputForUpdateRef.value) coverInputForUpdateRef.value.value = ''
}

async function handleSetCover() {
  if (!coverWork.value) return
  coverLoading.value = true
  try {
    let url = coverPreviewForUpdate.value
    // 如果选了新文件，先上传
    if (coverFileForUpdate.value && user.value?.id) {
      const formData = new FormData()
      formData.append('file', coverFileForUpdate.value)
      formData.append('bucket', 'cover')
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/oss/file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const json = await res.json()
      if (json.code === 0 || json.code === 200) {
        url = json.data.url as string
      } else {
        throw new Error(json.message || '上传失败')
      }
    }
    if (!url) return
    await worksApi.setCover(coverWork.value.id, url)
    await loadWorks()
    coverWork.value = null
    clearCoverForUpdate()
  } catch (err: any) {
    alert(err.message || '设置封面失败')
  } finally {
    coverLoading.value = false
  }
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.more-dropdown')) {
    closeMenu()
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="space-y-8">
    <!-- ====== 1. Page Header ====== -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold text-base-content">我的巨作库</h1>
        <span class="badge badge-sm bg-[#6C5CE7]/10 text-[#6C5CE7] border-none font-bold px-2.5 py-2.5 text-[10px]">
          共 {{ totalCount }} 部作品
        </span>
      </div>

    </div>

    <!-- ====== 2. Filter Bar 行：筛选 tabs + 创建按钮 ====== -->
    <div class="flex items-end justify-between gap-4">
      <div class="tabs tabs-lift" style="margin: 0;">
        <label v-for="tag in tags" :key="tag.id" class="tab">
          <input type="radio" name="work_filter_tabs" :checked="currentFilter === tag.id"
            @change="currentFilter = tag.id" />
          <span v-if="tag.icon" :class="`iconfont ${tag.icon}`" class="mr-1"></span>
          {{ tag.label }}
        </label>
      </div>
      <!-- 创建按钮（与筛选标签同行） -->
      <button
        class="btn btn-primary"
        @click="openCreate">
        <span class="iconfont icon-chuangjian"></span>
        创建巨作
      </button>
    </div>

    <!-- ====== 3. 内容面板（共享，随筛选刷新） ====== -->
    <div class="tab-content bg-base-100 rounded-b-2xl p-4 sm:p-6 border border-t-0 border-base-300 block!">
      <!-- Empty: 未登录 -->
      <div v-if="!isLoggedIn" class="flex flex-col items-center justify-center py-20">
      <div class="bg-base-200 rounded-full p-6 mb-5">
        <svg xmlns="http://www.w3.org/2000/svg" class="size-12 text-base-content/30" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3 class="text-lg font-bold text-base-content/50 mb-2">登录后查看你的作品</h3>
      <p class="text-sm text-base-content/30 mb-6">登录即可创建、管理和发布你的创作</p>
      <button
        class="btn bg-[#6C5CE7] hover:bg-[#5B4BC4] text-white border-none rounded-xl shadow-lg shadow-[#6C5CE7]/20"
        @click="openLogin">
        <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
        立即登录
      </button>
    </div>

    <!-- Empty: 无作品 / 筛选无结果 -->
    <div v-else-if="worksData.length === 0"
      class="flex flex-col items-center justify-center py-20 text-base-content/30">
      <svg xmlns="http://www.w3.org/2000/svg" class="size-16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
      <p class="mt-4 text-lg">{{ currentFilter === '全部' ? '还没有作品' : '没有找到匹配的作品' }}</p>
      <p v-if="currentFilter === '全部'" class="text-sm text-base-content/20 mt-1">点击右上角「创建作品」开始创作</p>
    </div>

    <!-- Works Grid（<1280px 一排 4 个，≥1280px 一排 5 个；手机 2 列保证可用） -->
    <div v-else class="grid gap-3 grid-cols-2 sm:grid-cols-4 xl:grid-cols-5">
      <div v-for="work in worksData" :key="work.id"
        class="card bg-base-100 border shadow-sm border-base-200 hover:shadow-[0_4px_24px_rgba(108,92,231,0.2)] transition-shadow duration-300">
        <!-- Cover：模糊背景 + 完整封面（object-cover 会裁切竖版封面，改用 contain 保留全图） -->
        <figure class="relative overflow-hidden aspect-4/3 cursor-pointer group"
          @click="router.push({ name: 'write', query: { workId: work.id } })">
          <!-- 模糊背景（铺满容器，提供氛围色） -->
          <div class="absolute inset-0 overflow-hidden">
            <img :src="work.cover" alt="" class="w-full h-full object-cover blur-xl scale-110 opacity-40" />
          </div>
          <!-- 完整封面（保留 3:4 完整画面） -->
          <div class="absolute inset-0 flex items-center justify-center p-2.5">
            <img :src="work.cover" :alt="'Cover for ' + work.title"
              class="max-w-full max-h-full object-contain rounded-lg shadow-lg ring-1 ring-black/5 group-hover:scale-105 transition-transform duration-500" />
          </div>

          <div v-if="work.hasVideo"
            class="absolute top-1.5 right-1.5 bg-black/40 backdrop-blur-md text-white p-0.5 rounded-md flex items-center justify-center z-10">
            <svg xmlns="http://www.w3.org/2000/svg" class="size-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
          </div>
          <!-- Tag badge -->
            <button class="btn btn-xs absolute top-1.5 left-1.5 text-white font-bold" :class="workTypeBadge(work.tag)">{{ work.tag }}</button>
        </figure>

        <!-- Body -->
        <div class="card-body p-2.5 gap-0">
          <!-- Title -->
          <h3
            class="text-sm font-bold text-base-content group-hover:text-[#6C5CE7] transition-colors line-clamp-1 leading-snug">
            {{ work.title }}
          </h3>

          <!-- Meta -->
          <p class="text-[11px] text-base-content/40 font-medium mt-0.5">{{ formatWords(work.words) }} · {{
            work.duration }}分钟 · {{ work.date }}</p>

          <!-- Actions -->
          <div class="flex items-center justify-between mt-2">
            <button class="btn btn-dash btn-primary btn-xs" @click="openVideoModal(work)">
              <i class="iconfont icon-manjuguanli"></i>
              生成视频
            </button>
            <!-- More dropdown -->
            <div class="more-dropdown dropdown dropdown-bottom" :class="{ 'dropdown-open': openMenuId === work.id }">
              <button class="btn btn-circle btn-ghost" @click.stop="toggleMenu(work.id)">
                <i class="iconfont icon-bianji"></i>
              </button>
              <ul
                class="dropdown-content menu menu-xs bg-base-100 rounded-lg shadow-lg border border-base-200 w-32 mt-0.5 p-1"
                @click.stop>
                <li><button class="text-xs" @click="handleMenuAction('edit', work.id)">编辑信息</button></li>
                <li><button class="text-xs" @click="handleMenuAction('cover', work.id)">设置封面</button></li>
                <li><button class="text-xs text-error" @click="handleMenuAction('delete', work.id)">删除作品</button></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-center gap-1 pt-6">
        <button class="join-item btn btn-sm" :disabled="currentPage <= 1" @click="setPage(currentPage - 1)">«</button>
        <button v-for="p in totalPages" :key="p" class="join-item btn btn-sm"
          :class="p === currentPage ? 'btn-primary text-white' : ''" @click="setPage(p)">{{ p }}</button>
        <button class="join-item btn btn-sm" :disabled="currentPage >= totalPages"
          @click="setPage(currentPage + 1)">»</button>
      </div>
    </div>

    <!-- ====== 4. 创建 / 编辑 合并弹窗（WorkFormModal 独立组件） ====== -->
    <WorkFormModal :open="workModalOpen" :mode="workModalMode" :work-id="workModalWorkId"
      @close="workModalOpen = false" @saved="onWorkSaved" />

    <!-- ====== 5.5 Delete Confirmation Modal（AppModal） ====== -->
    <AppModal :open="!!deleteTarget" @close="deleteTarget = null">
      <div v-if="deleteTarget" class="modal-box max-w-sm w-full rounded-2xl p-6">
        <!-- 图标 + 标题行 -->
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 bg-error/10 text-error rounded-xl flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <h3 class="font-bold text-base">删除作品</h3>
            <p class="text-xs text-base-content/50">此操作不可撤销</p>
          </div>
        </div>

        <!-- 作品名 -->
        <div class="bg-base-200 rounded-xl px-4 py-3 mb-5">
          <p class="text-sm font-medium truncate">{{ deleteTarget.title }}</p>
        </div>

        <!-- 按钮 -->
        <div class="flex gap-2.5">
          <button class="btn btn-ghost flex-1 rounded-xl text-sm" @click="deleteTarget = null"
            :disabled="deleting">取消</button>
          <button class="btn btn-error flex-1 rounded-xl text-white text-sm" @click="confirmDelete"
            :disabled="deleting">
            <span v-if="deleting" class="loading loading-spinner loading-xs"></span>
            确认删除
          </button>
        </div>
      </div>
    </AppModal>

    <!-- ====== 5.55 视频章节选择弹窗（VideoChapterModal 组件） ====== -->
    <VideoChapterModal :open="videoModalOpen" :work-id="videoWorkId" :work-title="videoWorkTitle"
      @close="videoModalOpen = false" @go="onVideoGo" />

    <!-- ====== 5.7 Set Cover Modal ====== -->
    <AppModal :open="!!coverWork" @close="coverWork = null; clearCoverForUpdate()">
      <div v-if="coverWork" class="modal-box max-w-sm w-full rounded-2xl p-0 overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <h3 class="text-lg font-bold text-base-content">设置封面</h3>
            <button class="btn btn-sm btn-ghost btn-circle" @click="coverWork = null; clearCoverForUpdate()"
              :disabled="coverLoading">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="px-5 py-5 space-y-4">
            <div v-if="!coverPreviewForUpdate"
              class="w-full border-2 border-dashed border-base-300 rounded-xl p-8 flex flex-col items-center justify-center hover:border-[#6C5CE7] hover:bg-[#6C5CE7]/5 transition-all cursor-pointer gap-2"
              @click="coverInputForUpdateRef?.click()">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-8 text-base-content/20" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span class="text-sm text-base-content/40">点击上传封面图</span>
              <span class="text-xs text-base-content/20">支持 JPG / PNG / WebP，建议 3:4 比例</span>
            </div>
            <div v-else class="flex justify-center">
              <div class="relative inline-flex">
                <img :src="coverPreviewForUpdate" alt="封面预览"
                  class="h-44 object-cover rounded-xl border border-base-200 shadow-sm" />
                <button
                  class="btn btn-xs btn-circle btn-ghost bg-base-100/80 hover:bg-error hover:text-white absolute -top-1.5 -right-1.5 shadow"
                  @click="clearCoverForUpdate()" :disabled="coverLoading">
                  <svg xmlns="http://www.w3.org/2000/svg" class="size-2.5" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <input ref="coverInputForUpdateRef" type="file" accept="image/jpeg,image/png,image/webp" class="hidden"
              @change="onCoverFileForUpdateChange" />
          </div>
          <div class="flex items-center justify-end gap-3 px-5 py-4 border-t border-base-200 bg-base-200/30">
            <button class="btn btn-ghost rounded-xl btn-sm" @click="coverWork = null; clearCoverForUpdate()"
              :disabled="coverLoading">取消</button>
            <button
              class="btn bg-[#6C5CE7] hover:bg-[#5B4BC4] text-white border-none rounded-xl shadow-lg shadow-[#6C5CE7]/20 btn-sm"
              :disabled="coverLoading" @click="handleSetCover">
              <span v-if="coverLoading" class="loading loading-spinner loading-xs"></span>
              <span>{{ coverLoading ? '上传中…' : '确认修改' }}</span>
            </button>
          </div>
        </div>
    </AppModal>
  </div>

  <!-- Toast -->
  <div v-if="toast" class="fixed inset-x-0 z-[9999] flex justify-center pointer-events-none" style="top: 10vh">
    <div class="alert shadow-2xl pointer-events-auto animate-[scale-in_0.2s_ease-out] px-6 py-3 gap-3"
      :class="toast.type === 'success' ? 'alert-success' : toast.type === 'error' ? 'alert-error' : 'alert-info'">
      <svg v-if="toast.type === 'success'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
        viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <svg v-else-if="toast.type === 'error'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
        viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
        stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span class="text-lg font-bold">{{ toast.message }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Scale-in animation for modal */
@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.9);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>

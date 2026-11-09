<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { worksApi, type WorkVideoItem, type ChapterVideoItem } from '@/api/works'
import { useAuth } from '@/composables/useAuth'
import { WORK_TYPE_BADGE } from '@/config/constants'

const router = useRouter()
const { user, isLoggedIn, openLogin } = useAuth()

// ⚠️ 测试数据：先写死便于查看样式，接入真实接口后删除本段并把 works 初始值改回 []（恢复 loadVideos）
interface MockPanel {
  panelIdx: number
  scene: string
  panelStatus: 'done' | 'generating' | 'idle' | 'error'
  finalVideoUrl?: string
}
interface ChapterDetail extends ChapterVideoItem {
  volumeId: number | null
  panels: MockPanel[]
}
interface WorkDetail extends WorkVideoItem {
  chapters: ChapterDetail[]
}

const MOCK_VIDEOS: WorkDetail[] = [
  {
    workId: 101, workTitle: '星海纪元', cover_url: 'https://picsum.photos/seed/star/400/240', type: '长篇',
    chapters: [
      {
        id: 1001, title: '第一章·启航', volumeTitle: '第一卷·初入星海', volumeId: 1, chapter_no: 1,
        videoStatus: 'done', doneCount: 3, totalCount: 3,
        panels: [
          { panelIdx: 0, scene: '星舰缓缓驶离太空港，引擎喷射出蓝色尾焰', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
          { panelIdx: 1, scene: '主角站在舰桥，眺望浩瀚星河', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4' },
          { panelIdx: 2, scene: 'AI 助手浮现全息投影，报告航线', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
        ],
      },
      {
        id: 1002, title: '第二章·暗流', volumeTitle: '第一卷·初入星海', volumeId: 1, chapter_no: 2,
        videoStatus: 'making', doneCount: 1, totalCount: 4,
        panels: [
          { panelIdx: 0, scene: '舰队在暗物质带中航行', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4' },
          { panelIdx: 1, scene: '雷达探测到不明信号', panelStatus: 'generating' },
          { panelIdx: 2, scene: '全员进入战斗准备', panelStatus: 'idle' },
          { panelIdx: 3, scene: '敌人舰队跃迁出现', panelStatus: 'idle' },
        ],
      },
      {
        id: 1003, title: '第三章·抉择', volumeTitle: '第一卷·初入星海', volumeId: 1, chapter_no: 3,
        videoStatus: 'making', doneCount: 0, totalCount: 0,
        panels: [],
      },
    ],
  },
  {
    workId: 102, workTitle: '迷雾之城', cover_url: 'https://picsum.photos/seed/fog/400/240', type: '短篇',
    chapters: [
      {
        id: 2001, title: '第一章·失踪', volumeTitle: '', volumeId: null, chapter_no: 1,
        videoStatus: 'done', doneCount: 2, totalCount: 2,
        panels: [
          { panelIdx: 0, scene: '雨夜，侦探事务所的灯还亮着', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4' },
          { panelIdx: 1, scene: '委托人递上一张泛黄的旧照片', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4' },
        ],
      },
      {
        id: 2002, title: '第二章·线索', volumeTitle: '', volumeId: null, chapter_no: 2,
        videoStatus: 'making', doneCount: 0, totalCount: 2,
        panels: [
          { panelIdx: 0, scene: '废弃仓库里发现神秘符号', panelStatus: 'generating' },
          { panelIdx: 1, scene: '墙上的旧报纸标题若隐若现', panelStatus: 'idle' },
        ],
      },
      {
        id: 2003, title: '第三章·真相', volumeTitle: '', volumeId: null, chapter_no: 3,
        videoStatus: 'making', doneCount: 0, totalCount: 0,
        panels: [],
      },
    ],
  },
  {
    workId: 103, workTitle: '她的名字', cover_url: 'https://picsum.photos/seed/her/400/240', type: '短篇',
    chapters: [
      {
        id: 3001, title: '第一章·初见', volumeTitle: '序章', volumeId: 3, chapter_no: 1,
        videoStatus: 'done', doneCount: 5, totalCount: 5,
        panels: [
          { panelIdx: 0, scene: '樱花飘落的街道，她回眸一笑', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4' },
          { panelIdx: 1, scene: '咖啡店窗边，两人初次对话', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4' },
          { panelIdx: 2, scene: '黄昏的河堤，并肩散步', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4' },
          { panelIdx: 3, scene: '雨中的车站，交换联系方式', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4' },
          { panelIdx: 4, scene: '夜晚窗前，写下她的名字', panelStatus: 'done', finalVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4' },
        ],
      },
    ],
  },
]

const loading = ref(false)
const works = ref<WorkDetail[]>(MOCK_VIDEOS)

async function loadVideos() {
  // 真实接口：works.value = await worksApi.videos()（当前用写死测试数据，暂不请求）
  // if (!isLoggedIn.value) return
  // loading.value = true
  // try {
  //   works.value = await worksApi.videos()
  // } catch (e: any) {
  //   console.error('加载漫剧视频失败:', e.message)
  // } finally {
  //   loading.value = false
  // }
}

watch(user, (val) => {
  if (val) loadVideos()
})

function workTypeBadge(type: string): string {
  return (WORK_TYPE_BADGE as Record<string, string>)[type] || 'badge-ghost'
}

const totalVideos = () => works.value.reduce((s, w) => s + w.chapters.length, 0)

// ── 左树：两级（作品 → 卷章），章节全部渲染在右侧 ──
const expandedWorks = reactive(new Set<number>())
MOCK_VIDEOS.forEach(w => expandedWorks.add(w.workId))

const selectedWorkId = ref<number | null>(null)
const selectedVolumeTitle = ref<string | null>(null) // null=未选择；''=未分卷

function toggleWork(id: number) {
  expandedWorks.has(id) ? expandedWorks.delete(id) : expandedWorks.add(id)
}

/** 作品下所有卷（含"未分卷"占位组），树只显示到这一级 */
function workVolumes(work: WorkDetail) {
  const titles: string[] = []
  for (const ch of work.chapters) {
    const t = ch.volumeTitle || ''
    if (!titles.includes(t)) titles.push(t)
  }
  return titles.map(t => ({ title: t, count: work.chapters.filter(c => (c.volumeTitle || '') === t).length }))
}

function selectVolume(work: WorkDetail, title: string) {
  selectedWorkId.value = work.workId
  selectedVolumeTitle.value = title
}

/** 右侧渲染的章节（当前选中卷下所有章节，平铺展示） */
const rightChapters = computed(() => {
  const work = works.value.find(w => w.workId === selectedWorkId.value)
  if (!work || selectedVolumeTitle.value === null) return []
  return work.chapters.filter(c => (c.volumeTitle || '') === selectedVolumeTitle.value)
})

const rightWork = computed(() => works.value.find(w => w.workId === selectedWorkId.value) || null)

/** 章节成品视频：取第一个已完成分镜的视频 URL */
function chapterVideoUrl(ch: ChapterDetail) {
  return ch.panels.find(p => p.panelStatus === 'done' && p.finalVideoUrl)?.finalVideoUrl || ''
}

// 默认选中第一部作品的第一个卷
onMounted(() => {
  if (works.value.length) {
    const first = works.value[0]
    const vols = workVolumes(first)
    if (vols.length) selectVolume(first, vols[0].title)
  }
})
</script>

<template>
  <div class="space-y-8">
    <!-- ====== 1. Page Header ====== -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold text-base-content">漫剧视频</h1>
        <span class="badge badge-sm bg-[#6C5CE7]/10 text-[#6C5CE7] border-none font-bold px-2.5 py-2.5 text-[10px]">
          {{ works.length }} 部作品 · {{ totalVideos() }} 个章节视频
        </span>
      </div>
    </div>

    <!-- ====== 2. Empty: 未登录（无数据时才拦截，写死测试数据时直接展示） ====== -->
    <div v-if="!isLoggedIn && works.length === 0" class="flex flex-col items-center justify-center py-20">
      <div class="bg-base-200 rounded-full p-6 mb-5">
        <svg xmlns="http://www.w3.org/2000/svg" class="size-12 text-base-content/30" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M10 9l5 3-5 3z" />
        </svg>
      </div>
      <h3 class="text-lg font-bold text-base-content/50 mb-2">登录后查看你的章节视频</h3>
      <p class="text-sm text-base-content/30 mb-6">登录即可查看各章节视频的生成进度</p>
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

    <!-- ====== 3. Loading ====== -->
    <div v-else-if="loading" class="flex gap-5 items-start">
      <div class="w-72 shrink-0 skeleton h-[60vh] rounded-2xl"></div>
      <div class="flex-1 skeleton h-[60vh] rounded-2xl"></div>
    </div>

    <!-- ====== 4. Empty: 无作品 ====== -->
    <div v-else-if="works.length === 0" class="flex flex-col items-center justify-center py-20 text-base-content/30">
      <svg xmlns="http://www.w3.org/2000/svg" class="size-16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M10 9l5 3-5 3z" />
      </svg>
      <h3 class="mt-4 text-lg font-bold text-base-content/50">还没有作品</h3>
      <p class="text-sm text-base-content/20 mt-1">去「文章创作」创建作品，再为章节制作视频</p>
      <button class="btn btn-ghost btn-sm mt-6 text-[#6C5CE7]" @click="router.push('/create')">前往文章创作 →</button>
    </div>

    <!-- ====== 5. 主布局：左树（两级）+ 右侧章节平铺 ====== -->
    <div v-else class="flex flex-col lg:flex-row gap-5 items-start">
      <!-- ═══════ 左侧：树状目录（作品 → 卷） ═══════ -->
      <aside
        class="w-full lg:w-72 shrink-0 bg-base-100 border border-base-200 rounded-2xl p-3 max-h-[70vh] lg:max-h-[calc(100vh-14rem)] overflow-y-auto sticky lg:top-0">
        <div class="flex items-center justify-between px-1 pb-2">
          <span class="text-xs font-bold text-base-content/40 uppercase tracking-widest">作品目录</span>
          <span class="text-[10px] text-base-content/25">共 {{ totalVideos() }} 章</span>
        </div>

        <ul class="space-y-0.5">
          <li v-for="work in works" :key="work.workId">
            <!-- 一级：作品 -->
            <button
              class="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-base-200/70 transition-colors"
              @click="toggleWork(work.workId)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-base-content/30 shrink-0 transition-transform duration-200"
                :class="expandedWorks.has(work.workId) ? 'rotate-90' : ''" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="truncate flex-1 text-left">{{ work.workTitle }}</span>
              <span class="badge badge-sm border-none text-white font-bold shrink-0"
                :class="workTypeBadge(work.type)">{{ work.type }}</span>
            </button>

            <!-- 二级：卷（叶子节点，点击后在右侧渲染该卷全部章节） -->
            <ul v-if="expandedWorks.has(work.workId)" class="ml-3 border-l border-base-200 pl-2 mt-0.5 space-y-0.5">
              <li v-for="vol in workVolumes(work)" :key="vol.title || 'unlinked'">
                <button
                  class="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors"
                  :class="selectedWorkId === work.workId && selectedVolumeTitle === vol.title
                    ? 'bg-[#6C5CE7]/10 text-[#6C5CE7] font-semibold'
                    : 'text-base-content/60 hover:bg-base-200/70'"
                  @click="selectVolume(work, vol.title)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 shrink-0 text-base-content/30"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  <span class="truncate flex-1 text-left">{{ vol.title || '未分卷' }}</span>
                  <span class="text-[10px] text-base-content/25 shrink-0">{{ vol.count }} 章</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </aside>

      <!-- ═══════ 右侧：章节全部平铺渲染 ═══════ -->
      <section class="flex-1 min-w-0 bg-base-100 border border-base-200 rounded-2xl p-5">
        <!-- 空态：未选择卷 -->
        <div v-if="!rightWork || selectedVolumeTitle === null"
          class="h-[50vh] flex flex-col items-center justify-center text-base-content/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="size-14 mb-3" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M10 9l5 3-5 3z" />
          </svg>
          <p class="text-sm">从左侧选择卷，查看章节视频</p>
        </div>

        <div v-else class="space-y-5">
          <!-- 当前范围标题 -->
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <h2 class="text-lg font-bold text-base-content truncate">{{ rightWork.workTitle }}</h2>
              <span class="badge badge-sm border-none text-white font-bold shrink-0"
                :class="workTypeBadge(rightWork.type)">{{ rightWork.type }}</span>
              <span class="text-sm text-base-content/40">·</span>
              <span class="text-sm text-base-content/60 truncate">{{ selectedVolumeTitle || '未分卷' }}</span>
            </div>
            <span class="badge badge-sm bg-base-200 text-base-content/50 border-none font-medium">{{ rightChapters.length }}
              章</span>
          </div>

          <!-- 章节列表（紧凑行式） -->
          <div v-if="rightChapters.length" class="space-y-3">
            <div v-for="ch in rightChapters" :key="ch.id"
              class="flex items-center gap-3.5 sm:gap-4 rounded-2xl border border-base-200 bg-base-100 p-3 hover:shadow-md transition-shadow">
              <!-- 小播放器 / 制作中占位 -->
              <div class="w-40 sm:w-56 shrink-0 aspect-video rounded-xl overflow-hidden bg-black">
                <video v-if="chapterVideoUrl(ch)" :key="chapterVideoUrl(ch)" :src="chapterVideoUrl(ch)" controls
                  class="w-full h-full object-contain" :poster="rightWork.cover_url || undefined"></video>
                <div v-else class="w-full h-full flex flex-col items-center justify-center gap-1.5">
                  <span class="loading loading-spinner loading-sm text-warning"></span>
                  <span class="text-[10px] text-white/60">制作中</span>
                </div>
              </div>
              <!-- 信息 + 状态 -->
              <div class="flex-1 min-w-0 flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="font-bold text-sm text-base-content truncate">{{ ch.title }}</h3>
                  <p class="text-[11px] text-base-content/40 mt-1 truncate">{{ ch.volumeTitle || '未分卷' }}</p>
                </div>
                <span v-if="ch.videoStatus === 'done'"
                  class="badge badge-sm badge-success gap-1 border-none shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  已生成
                </span>
                <span v-else class="badge badge-sm badge-warning gap-1.5 border-none shrink-0">
                  <span class="loading loading-spinner loading-xs"></span>
                  制作中
                </span>
              </div>
            </div>
          </div>

          <!-- 该卷无章节 -->
          <div v-else class="h-40 flex flex-col items-center justify-center text-base-content/30">
            <p class="text-sm">该卷下暂无章节</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

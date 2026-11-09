<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { streamPolish, streamAiNovel } from '@/api/stream'
import { genresApi } from '@/api/genres'
import WorkflowTimeline from '@/components/WorkflowTimeline.vue'
import SegmentSelector from '@/components/SegmentSelector.vue'
import PolishModal from '@/components/PolishModal.vue'
import { useTaskRecovery } from '@/composables/useTaskRecovery'
import { useAuth } from '@/composables/useAuth'
import { isUnauthorizedError } from '@/utils/status'
import { AUDIENCES, POVS } from '@/config/constants'
import { useWorkflowTimeline, type TimelineStep } from '@/composables/useWorkflowTimeline'
import ModelPicker from '@/components/ModelPicker.vue'

const router = useRouter()
const { isLoggedIn, openLogin, refreshUser } = useAuth() // 未登录拦截 + 任务消耗积分后刷新用户信息

// --- Category state ---
const selectedGenre = ref('') // 选中的题材
const audience = ref('全频') // 目标受众
const pov = ref('第一人称') // 视角
const length = ref('短篇小说') // 作品长度
const LENGTHS = ['短篇小说', '长篇小说'] // 作品长度
const modelValue = ref('') // 选中的模型

const genres = ref<string[]>([])

async function loadGenres(): Promise<void> {
  try {
    const list = await genresApi.list()
    genres.value = (list || []).map((g) => g.name)
    if (genres.value.length && !genres.value.includes(selectedGenre.value)) {
      selectedGenre.value = genres.value[0]
    }
  } catch {
    // 题材加载失败时静默降级，保留当前选中值
  }
}

onMounted(loadGenres) // 加载题材

// --- Input state ---
const prompt = ref('') // 作品简介

const timeline = useWorkflowTimeline() // 工作流时间链

const creating = ref(false) // 是否正在创作

// streamAiNovel 的 SSE 连接控制：跳转/卸载时必须主动断开，
// 否则 Home 的连接在跳转后仍存活，与 Write 页 useTaskRecovery 的重连形成双连接，同一批事件被重复接收
let novelStreamAbort: (() => void) | null = null
function abortNovelStream(): void {
  if (novelStreamAbort) {
    novelStreamAbort()
    novelStreamAbort = null
  }
}

onUnmounted(() => {
  // 兜底：任何原因离开 Home 页都断开连接，避免任务继续执行但无人接收
  abortNovelStream()
})

const STEPS_CONFIG: TimelineStep[] = [
  { name: 'create-novel', label: '创建小说', status: 'wait' },
  { name: 'create-volumes-chapter', label: '生成卷章', status: 'wait' },
  { name: 'generate-chapter-content', label: 'AI 生成内容', status: 'wait' },
]

// 开始创作
function startCreate(): void {
  if (!isLoggedIn.value) {
    openLogin() // 未登录：弹出登录组件，不发起请求
    return
  }
  if (!prompt.value.trim() || creating.value) return
  creating.value = true
  timeline.start(STEPS_CONFIG)
  const stream = streamAiNovel(
    modelValue.value, // 选择的模型
    {
      description: prompt.value, // 作品简介
      length: length.value === '短篇小说' ? '短篇' : '长篇', // 长度
      audience: audience.value, // 目标受众
      pov: pov.value, // 视角
      genre: selectedGenre.value, // 题材风格
      stepsConfig: JSON.stringify(STEPS_CONFIG), // 步骤配置
    },
    {
      onChunk(text) {
        console.log('流式内容', text)
        timeline.setContent(text)
      },
      onStepStart(id) {
        timeline.setRunning(id)
      },
      onStepDone(id, output) {
        console.log('分段步骤完成', id, output)
        timeline.setDone(id)
        // 步骤完成时，更新时间链状态
        if (id === 'create-novel' && output.workId) timeline.targetWorkId.value = output.workId
        // 步骤完成时，跳转到创作页面
        if (id === 'create-volumes-chapter') {
          creating.value = false
          // 断开本页 SSE：Write 页恢复重连将接管剩余事件，避免双连接重复接收
          abortNovelStream()
          const wid = timeline.targetWorkId.value
          if (wid) router.push({ name: 'write', query: { workId: wid } })
        }
        if (id === 'generate-chapter-content' && output.content) {
          timeline.setFinalContent(output.content)
          timeline.contentFinalized.value = true
        }
      },
      onDone() {
        refreshUser() // 生成完成，刷新积分
      },
      onError(err) {
        // sse.ts 已保证主动 abort 不触发 onError，这里只处理真实错误
        creating.value = false
        refreshUser() // 生成失败会退款，刷新积分
        timeline.hide()
        // 未登录：提示（登录框由 stream.ts 派发的全局事件统一弹出）
        if (isUnauthorizedError(err)) {
          alert('请先完成登录')
          return
        }
        alert('创作失败: ' + err.message)
      },
    },
  )
  novelStreamAbort = stream.abort
}

// --- Polish state ---
const polishing = ref(false)
const polishDone = ref(false)
const showPolishModal = ref(false)
const polishedText = ref('')

// --- Task recovery: reconnects running polish on page load ---
useTaskRecovery(
  (token) => {
    // 任务恢复时，自动开始润色
    if (!showPolishModal.value) showPolishModal.value = true
    polishedText.value += token // 任务恢复时，自动开始润色，回显到 polishModal 中
    polishing.value = false // 任务恢复时，自动开始润色，重置状态
  },
  () => {
    /* done */
    console.log('任务恢复完成')
    refreshUser() // 恢复场景积分可能已变化，刷新
  },
  (meta) => {
    console.log('任务恢复开始', meta)
    // 回显题材、目标读者、内容
    if (meta.genre) selectedGenre.value = meta.genre
    if (meta.audience) audience.value = meta.audience
    if (meta.description) prompt.value = meta.description

    polishing.value = true // 任务恢复时，自动开始润色
    polishedText.value = '' // 任务恢复时，清空润色结果
  },
  undefined,
  undefined,
  // 恢复润色任务
  { types: ['polish'] },
)

// 开始润色
function handlePolish(): void {
  if (!isLoggedIn.value) {
    openLogin() // 未登录：弹出登录组件，不发起请求、不进入"润色中"状态
    return
  }
  if (!prompt.value.trim() || polishing.value) return
  polishing.value = true
  polishedText.value = ''
  // 开始润色 prompt提示词 ，并回显到 polishModal 中
  streamPolish(prompt.value, selectedGenre.value, audience.value, pov.value, modelValue.value, {
    onToken(token) {
      if (!showPolishModal.value) showPolishModal.value = true
      polishedText.value += token
    },
    onDone() {
      polishing.value = false
      polishDone.value = true
      setTimeout(() => {
        polishDone.value = false
      }, 2000)
      refreshUser() // 刷新积分（预扣已发生）
    },
    onError(err) {
      polishing.value = false
      // 未登录：弹出登录组件（登录框由 useAuth 全局事件统一弹出，这里直接调用兜底）
      if (isUnauthorizedError(err)) {
        polishedText.value = ''
        openLogin()
        return
      }
      polishedText.value = `润色失败: ${err.message}`
      refreshUser() // 刷新积分（失败已退款）
    },
  })
}

// 接受润色结果
function acceptPolish(): void {
  prompt.value = polishedText.value
  showPolishModal.value = false
  polishedText.value = ''
}
</script>

<template>
  <WorkflowTimeline />
  <div>
    <!-- ===== 1. 核心标题区 ===== -->
    <header class="text-center mb-10 relative">
      <div class="inline-flex items-center justify-center gap-4">
        <h1 class="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight">
          一句话生成<span class="text-primary">爆款漫画</span>
        </h1>
        <div class="relative hidden sm:block">
          <div class="absolute -top-6 -right-6 w-16 h-16 bg-primary/10 rounded-full -z-10 opacity-60 blur-xl"></div>

          <svg class="icon" style="width: 50px; height: 50px;" aria-hidden="true">
            <use xlink:href="#icon-huli"></use>
          </svg>
        </div>
      </div>

      <div class="mt-2 font-extrabold tracking-tight">给 AI 一个灵感，还你一个精彩世界</div>
    </header>

    <!-- ===== 2. 创作分类选择区 ===== -->
    <div class="bg-base-100 rounded-3xl p-5 md:p-6 shadow-sm border border-base-200 mb-8 space-y-6">
      <!-- 第一行：题材标签 -->
      <div class="flex items-start gap-3 md:gap-4">
        <span class="text-sm font-semibold text-base-content/40 mt-1.5 shrink-0">题材</span>
        <div class="flex flex-wrap gap-2 items-center">
          <button v-for="g in genres" :key="g" class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            :class="selectedGenre === g
              ? 'border border-primary/30 bg-primary/10 text-primary'
              : 'border border-base-200 bg-base-100 text-base-content/60 hover:border-primary/30 hover:text-primary'
              " @click="selectedGenre = g">
            {{ g }}
          </button>
        </div>
      </div>

      <!-- 第二行：目标读者 / 视角 / 篇幅 -->
      <div class="flex flex-col md:flex-row gap-6 md:gap-8 pt-2">
        <SegmentSelector label="目标读者" v-model="audience" :options="AUDIENCES" />
        <SegmentSelector label="作品视角" v-model="pov" :options="POVS" />
        <SegmentSelector label="篇幅长短" v-model="length" :options="LENGTHS" />
      </div>
    </div>

    <!-- ===== 3. 输入与创作区 ===== -->
    <div class="mb-12">
      <div class="bg-base-100 mb-2">
        <div class="relative">
          <textarea v-model="prompt" rows="5" placeholder="一个普通外卖员发现自己拥有超能力，从此卷入一场外太空阴谋..."
            class="w-full textarea textarea-primary min-h-25 textarea-lg" :disabled="polishing"
            maxlength="500"></textarea>

          <!-- 润色加载遮罩 -->
          <div v-if="polishing"
            class="absolute inset-0 bg-base-100/60 backdrop-blur-[2px] rounded-t-[2rem] flex flex-col items-center justify-center gap-2 z-10">
            <span class="loading loading-dots loading-md text-primary"></span>
            <span class="text-xs text-base-content/50">AI 正在润色中...</span>
          </div>
        </div>
      </div>

      <div class="w-full flex justify-between items-center">
        <span class="text-xs text-base-content/40 font-mono pl-2">{{ prompt.length }} / 500</span>

        <div class="flex items-center gap-2">
          <ModelPicker v-model="modelValue" label="模型" modelType="text" />

          <!-- AI 润色 (DaisyUI button) -->
          <button class="btn btn-ghost btn-xs" :disabled="!prompt.trim() || polishing" @click="handlePolish">
            <span v-if="polishing" class="loading loading-spinner loading-xs"></span>
            <svg v-else-if="polishDone" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" fill="none"
              viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
              stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            <template v-if="polishing">润色中...</template>
            <template v-else-if="polishDone">已完成</template>
            <template v-else>AI润色</template>
          </button>

          <!-- 开始创作 (DaisyUI button) -->
          <button class="btn btn-primary btn-xs" :disabled="!prompt.trim() || creating" @click="startCreate">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
              stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            开始创作
          </button>
        </div>
      </div>
    </div>

    <!-- ===== 润色结果 Modal ===== -->
    <PolishModal v-model:show="showPolishModal" :text="polishedText" :polishing="polishing" @accept="acceptPolish" />
  </div>
</template>

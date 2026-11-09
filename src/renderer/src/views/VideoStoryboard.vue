<script setup lang="ts">
/**
 * 分镜工作台：本组件只负责
 *  1. 路由 / tab 切换
 *  2. 加载并持有「公共参数」（作品/章节/分镜/素材/配音/风格）
 *  3. 把公共参数通过 props 分发给 5 个 tab 组件
 * 各 tab 的业务逻辑（AI 提取、编辑、重绘、视频、合成、轮询）均在各 tab 组件内部实现。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { worksApi } from '@/api/works'
import { personasApi, type PersonaItem } from '@/api/personas'
import { voicesApi, type VoiceItem } from '@/api/voices'
import ModelPicker from '@/components/ModelPicker.vue'
import type { ModelContentType } from '@/api/models'
import StoryTab from '@/views/tabs/StoryTab.vue'
import StoryAssetsTab from '@/views/tabs/StoryAssetsTab.vue'
import BreakdownTab from '@/views/tabs/BreakdownTab.vue'
import StoryboardTab from '@/views/tabs/StoryboardTab.vue'
import ComposeTab from '@/views/tabs/ComposeTab.vue'
import PointsBadge from '@/components/PointsBadge.vue'
import UserMenu from '@/components/UserMenu.vue'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const { show: showToast } = useToast()

// ── 公共参数：作品 / 章节 ──
const workId = ref(Number(route.params.workId) || 0)
const chapterId = ref(Number(route.query.chapterId) || 0)
const workTitle = ref('')
const chapterTitle = ref('')
const loading = ref(true)
const chapterContent = ref('')

// ── Tabs（从路由 meta 读取当前 tab）──
type TabKey = 'story' | 'assets' | 'breakdown' | 'storyboard' | 'compose'
const tabs: { key: TabKey; label: string; desc: string }[] = [
  { key: 'story', label: '小说故事', desc: '查看与确认原文' },
  { key: 'assets', label: '故事素材', desc: '角色·场景·道具·配音' },
  { key: 'breakdown', label: '分镜拆分', desc: '拆解为镜头脚本' },
  { key: 'storyboard', label: '分镜制作', desc: 'AI生成分镜画面' },
  { key: 'compose', label: '作品合成', desc: '导出最终视频' },
]
const activeTab = computed<TabKey>(() => (route.meta.tab as TabKey) || 'story')
const stepIndex = computed(() => tabs.findIndex(t => t.key === activeTab.value))

// ── 步骤模型选择器：按当前工作流步骤渲染不同类型模型，每步骤分别记忆 ──
// storyboard 步骤同时有「AI 重绘(image)」与「分镜视频(video)」：header 提供 image（重绘），
// 分镜视频作为个别特殊情况由 StoryboardTab 组件内自行选择 video 模型
const MODEL_TYPES_BY_TAB: Record<TabKey, ModelContentType[]> = {
  story: ['text'],        // 角色提取（character-extract）
  assets: ['text', 'image'], // 素材提示词 + 素材图片
  breakdown: ['text'],    // 分镜提取（storyboard-breakdown）
  storyboard: ['text', 'image'], // 分镜提示词 + 分镜图片
  compose: ['video'],     // 成品合成（预留）
}
// 每个步骤记住自己选中的模型，切换步骤互不影响
const stepModel = reactive<Record<TabKey, string>>({ story: '', assets: '', breakdown: '', storyboard: '', compose: '' })
const stepModelSelections = reactive<Record<TabKey, Partial<Record<ModelContentType, string>>>>({
  story: {}, assets: {}, breakdown: {}, storyboard: {}, compose: {},
})
const stepQuality = reactive<Record<TabKey, string>>({ story: '', assets: '', breakdown: '', storyboard: '', compose: '' })
const stepResolution = reactive<Record<TabKey, string>>({ story: '', assets: '', breakdown: '', storyboard: '', compose: '' })
const stepModelCost = reactive<Record<TabKey, number>>({ story: 0, assets: 0, breakdown: 0, storyboard: 0, compose: 0 })
const activeModelType = computed(() => {
  const types = MODEL_TYPES_BY_TAB[activeTab.value]
  return types.length === 1 ? types[0] : types
})
const activeModelSelections = computed<Partial<Record<ModelContentType, string>>>({
  get: () => stepModelSelections[activeTab.value],
  set: value => {
    stepModelSelections[activeTab.value] = value
    const primaryType = MODEL_TYPES_BY_TAB[activeTab.value].includes('image')
      ? 'image'
      : MODEL_TYPES_BY_TAB[activeTab.value][0]
    stepModel[activeTab.value] = value[primaryType] || ''
  },
})
const activeModel = computed<string>({
  get: () => stepModel[activeTab.value],
  set: (v: string) => { stepModel[activeTab.value] = v },
})
const activeQuality = computed<string>({
  get: () => stepQuality[activeTab.value],
  set: (v: string) => { stepQuality[activeTab.value] = v },
})
const activeResolution = computed<string>({
  get: () => stepResolution[activeTab.value],
  set: (v: string) => { stepResolution[activeTab.value] = v },
})
const activeModelCost = computed<number>({
  get: () => stepModelCost[activeTab.value],
  set: (v: number) => { stepModelCost[activeTab.value] = v },
})

// ── 当前步骤主操作：由各 tab 组件注册（label 随步骤动态变化），header 按钮触发 ──
interface StepAction {
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
const currentAction = ref<StepAction | null>(null)
function onRegisterAction(action: StepAction | null) {
  currentAction.value = action
}

// ── 切换 tab ──
function switchTab(key: TabKey) {
  const nameMap: Record<TabKey, string> = {
    story: 'vs-story', assets: 'vs-assets', breakdown: 'vs-breakdown',
    storyboard: 'vs-storyboard', compose: 'vs-compose',
  }
  router.replace({ name: nameMap[key], params: route.params, query: route.query })
}

// ── 公共参数：素材 / 配音 / 风格 ──
const personas = ref<PersonaItem[]>([]) // 所有素材（角色、场景、道具）
const voices = ref<VoiceItem[]>([]) // 所有配音素材
const narrationVoice = ref('温柔女声') // 旁白音色
const narrationVoiceId = ref<number | null>(null) // 旁白音色 ID
const styleId = ref<number | null>(null) // 作品画风 ID
const usePrevVideo = ref(0) // 作品级开关：分镜视频是否参考上一镜成片（0=否 1=是）
const frameMode = ref<'single' | 'dual' | 'video_tail'>('single') // 作品级默认关键帧模式（single=主流单帧驱动）

const characters = computed(() => personas.value.filter(p => p.source_type === 'persona')) // 角色素材
const voiceOptions = computed(() => voices.value.map(v => v.voice_name)) // 配音素材

// 旁白音色变更：持久化 voice_id 到 works 表（Storyboard tab 触发，公共参数在这里更新）
async function onNarrationVoiceChange(voiceName: string) {
  narrationVoice.value = voiceName
  const v = voices.value.find(v => v.voice_name === voiceName)
  if (v && workId.value) {
    narrationVoiceId.value = v.id
    await worksApi.update(workId.value, { narration_voice_id: v.id })
  }
}

// 作品画风变更：持久化到 works 表（StoryTab 触发，公共参数在这里更新）
async function onStyleIdChange(styleIdValue: number | null) {
  if (styleIdValue === null || !workId.value || styleIdValue === styleId.value) return
  try {
    await worksApi.update(workId.value, { style_id: styleIdValue })
    styleId.value = styleIdValue
    showToast('已更新作品画风', 'success')
  } catch (error: any) {
    showToast(error.message || '更新作品画风失败', 'error')
  }
}

// "参考上一镜成片"开关：持久化到 works.use_prev_video（StoryboardTab 触发）
async function onUsePrevVideoChange(value: number) {
  if (!workId.value || value === usePrevVideo.value) return
  try {
    await worksApi.update(workId.value, { use_prev_video: value ? 1 : 0 })
    usePrevVideo.value = value ? 1 : 0
    showToast(value ? '已开启：生成分镜视频时会参考上一镜成片' : '已关闭上一镜视频参考', 'success')
  } catch (error: any) {
    showToast(error.message || '更新设置失败', 'error')
  }
}

// 作品级关键帧模式切换：持久化到 works.frame_mode（StoryboardTab 触发）
async function onFrameModeChange(value: 'single' | 'dual' | 'video_tail') {
  if (!workId.value || value === frameMode.value) return
  try {
    await worksApi.update(workId.value, { frame_mode: value })
    frameMode.value = value
    showToast(
      value === 'single'
        ? '已切换为主流单关键帧模式（每镜仅生 1 张主图，省 50% 积分且画面更自然）'
        : '已切换为首尾双帧模式（每镜生成首帧+尾帧 2 张图）',
      'success',
    )
  } catch (error: any) {
    showToast(error.message || '更新关键帧模式失败', 'error')
  }
}

// ── 公共参数：分镜 ──
interface Panel {
  scene_id?: number | null
  prop_ids?: number[]
  id: number
  scene: string
  subject_motion?: string | null
  key_prop_action?: string | null
  roles: { id?: number; name?: string }[]
  segments: { type: 'narration' | 'dialogue'; text: string; role_id?: number }[]
  durShort: number
  panelIdx?: number
  shot_size?: string
  camera_angle?: string
  camera_movement?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  finalVideoUrl?: string
  panelStatus?: string
}
const panels = ref<Panel[]>([])

/** 从服务端重新拉取分镜数据（AI 拆分完成后由 BreakdownTab 通知调用） */
async function reloadPanels() {
  if (!workId.value || !chapterId.value) return
  const data: any = await worksApi.detail(workId.value)
  const all: any[] = []
  if (data.volumes) for (const v of data.volumes) if (v.chapters) all.push(...v.chapters)
  if (data.unlinkedChapters) all.push(...data.unlinkedChapters)
  const ch = all.find((c: any) => c.id === chapterId.value)
  if (ch?.content_configs) {
    panels.value = (ch.content_configs as any[]).map((c: any, i: number) => ({
      ...c,
      id: i + 1, scene: c.environment || '', // 场景描述
      roles: (c.roles || []).map((r: any) => ({ id: r.id, name: r.name })), // 出镜角色
      durShort: c.durShort || 5, // 分镜时长（秒）：分镜节奏要求每镜 3~15 秒
      panelIdx: c.panelIdx ?? i, // 分镜索引（从 0 开始）
      shot_size: c.shot_size || '', // 分镜尺寸（如 '16:9'）
      camera_angle: c.camera_angle || '', // 相机角度（如 '0°'）
      camera_movement: c.camera_movement || '', // 相机移动（如 '0°'）
      firstFrameUrl: c.firstFrameUrl || '', // 第一帧图片 URL
      lastFrameUrl: c.lastFrameUrl || '', // 最后一帧图片 URL
      finalVideoUrl: c.finalVideoUrl || '', // 最终视频 URL
      panelStatus: c.panelStatus || 'idle', // 分镜状态（如 'done'）
      segments: c.segments || [], // 分镜内容（文本、图片、音频）
      videoPrompt: c.videoPrompt || '', // 视频 Prompt
    }))
  }
}

// ── 公共参数：素材刷新（Assets tab 的 reload-assets 事件触发） ──
async function loadAssets() {
  if (!workId.value) return
  const [pList, vList] = await Promise.all([personasApi.list(workId.value), voicesApi.list()])
  personas.value = pList
  voices.value = vList
}

// ── Load ──
onMounted(async () => {
  if (!workId.value) { loading.value = false; return }
  try {
    const data: any = await worksApi.detail(workId.value)
    styleId.value = data?.style_id || null // 作品风格ID
    narrationVoiceId.value = data?.narration_voice_id || null
    usePrevVideo.value = Number(data?.use_prev_video || 0) // 分镜视频是否参考上一镜成片
    if (data?.frame_mode && ['single', 'dual', 'video_tail'].includes(String(data.frame_mode))) {
      frameMode.value = data.frame_mode
    }
    workTitle.value = data.title || '未命名作品'
    const all: any[] = []
    if (data.volumes) for (const v of data.volumes) if (v.chapters) all.push(...v.chapters.map((c: any) => ({ ...c, volTitle: v.title })))
    if (data.unlinkedChapters) all.push(...data.unlinkedChapters)
    const ch = all.find((c: any) => c.id === chapterId.value) || all[0]
    if (ch) {
      chapterId.value = ch.id
      chapterTitle.value = ch.title
      chapterContent.value = ch.content || ''
    }
    if (ch?.content_configs) {
      panels.value = (ch.content_configs as any[]).map((c: any, i: number) => ({
        ...c,
        id: i + 1, scene: c.environment || '',
        roles: (c.roles || []).map((r: any) => ({ id: r.id, name: r.name })),
        durShort: c.durShort || 5,
        panelIdx: c.panelIdx ?? i,
        shot_size: c.shot_size || '',
        camera_angle: c.camera_angle || '',
        camera_movement: c.camera_movement || '',
        firstFrameUrl: c.firstFrameUrl || '',
        lastFrameUrl: c.lastFrameUrl || '',
        finalVideoUrl: c.finalVideoUrl || '',
        panelStatus: c.panelStatus || 'idle',
        segments: c.segments || [],
        videoPrompt: c.videoPrompt || '', // 视频 Prompt
      }))
    }
    await loadAssets()
    // 根据 narration_voice_id 回显旁白音色
    if (narrationVoiceId.value) {
      const v = voices.value.find(v => v.id === narrationVoiceId.value)
      if (v) narrationVoice.value = v.voice_name
    }
  } catch { /* ignore */ }
  finally { loading.value = false }
})
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- ═══════ Header（含标签栏）═══════ -->
    <header class="flex items-center px-3 h-14 shrink-0">
      <!-- 左侧：首页图标 -->
      <button class="btn btn-ghost btn-sm btn-circle shrink-0 mr-2" @click="router.back()" title="返回上一页">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
        </svg>
      </button>

      <!-- 居中：工作流步骤导航 -->
      <div class="flex-1 flex justify-start items-center px-2">
        <div class="flex items-center gap-0">
          <template v-for="(t, i) in tabs" :key="t.key">
            <!-- 连接线（第一步前不显示） -->
            <div v-if="i > 0" class="w-8 sm:w-12 h-px transition-colors duration-300"
              :class="i <= stepIndex ? 'bg-primary/60' : 'bg-base-300'" />

            <!-- 步骤节点 -->
            <button
              class="flex items-center gap-2 group cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
              @click="switchTab(t.key)">
              <!-- 序号圆圈 -->
              <span
                class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-all duration-300"
                :class="[
                  i < stepIndex
                    ? 'bg-primary text-primary-content shadow-sm shadow-primary/25'
                    : i === stepIndex
                      ? 'bg-primary text-primary-content ring-4 ring-primary/20 shadow-md shadow-primary/30'
                      : 'bg-base-300/80 text-base-content/30'
                ]">
                <template v-if="i < stepIndex">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </template>
                <template v-else>{{ i + 1 }}</template>
              </span>

              <!-- 文字标签 -->
              <span class="text-xs font-semibold transition-colors duration-300 hidden sm:inline-block w-7.5"
                :class="i <= stepIndex ? 'text-base-content' : 'text-base-content/25'">{{ t.label }}</span>
            </button>
          </template>
        </div>
      </div>

      <!-- 模型选择器：随当前工作流步骤切换模型类型，每步骤记忆所选模型 -->
      <div class="flex items-center gap-2 shrink-0 mr-2">
        <div class="w-44 shrink-0">
          <ModelPicker v-model="activeModel" v-model:resolution="activeResolution"
            v-model:cost="activeModelCost" v-model:selected-models="activeModelSelections" :model-type="activeModelType"
            :confirm-open="currentAction?.confirm?.open || false"
            :confirm-selected-count="currentAction?.confirm?.selectedCount || 0"
            :confirm-resolution="currentAction?.confirm?.resolution"
            :confirm-cost="currentAction?.confirm?.cost || 0"
            :confirm-title="currentAction?.confirm?.title || '确认生成'"
            :confirm-generating="currentAction?.confirm?.generating || false"
            @confirm-close="currentAction?.confirm?.close()" @confirm-submit="currentAction?.confirm?.submit()" />
        </div>
        <!-- 当前步骤主操作按钮（文字随步骤动态调整） -->
        <button class="btn btn-primary btn-sm shrink-0 whitespace-nowrap btn-soft" :disabled="!currentAction"
          @click="currentAction?.run()">
          <span class="iconfont icon-a-zhinengti"></span>
          {{ currentAction?.label || '当前步骤无可执行操作' }}
        </button>
      </div>

      <!-- 右侧：积分 + 用户菜单 -->
      <PointsBadge />
      <!-- 右侧：用户菜单 -->
      <UserMenu />
    </header>

    <!-- ═══════ Content ═══════ -->
    <div class="flex-1 overflow-hidden flex flex-col">
      <!-- ── Loading skeleton ── -->
      <div v-if="loading" class="flex-1 flex flex-col items-center justify-center gap-6 p-8">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>

      <!-- ═══════════════════════════════════════════ -->
      <!--  TAB 1: 小说故事                              -->
      <!-- ═══════════════════════════════════════════ -->
      <StoryTab v-else-if="activeTab === 'story'" :work-id="workId" :chapter-id="chapterId"
        v-model:chapter-title="chapterTitle" v-model:chapter-content="chapterContent" :personas="personas"
        :style-id="styleId" @update:style-id="onStyleIdChange"
        :model="activeModel" :model-cost="activeModelCost" @register-action="onRegisterAction" />
      <!-- ═══════════════════════════════════════════ -->
      <!--  TAB 2: 小说故事素材                          -->
      <!-- ═══════════════════════════════════════════ -->
      <StoryAssetsTab v-else-if="activeTab === 'assets'" :personas="personas" :voices="voices"
        :voice-options="voiceOptions" :work-id="workId" :chapter-id="chapterId" :chapter-content="chapterContent"
        :style-id="styleId" :model="activeModel" :model-resolution="activeResolution"
        :text-model="activeModelSelections.text || ''" :model-cost="activeModelCost"
        @register-action="onRegisterAction" />
      <!-- ═══════════════════════════════════════════ -->
      <!--  TAB 3: 分镜拆分                          -->
      <!-- ═══════════════════════════════════════════ -->
      <BreakdownTab v-else-if="activeTab === 'breakdown'" :panels="panels" :characters="characters" :assets="personas"
        :work-id="workId" :chapter-id="chapterId" :chapter-content="chapterContent" @load-panels="reloadPanels"
        :model="activeModel" :model-cost="activeModelCost" @register-action="onRegisterAction" />
      <!-- ═══════════════════════════════════════════ -->
      <!--  TAB 4: 分镜故事板                          -->
      <!-- ═══════════════════════════════════════════ -->
      <StoryboardTab v-else-if="activeTab === 'storyboard'" :panels="panels"
        :assets="personas" :voices="voices" :voice-options="voiceOptions" :narration-voice="narrationVoice"
        :characters="characters" :work-id="workId" :chapter-id="chapterId" :style-id="styleId"
        :narration-voice-id="narrationVoiceId" @update:narration-voice="onNarrationVoiceChange" :model="activeModel"
        :use-prev-video="usePrevVideo" @update:use-prev-video="onUsePrevVideoChange"
        :frame-mode="frameMode" @update:frame-mode="onFrameModeChange"
        :text-model="activeModelSelections.text || ''"
        :model-resolution="activeResolution" :model-cost="activeModelCost"
        @register-action="onRegisterAction" />
      <!-- ═════════════════════════════════════════ -->
      <!--  TAB 5: 合成分镜                          -->
      <!-- ═══════════════════════════════════════════ -->
      <ComposeTab v-else-if="activeTab === 'compose'" :work-id="workId" :chapter-id="chapterId"
        :work-title="workTitle" :chapter-title="chapterTitle" @register-action="onRegisterAction" />
    </div>
  </div>

  <router-view />
</template>

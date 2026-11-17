<!-- 角色列表 + 提取（可复用组件） -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import WorkflowTimeline from '@/components/WorkflowTimeline.vue'
import { personasApi, type PersonaItem } from '@/api/personas'
import { useWorkflowTimeline, type TimelineStep } from '@/composables/useWorkflowTimeline'
import { useTaskRecovery } from '@/composables/useTaskRecovery'
import { useToast } from '@/composables/useToast'
import { getAuthHeaders } from '@/composables/useAuth'

const props = defineProps<{
  workId: number
  chapterId: number
  chapterContent: string
  /** 素材数组（父组件持有引用，提取完成后原地更新） */
  personas: PersonaItem[]
  /** AI 提取使用的文本模型（由 VideoStoryboard header 统一选择后下发） */
  model: string
}>()

const { show: showToast } = useToast()
const emit = defineEmits<{ 'request-extract': [type: 'persona' | 'scene' | 'prop'] }>()
const tl = useWorkflowTimeline()

// ── 素材分类查看：角色 / 场景 / 道具（personas.source_type） ──
type AssetType = 'persona' | 'scene' | 'prop'
const viewType = ref<AssetType>('persona')
const searchKeyword = ref('')
const ASSET_NAV: { key: AssetType; label: string; icon: string }[] = [
  { key: 'persona', label: '角色', icon: 'icon-jiaose' },
  { key: 'scene', label: '场景', icon: 'icon-changjing' },
  { key: 'prop', label: '道具', icon: 'icon-daoju' },
]
const assetCount = (type: AssetType) => props.personas.filter(p => p.source_type === type).length
const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase())
const searchableText = (item: PersonaItem) => [
  item.name,
  item.description,
  item.gender,
  item.age,
  item.source_type === 'persona' ? '角色' : item.source_type === 'scene' ? '场景' : '道具',
  item.detail?.title,
  item.detail?.time,
  item.detail?.location,
  item.detail?.description,
  item.detail?.mood,
  item.detail?.key_events,
].filter(Boolean).join(' ').toLowerCase()
const filteredItems = (type: AssetType) => {
  const items = props.personas.filter(p => p.source_type === type)
  const keyword = normalizedKeyword.value
  if (!keyword) return items
  return items.filter(item => searchableText(item).includes(keyword))
}
const filteredCount = (type: AssetType) => filteredItems(type).length
const shownItems = computed(() => filteredItems(viewType.value))
const emptyHint = computed(() => {
  if (normalizedKeyword.value) return `没有找到「${searchKeyword.value.trim()}」`
  if (viewType.value === 'persona')
    return '暂无角色，在顶部选择文本模型后点击「提取素材」'
  if (viewType.value === 'scene')
    return '暂无场景，点击顶部「提取素材」自动提取，或前往「故事素材」创建'
  return '暂无道具'
})

watch(normalizedKeyword, (keyword) => {
  if (!keyword || filteredCount(viewType.value) > 0) return
  const matched = ASSET_NAV.find(nav => filteredCount(nav.key) > 0)
  if (matched) viewType.value = matched.key
})

// ── AI 提取素材（角色 → 场景 → 道具） ──
const extracting = ref(false)
const CHARACTER_EXTRACT_STEPS: TimelineStep[] = [
  { name: 'extract-characters', label: 'AI 提取角色', status: 'wait' },
  { name: 'save-characters', label: '创建角色素材', status: 'wait' },
  { name: 'extract-scene', label: 'AI 提取场景', status: 'wait' },
  { name: 'save-scenes', label: '创建场景素材', status: 'wait' },
  { name: 'extract-props', label: 'AI 提取道具', status: 'wait' },
  { name: 'save-props', label: '创建道具素材', status: 'wait' },
]

// 刷新角色列表
async function refreshCharacters() {
  if (!props.workId) return
  const pList = await personasApi.list(props.workId)
  props.personas.splice(0, props.personas.length, ...pList)
}

// 开始提取角色素材
async function onExtractCharacters(assetType: AssetType | 'all' = 'all') {
  if (extracting.value) return
  if (!props.workId || !props.chapterId || !props.chapterContent) return
  if (!props.model) {
    showToast('请先在顶部选择文本模型', 'info')
    return
  }
  if (!props.chapterContent?.trim()) {
    showToast('章节内容为空，无法提取素材', 'info')
    return
  }

  extracting.value = true
  const offset = assetType === 'persona' ? 0 : assetType === 'scene' ? 2 : 4
  const steps = assetType === 'all' ? CHARACTER_EXTRACT_STEPS : CHARACTER_EXTRACT_STEPS.slice(offset, offset + 2)
  tl.restore(assetType === 'scene' || assetType === 'prop'
    ? [{ name: 'load-asset-context', label: '读取已有素材', status: 'wait' }, ...steps] : steps)
  try {
    const base = import.meta.env.VITE_API_BASE_URL || '/api'
    const res = await fetch(`${base}/agent/character-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), aiModel: props.model },
      body: JSON.stringify({
        text: props.chapterContent,
        workId: props.workId,
        chapterId: props.chapterId,
        assetType,
      }),
    })
    if (!res.ok) throw new Error(`提取素材请求失败（${res.status}）`)
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
        {
          if (chunk.error || chunk.type === 'error' || chunk.type === 'failed' || chunk.type === 'workflow-step-error')
            throw new Error(chunk.error || chunk.payload?.message || chunk.message || chunk.result || '素材提取失败')
          if (chunk.type === 'workflow-step-start') tl.setRunning(chunk.payload?.stepName || chunk.payload?.id)
          else if (chunk.type === 'workflow-step-result') tl.setDone(chunk.payload?.stepName || chunk.payload?.id)
        }
      }
      if (streamFinished) break
    }
    await refreshCharacters()
  } catch (e: any) {
    tl.setFailed()
    showToast(e.message || '素材提取失败', 'error')
  }
  finally { extracting.value = false; await refreshCharacters() }
}

// 页面刷新 / 跳转后的 characterExtract 任务恢复
useTaskRecovery(
  () => { }, // 本工作流无流式正文
  () => {
    extracting.value = false
    tl.hide()
    refreshCharacters()
  },
  (meta) => { extracting.value = true; tl.restore(meta.steps || []) },
  (id) => { tl.setRunning(id) },
  (id) => { tl.setDone(id) },
  {
    types: ['characterExtract'],
    onError: (err) => {
      extracting.value = false
      tl.setFailed()
      showToast(err.message || '素材提取失败', 'error')
    },
  },
)

// 供父级（VideoStoryboard header 主操作按钮）调用
defineExpose({ runExtract: onExtractCharacters, extracting })
</script>

<template>
  <!-- 素材列表（角色/场景/道具，按 source_type 分类查看；提取入口在 VideoStoryboard header） -->
  <aside class="w-[340px] flex flex-col py-2 px-2">
    <!-- 顶部扩展位（如作品画风选择）：不传插槽时无渲染 -->
    <slot name="header" />
    <div class="flex items-center gap-2">
      <label class="input input-sm w-full mb-3">
        <svg class="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <g stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </g>
        </svg>
        <input v-model="searchKeyword" type="search" class="grow text-sm" placeholder="搜索角色 / 场景 / 道具" />
        <button v-if="searchKeyword" type="button" class="btn btn-ghost btn-xs btn-circle" title="清空搜索"
          @click="searchKeyword = ''">
          ×
        </button>
      </label>
      <button type="button" class="btn btn-sm btn-primary mb-3 self-end" :disabled="extracting"
        @click="emit('request-extract', viewType)">
        <span class="iconfont icon-a-zhinengti" aria-hidden="true"></span>
        提取{{ASSET_NAV.find(nav => nav.key === viewType)?.label}}
      </button>
    </div>
    <!-- 分类查看与单类提取使用同一个当前分类 -->
    <div class="tabs tabs-lift w-full">
      <template v-for="nav in ASSET_NAV" :key="nav.key">
        <label class="tab relative flex-1 min-w-0 px-3">
          <span v-if="assetCount(nav.key) > 0"
            class="absolute right-1 top-1 min-w-4 h-4 px-1 rounded-full bg-secondary text-secondary-content text-[10px] leading-4 text-center font-semibold">
            {{ normalizedKeyword ? filteredCount(nav.key) : assetCount(nav.key) }}
          </span>
          <input type="radio" name="story-assets-panel" :checked="viewType === nav.key" @change="viewType = nav.key" />
          <span :class="`mr-1.5 iconfont ${nav.icon}`"></span>
          <span>{{ nav.label }}</span>
        </label>

        <!-- 分类内容（角色/场景/道具列表） -->
        <div class="tab-content bg-base-100 border-base-300 p-2 min-h-[360px]" v-if="nav.key === 'persona'">
          <div v-if="shownItems.length === 0" class="py-8 text-center text-xs text-base-content/50">{{ emptyHint }}
          </div>
          <table v-else class="table table-xs table-pin-rows">
            <tbody>
              <tr v-for="item in shownItems" :key="item.id">
                <td>
                  <div class="flex items-center gap-2 min-w-0">
                    <img v-if="item.images?.[0]?.url" :src="item.images[0].url" :alt="item.name"
                      class="w-7 h-7 mask mask-circle object-contain shrink-0" />
                    <span v-else
                      class="iconfont icon-touxiang w-7 h-7 rounded-full bg-base-200 flex items-center justify-center shrink-0"></span>
                    <span class="font-medium truncate max-w-[84px]">{{ item.name }}</span>
                  </div>
                </td>
                <td v-if="viewType === 'persona'" class="whitespace-nowrap text-base-content/50">
                  {{ item.gender === 'male' ? '男' : item.gender === 'female' ? '女' : '未知' }} · {{ item.age || '未知'
                  }}
                </td>
                <td class="text-xs text-base-content/50 max-w-[150px]">
                  <span class="line-clamp-1">{{ item.description || '—' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="tab-content bg-base-100 border-base-300 p-2 min-h-[360px]" v-if="nav.key === 'scene'">
          <div v-if="shownItems.length === 0" class="py-8 text-center text-xs text-base-content/50">{{ emptyHint }}
          </div>
          <div v-else class="space-y-2">
            <div v-for="item in shownItems" :key="item.id"
              class="flex gap-2 items-start rounded-md px-1.5 py-1.5 hover:bg-base-200/70">
              <img v-if="item.images?.[0]?.url" :src="item.images[0].url" :alt="item.name"
                class="w-10 h-10 rounded-md object-cover shrink-0 border border-base-300" />
              <span v-else
                class="iconfont icon-changjing w-10 h-10 rounded-md bg-base-200 flex items-center justify-center shrink-0"></span>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-medium text-sm whitespace-nowrap">{{ item.name }}</span>
                  <span v-if="item.detail?.time" class="badge badge-xs badge-ghost">{{ item.detail.time }}</span>
                  <span v-if="item.detail?.location" class="badge badge-xs badge-ghost">{{ item.detail.location
                    }}</span>
                  <span v-if="item.detail?.interior !== undefined" class="badge badge-xs badge-ghost">
                    {{ item.detail.interior ? '室内' : '室外' }}
                  </span>
                </div>
                <p class="text-xs text-base-content/50 line-clamp-2">
                  {{ item.detail?.mood ? `【${item.detail.mood}】` : '' }}{{ item.description || '—' }}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div class="tab-content bg-base-100 border-base-300 p-2 min-h-[360px]" v-if="nav.key === 'prop'">
          <div v-if="shownItems.length === 0" class="py-8 text-center text-xs text-base-content/50">{{ emptyHint }}
          </div>
          <div v-else class="space-y-2">
            <div v-for="item in shownItems" :key="item.id"
              class="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-base-200/70">
              <img v-if="item.images?.[0]?.url" :src="item.images[0].url" :alt="item.name"
                class="w-10 h-10 rounded-md object-cover shrink-0" />
              <span v-else
                class="iconfont icon-daoju w-10 h-10 shrink-0 flex items-center justify-center bg-base-200 rounded-md"></span>
              <div class="min-w-0">
                <div class="text-sm font-medium break-words">{{ item.name }}</div>
                <p class="text-xs text-base-content/50 line-clamp-2">{{ item.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 时间链弹窗 -->
    <WorkflowTimeline />
  </aside>
</template>

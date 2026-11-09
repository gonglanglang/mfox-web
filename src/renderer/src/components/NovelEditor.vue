<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onBeforeUnmount, watch, nextTick } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import 'vditor/dist/js/icons/ant.js'
import 'vditor/dist/js/i18n/zh_CN.js'
import luteUrl from 'vditor/dist/js/lute/lute.min.js?url'
import { useWorkflowTimeline } from '@/composables/useWorkflowTimeline'
import { chaptersApi } from '@/api/chapters'

// ── Props ──
const props = defineProps<{
  workId: number // 作品ID
  chapterId: number | null // 章节ID
  chapterTitle: string // 章节标题
  content?: string // 初始内容（Markdown 格式）
}>()

// ── Emits ──
const emit = defineEmits<{

  'update:chapterTitle': [value: string]
  'saved': [payload: { chapterId: number; wordCount: number }]
  'wordCountChange': [count: number]
  'saveStateChange': [state: { saving: boolean; status: 'saved' | 'saving' | 'success' }]
}>()

// ── Word count ──
const wordCount = ref(0)
const readingTime = computed(() => Math.max(1, Math.ceil(wordCount.value / 350)))

// ── Vditor ──
const vditorEl = ref<HTMLDivElement | null>(null)
const vditor = ref<Vditor | null>(null)
const vditorReady = ref(false)

function getTextCount(fallbackMd = ''): number {
  const v = vditor.value
  try {
    const html = v?.getHTML()
    if (html) {
      const div = document.createElement('div')
      div.innerHTML = html
      return (div.textContent || '').replace(/\s/g, '').length
    }
  } catch {
    // 渲染文本统计失败时退回 Markdown 原文统计
  }
  return fallbackMd.replace(/\s/g, '').length
}

function updateWordCount(md: string): void {
  const count = getTextCount(md)
  wordCount.value = count
  emit('wordCountChange', count)
}

// ── AI streaming ──
const timeline = useWorkflowTimeline()
const streaming = ref(false) // 流式渲染状态（流式中拦截自动保存，防把半成品落库）
// 标记 AI 流式确实在推流（用于区分"AI 流式"与"普通打开章节"，避免误禁用编辑器）
const aiStreaming = ref(false)
// 累积完整 Markdown 原文，流结束时用于整体重新渲染
const fullMarkdown = ref('')

// ── 流式自动滚动：智能跟随 ──
// 规则：流式输出时若用户停留在底部附近，新内容渲染后自动滚到底部；
//       用户上滚阅读时暂停跟随，滚回底部附近自动恢复。
/** 距内容底部小于该像素值视为"停留在底部"，继续自动跟随 */
const SCROLL_BOTTOM_THRESHOLD = 80
/** 是否自动跟随底部（用户上滚阅读时由滚动监听置为 false） */
const followBottom = ref(true)
/** 滚动容器缓存：IR 模式下为 contenteditable 的 pre.vditor-reset（overflow: auto 的实际滚动层） */
let scrollContainer: HTMLElement | null = null

/** 获取 IR 模式的实际滚动容器 */
function getScrollContainer(): HTMLElement | null {
  return vditor.value?.vditor.ir?.element
    ?? vditor.value?.vditor.element.querySelector('.vditor-reset')
    ?? null
}

/** 当前视口是否停留在内容底部附近 */
function isNearBottom(): boolean {
  if (!scrollContainer) return false
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer
  return scrollHeight - clientHeight - scrollTop <= SCROLL_BOTTOM_THRESHOLD
}

/** 滚动监听回调：用户滚动时刷新"是否停留在底部"状态 */
function handleScrollFollow(): void {
  followBottom.value = isNearBottom()
}

/** 绑定滚动监听（vditor 就绪后调用一次） */
function bindScrollFollow(): void {
  if (scrollContainer || !vditor.value) return
  scrollContainer = getScrollContainer()
  scrollContainer?.addEventListener('scroll', handleScrollFollow, { passive: true })
}

/** 滚动到底部：双 rAF 等待 setValue 异步渲染完成后再滚（否则 scrollHeight 还是旧值，滚不到位） */
function scrollToBottom(): void {
  if (!followBottom.value || !vditor.value) return
  const container = scrollContainer ?? getScrollContainer()
  if (!container) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })
  })
}

// 监听流式内容接收
watch(() => timeline.generatedContent.value, (text) => {
  if (!text) return
  aiStreaming.value = true // 标记 AI 流式已开始（after() 据此标记流式进行中）
  // 首次累积时以 props.content 为基座（例如打开已有内容的章节后再续写/流式，避免第一个 chunk 覆盖已有内容）
  if (!fullMarkdown.value && props.content) fullMarkdown.value = props.content
  fullMarkdown.value += text
  timeline.generatedContent.value = ''
  updateWordCount(fullMarkdown.value) // 更新字数
  // Lute 未就绪（vditorReady=false）时 setValue 会崩（this.lute.Md2VditorIRDOM 为 undefined），
  // 内容已累积进 fullMarkdown，交由 after() 就绪后统一渲染
  if (!vditorReady.value) return
  if (!streaming.value) {
    streaming.value = true // 标记流式进行中（用于 handleEditorInput 拦截自动保存）
  }
  vditor.value?.setValue(fullMarkdown.value, false) // 更新编辑器内容（不禁用编辑器，避免渲染偏移）
  scrollToBottom() // 渲染完成后自动滚动到底部（若用户停留在底部附近）
})

// 监听内容完成（immediate：值可能在挂载前已被置为 true，如生成极快/页面恢复重连，
// 不加 immediate 会错过已经发生的 false→true 变化导致回调永不执行）
watch(() => timeline.contentFinalized.value, (v) => {
  if (!v) return
  timeline.hide() // 完成后隐藏时间链
  streaming.value = false // 流式渲染状态重置
  aiStreaming.value = false // 复位流式标记（防残留影响后续 after() 判断）
  followBottom.value = true // 复位自动跟随，供下次流式输出使用
  // 若后端在步骤完成时提供了权威完整内容（Home 侧 setFinalContent），整体替换流式累积，
  // 避免增量 chunk 与最终内容不一致（重连场景 finalContent 为空时保留 fullMarkdown）
  if (timeline.finalContent.value) {
    fullMarkdown.value = timeline.finalContent.value
    updateWordCount(fullMarkdown.value)
    // Lute 未就绪时由 after() 兜底渲染（fullMarkdown 已同步）
    if (vditorReady.value) vditor.value?.setValue(fullMarkdown.value, false)
    timeline.finalContent.value = '' // 消费后清空，避免单例残留到同会话下次进入 Write 页
  }
}, { immediate: true })

// ── Auto-save ──
const saving = ref(false)
const saveStatus = ref<'saved' | 'saving' | 'success'>('saved')
let saveTimer: ReturnType<typeof setTimeout> | null = null

// 编辑器输入处理
function handleEditorInput(value: string): void {
  if (streaming.value) return
  updateWordCount(value)
  scheduleSave() // 触发自动保存
}

// 自动保存
function scheduleSave(): void {
  if (!props.chapterId || saving.value) return // 章节ID不存在或正在保存中，不触发自动保存
  saveStatus.value = 'saving'
  emit('saveStateChange', { saving: saving.value, status: saveStatus.value })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    doSave()
  }, 3000)
}

async function doSave(includeTitle = true): Promise<void> {
  if (!props.chapterId || !vditor.value) return
  saving.value = true
  saveStatus.value = 'saving'
  emit('saveStateChange', { saving: true, status: 'saving' })
  try {
    const md = vditor.value.getValue() // 获取当前编辑器内容（Markdown 格式）
    const text = getTextCount(md) // 统计字数
    const payload: Record<string, unknown> = {
      content: md,
      word_count: text,
    }
    if (includeTitle) payload.title = props.chapterTitle // 包含章节标题
    await chaptersApi.update(props.workId, props.chapterId, payload as any) // 更新章节内容
    saveStatus.value = 'success' // 保存成功
    emit('saveStateChange', { saving: false, status: 'success' }) // 保存成功状态
    wordCount.value = text // 更新字数状态
    emit('wordCountChange', text) // 更新字数事件
    emit('saved', { chapterId: props.chapterId, wordCount: text }) // 触发保存成功事件
  } catch (e: any) {
    console.error('保存失败:', e.message)
    saveStatus.value = 'saved'
    emit('saveStateChange', { saving: false, status: 'saved' })
  } finally {
    saving.value = false
    setTimeout(() => {
      if (saveStatus.value === 'success') {
        saveStatus.value = 'saved'
        emit('saveStateChange', { saving: false, status: 'saved' })
      }
    }, 2000)
  }
}

function save(): void {
  doSave()
}
// ----------------------------------------------
// ── Title ──
const titleEl = ref<HTMLElement | null>(null)

function onTitleInput(e: Event) {
  const newTitle = (e.target as HTMLElement).innerText
  emit('update:chapterTitle', newTitle)
  saveStatus.value = 'saving'
  emit('saveStateChange', { saving: saving.value, status: saveStatus.value })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => doSave(), 3000)
}

// 父组件在 AI 生成完成后刷新章节标题时，同步到可编辑标题 DOM
watch(() => props.chapterTitle, (title) => {
  if (titleEl.value && titleEl.value.innerText !== title) {
    titleEl.value.innerText = title
  }
})
// ----------------------------------------------


// 监听 props.content 变化，更新编辑器内容（并同步 fullMarkdown，避免流式累积与初始内容脱节）
watch(() => props.content, (newVal) => {
  // 仅忽略未传值（undefined）；空串 '' 也要写入，否则切到空章节时会残留上一章内容
  if (newVal === null || newVal === undefined) return
  fullMarkdown.value = newVal
  updateWordCount(newVal) // 同步字数统计（含切到空章节时清零）
  // Lute 未就绪（初始化竞态：刷新后 loadWorkData 可能先于 Vditor 完成）时跳过 setValue，
  // 内容已同步进 fullMarkdown，由 after() 就绪后统一渲染，避免 this.lute.Md2VditorIRDOM 崩溃
  if (!vditorReady.value) return
  vditor.value?.setValue(newVal, false)
})

// ── Float menu（AI 划词浮层） ──
const floatMenu = ref<HTMLDivElement | null>(null)
const floatMenuVisible = ref(false)
const floatMenuStyle = ref({ top: '0px', left: '0px' })
const selectedText = ref('')

function onEditorMouseUp(): void {
  const sel = window.getSelection()
  const text = sel?.toString().trim() || ''
  const editorDom = vditor.value?.vditor.ir?.element
  if (text && editorDom?.contains(sel?.anchorNode ?? null)) {
    selectedText.value = text
    const range = sel!.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    floatMenuStyle.value = {
      top: `${rect.top + window.scrollY - 50}px`,
      left: `${rect.left + window.scrollX + rect.width / 2 - 120}px`
    }
    floatMenuVisible.value = true
  }
}

function hideFloatMenu(e: MouseEvent): void {
  if (!floatMenu.value?.contains(e.target as Node)) {
    floatMenuVisible.value = false
  }
}

// ── Keyboard shortcuts ──
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    save()
  }
}

// ── Lifecycle ──
onMounted(() => {
  document.addEventListener('mouseup', onEditorMouseUp)
  document.addEventListener('mousedown', hideFloatMenu)
  document.addEventListener('keydown', onKeydown)
  nextTick(initVditor)
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  scrollContainer?.removeEventListener('scroll', handleScrollFollow) // 解除滚动监听
  scrollContainer = null
  vditor.value?.destroy() // 销毁 Vditor 实例，释放 DOM 与监听器
})

onUnmounted(() => {
  document.removeEventListener('mouseup', onEditorMouseUp)
  document.removeEventListener('mousedown', hideFloatMenu)
  document.removeEventListener('keydown', onKeydown)
})

function initVditor(): void {
  if (!vditorEl.value) return
  vditor.value = new Vditor(vditorEl.value, {
    mode: 'ir',
    value: props.content ?? '', // 初始内容
    _lutePath: luteUrl, // 自定义 Lute 路径
    cdn: '',
    icon: '' as unknown as 'ant',
    i18n: window.VditorI18n,
    lang: 'zh_CN',
    height: '100%',
    minHeight: 320, // 最小高度
    placeholder: '开始书写你的故事...',
    toolbar: [
      'undo', // 撤销
      'redo', // 重做
      '|',
      'headings', // 标题
      'bold', // 加粗
      'italic', // 斜体
      'strike', // 删除线
      'line', // 下划线
      '|',
      'quote', // 引用
      '|',
      {
        // 自定义"段落缩进"：在光标处插入两个全角空格，实现中文写作常见的首行缩进
        name: 'indent-paragraph',
        icon: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M13.6 5.28h17.44c0.176 0 0.32-0.144 0.32-0.32v-2.24c0-0.176-0.144-0.32-0.32-0.32h-17.44c-0.176 0-0.32 0.144-0.32 0.32v2.24c0 0.176 0.144 0.32 0.32 0.32zM6.4 13.28h24.64c0.176 0 0.32-0.144 0.32-0.32v-2.24c0-0.176-0.144-0.32-0.32-0.32h-24.64c-0.176 0-0.32 0.144-0.32 0.32v2.24c0 0.176 0.144 0.32 0.32 0.32zM6.4 21.28h24.64c0.176 0 0.32-0.144 0.32-0.32v-2.24c0-0.176-0.144-0.32-0.32-0.32h-24.64c-0.176 0-0.32 0.144-0.32 0.32v2.24c0 0.176 0.144 0.32 0.32 0.32zM2.4 1.44l8.16 2.4-8.16 2.4z"/></svg>',
        tip: '段落缩进（首行插入两个全角空格）',
        tipPosition: 'n',
        click() {
          // 在光标处插入两个全角空格（U+3000），会触发 input 回调进入自动保存链路
          vditor.value?.insertValue('　　')
        }
      },
      '|',
      'fullscreen' // 全屏
    ],
    toolbarConfig: { hide: false, pin: true }, // 固定工具栏
    counter: { enable: false }, // 禁用字数统计
    cache: { enable: false }, // 禁用缓存
    input(value) {
      handleEditorInput(value)
    },
    // 编辑器就绪后处理
    after() {
      vditorReady.value = true
      bindScrollFollow() // 绑定滚动容器，启用流式自动跟随

      // Lute 就绪后的统一渲染兜底（初始化期间 setValue 因 Lute 未就绪可能被跳过）：
      // 优先渲染 fullMarkdown（流式累积 / finalContent / props.content 同步），
      // 为空时回退渲染 props.content（普通打开已有内容的章节）
      if (fullMarkdown.value) {
        if (aiStreaming.value) streaming.value = true // 标记流式进行中（拦截自动保存）
        vditor.value?.setValue(fullMarkdown.value, false)
        scrollToBottom()
      } else if (props.content) {
        fullMarkdown.value = props.content
        updateWordCount(props.content) // 同步字数统计（普通打开已有内容的章节）
        vditor.value?.setValue(props.content, false)
      }
      if (timeline.contentFinalized.value) {
        // 挂载前流已结束（生成极快/恢复已完成）：复位流式状态
        streaming.value = false
      }
    }
  })
}

defineExpose({
  wordCount, // 字数统计
  readingTime, // 阅读时间
  saveStatus, // 保存状态
  saving, // 是否正在保存
  save, // 保存作品
  editor: vditor, // Vditor 实例
})
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 bg-base-100">
    <!-- 无作品ID -->
    <div v-if="!workId" class="flex items-center justify-center h-full">
      <div class="flex flex-col items-center gap-3 text-base-content/30">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"
          stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span class="text-sm">请从作品列表进入编辑</span>
      </div>
    </div>

    <!-- 编辑器 -->
    <div v-else class="flex-1 flex flex-col min-h-0">
      <!-- Vditor 编辑器主体 -->
      <div class="flex-1 min-w-[725px] min-h-0 w-full mx-auto">
        <div ref="vditorEl" class="vditor-wrap h-full min-h-0 w-full"></div>
      </div>
    </div>

    <!-- AI 划词浮层 -->
    <div v-if="floatMenuVisible" ref="floatMenu"
      class="fixed z-50 bg-base-100 border border-base-200 shadow-2xl rounded-xl p-1.5 flex items-center gap-1"
      :style="{ top: floatMenuStyle.top, left: floatMenuStyle.left }">
      <button class="btn btn-ghost btn-xs text-primary">✨ 润色</button>
      <div class="w-px h-4 bg-base-300 mx-1"></div>
      <button class="btn btn-ghost btn-xs text-success">📝 续写</button>
      <button class="btn btn-ghost btn-xs text-info">📖 扩写</button>
      <button class="btn btn-ghost btn-xs text-warning">✂️ 缩写</button>
    </div>
  </div>
</template>

<style scoped>
/* Vditor 整体融入 DaisyUI 主题 */
.vditor-wrap :deep(.vditor) {
  height: 100%;
  min-height: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  --border-color: var(--color-base-300, #d1d5da);
  --panel-background-color: transparent;
  --toolbar-background-color: transparent;
  --toolbar-icon-color: var(--color-base-content, #24292e);
  --toolbar-icon-hover-color: var(--color-primary, #4285f4);
  --textarea-background-color: transparent;
  --textarea-text-color: var(--color-base-content, #24292e);
  --second-color: color-mix(in oklab, var(--color-base-content, #586069) 30%, transparent);
  --count-background-color: transparent;
  --heading-border-color: var(--color-base-300, #eaecef);
  --blockquote-color: color-mix(in oklab, var(--color-base-content, #6a737d) 60%, transparent);
}

.vditor-wrap :deep(.vditor-toolbar) {
  border-bottom: 1px solid var(--color-base-200, #eaecef);
  padding: 0 2px;
}

.vditor-wrap :deep(.vditor-content) {
  background: transparent;
}

/* IR 模式正文融入主题 */
.vditor-wrap :deep(.vditor-ir pre.vditor-reset),
.vditor-wrap :deep(.vditor-ir__preview) {
  color: var(--color-base-content, #24292e);
}

.vditor-wrap :deep(.vditor-ir pre.vditor-reset) {
  background: transparent;
  padding: 10px 2rem 10px 15px !important;
}

.vditor-wrap :deep(.vditor-ir__preview) {
  min-height: 1em;
}

/* 让 Vditor 弹出层/提示不受 scoped 影响 */
.vditor-wrap :deep(.vditor-hint),
.vditor-wrap :deep(.vditor-panel) {
  --panel-background-color: var(--color-base-100, #fff);
  background-color: var(--panel-background-color);
  color: var(--color-base-content, #24292e);
}
</style>

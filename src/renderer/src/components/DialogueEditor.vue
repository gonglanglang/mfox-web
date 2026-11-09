<script setup lang="ts">
/**
 * 对白/旁白编辑器（contentEditable）
 * - 任意位置输入 @ 弹出角色下拉（旁白固定在首位）
 * - 选中后把 @ 替换为「@角色名：」，光标移到冒号后
 * - 当前行已有内容时再次选角色 → 强制从新的一行开始
 * - Enter 手动换行；无 @角色 前缀的行按普通文本（旁白）处理
 * - 数据模型：每行 ↔ segments 一段（narration 段 ↔ 旁白行；dialogue 段 ↔ @角色行），保持行序
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import type { Segment } from '@/utils/segments'

interface CharacterOption { id?: number | string; name: string; images?: { url?: string }[] }
interface MenuItem { kind: 'narration' | 'character'; id?: number; name: string; avatar?: string }

const MENU_WIDTH = 176 // w-44

const props = withDefaults(defineProps<{
  segments: Segment[]
  characters: CharacterOption[]
  placeholder?: string
}>(), {
  segments: () => [],
  characters: () => [],
  placeholder: '输入 @ 选择角色或旁白，如 @主人公：你好...',
})

const emit = defineEmits<{ save: [] }>()

/** 兼容接口返回的数字字符串，避免空值、NaN 或非法 ID 参与匹配和保存。 */
function normalizeRoleId(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

// ── 状态 ──
const editorEl = ref<HTMLDivElement | null>(null)
/** 逻辑行模型：每行一条纯文本（@角色名：台词 / @旁白：内容 / 无前缀普通文本） */
const lines = ref<string[]>([])
/** IME 组合输入期间不重建 DOM，避免打断拼音输入 */
const composing = ref(false)

// ── 下拉（旁白固定在首位，其后为角色列表） ──
const menuVisible = ref(false)
const menuTop = ref(0)
const menuLeft = ref(0)
const activeIndex = ref(0)

const menuItems = computed<MenuItem[]>(() => [
  { kind: 'narration', name: '旁白' },
  ...props.characters
    .filter(c => c && c.name && c.name.trim() && c.name.trim() !== '旁白')
    .map(c => ({ kind: 'character' as const, id: normalizeRoleId(c.id), name: c.name.trim(), avatar: c.images?.[0]?.url }))
    .filter(c => c.id !== undefined),
])

// 下拉列表容器，用于上下键时把高亮项滚动到可见区域
const menuListEl = ref<HTMLDivElement | null>(null)

function scrollActiveIntoView() {
  const container = menuListEl.value
  if (!container) return
  const btn = container.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`)
  if (!btn) return
  const cr = container.getBoundingClientRect()
  const br = btn.getBoundingClientRect()
  if (br.top < cr.top) {
    container.scrollTop += br.top - cr.top - 4
  } else if (br.bottom > cr.bottom) {
    container.scrollTop += br.bottom - cr.bottom + 4
  }
}

// 高亮项变化（方向键 / 鼠标悬停）时，自动把该项滚入列表可视区
watch(activeIndex, () => nextTick(scrollActiveIntoView))

// ── 行模型 ↔ segments ──
/**
 * 解析一行：
 * - @旁白：… → narration
 * - @任意角色名：… → dialogue（不要求角色已在列表中，避免 round-trip 时前缀丢失）
 * - 无前缀 / 无冒号 → narration，整行按普通文本保留
 */
function parseRow(line: string): { kind: 'narration' | 'dialogue'; roleName?: string; body: string } {
  const m = line.match(/^@([^：:]+)[：:]\s*(.*)$/)
  if (m) {
    const name = m[1].trim()
    if (name === '旁白') return { kind: 'narration', body: m[2] }
    if (name) return { kind: 'dialogue', roleName: name, body: m[2] }
  }
  return { kind: 'narration', body: line }
}

/** 从 segments 生成行文本（narration 段 → @旁白：…；dialogue 段 → @角色名：…） */
function linesFromSegments(segs: Segment[]): string[] {
  const rows: string[] = []
  for (const s of segs || []) {
    if (!s) continue
    if (s.type === 'narration') {
      // 旁白与角色同样带「@旁白：」前缀；空文本旁白段显示为空行。
      // 这样 Enter 产生的空行 round-trip 一致，不会被外部同步反复重建。
      rows.push(s.text ? `@旁白：${s.text}` : '')
      continue
    }
    if (s.type === 'dialogue' && s.role_id != null) {
      const roleId = normalizeRoleId(s.role_id)
      const c = roleId === undefined ? undefined : props.characters.find(c => normalizeRoleId(c.id) === roleId)
      const name = s.speaker || c?.name
      rows.push(name ? `@${name}：${s.text ?? ''}` : (s.text ?? ''))
      continue
    }
    rows.push(s.text ?? '')
  }
  return rows
}

/** 行文本 → segments（旁白行 → narration 段；@角色行 → dialogue 段），保持行序 = 原时序 */
function segmentsFromLines(rows: string[]): Segment[] {
  const used = new Set<number>()
  return rows.map((line, index) => {
    const p = parseRow(line)
    // 优先匹配未改动的行，插入/删除对白时不把语气和情绪串到别的行。
    const previousLines = linesFromSegments(props.segments)
    let sourceIndex = previousLines.findIndex((text, i) => text === line && !used.has(i))
    if (sourceIndex < 0 && !used.has(index) && !rows.includes(previousLines[index])) sourceIndex = index
    if (sourceIndex >= 0) used.add(sourceIndex)
    const previous = props.segments[sourceIndex]
    if (p.kind === 'dialogue') {
      const char = props.characters.find(c => c.name?.trim() === p.roleName && normalizeRoleId(c.id) !== undefined)
      const sameSpeaker = previous?.speaker === p.roleName
      return { ...previous, type: 'dialogue', role_id: sameSpeaker ? previous.role_id : normalizeRoleId(char?.id), speaker: p.roleName, text: p.body }
    }
    return { ...previous, type: 'narration', role_id: undefined, speaker: '旁白', text: p.body }
  })
}

/** 是否正处于「自己写回 segments」的过程；写回会触发 deep watch，需要跳过避免重建 */
let syncingSegments = false

/** 把编辑后的 segments 写回 props.segments（整体替换内容，保持数组引用不变） */
function syncSegments() {
  const next = segmentsFromLines(lines.value)
  if (!Array.isArray(props.segments)) return
  dirty = true
  syncingSegments = true
  props.segments.splice(0, props.segments.length, ...next)
  // watch 回调在本轮 flush 中执行，此时标志仍为 true；flush 结束后再复位
  nextTick(() => { syncingSegments = false })
}

// 外部数据变化（AI 重新提取 / 角色列表加载）时重新初始化；
// 自己写回触发的 watch 由 syncingSegments 抑制，编辑中不会重建 DOM、光标不会乱跳。
watch([() => props.segments, () => props.characters], () => {
  if (syncingSegments) return
  const next = linesFromSegments(props.segments || [])
  if (next.join('\n') !== lines.value.join('\n')) {
    lines.value = next
    nextTick(() => {
      render()
      setCaret(0) // 外部重载后光标回到开头，避免残留失效选区
      updateMenuState()
    })
  }
}, { deep: true, immediate: true })

// 挂载后再渲染一次（immediate watch 在挂载前执行时 editorEl 尚不存在，需兜底）
onMounted(() => render())

// ── DOM 渲染 ──
/** 创建高亮角色标签 span */
function makeRoleTag(text: string, kind: 'dialogue' | 'narration'): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = kind === 'dialogue' ? 'role-tag role-tag--dialogue' : 'role-tag role-tag--narration'
  span.textContent = text
  return span
}

/**
 * 用纯文本模型重建 DOM：
 * 逻辑行之间用 <br> 分隔，空行本身也由 <br> 承载。
 * （空文本节点在 contentEditable 中承载不了光标，会造成「按回车要按两次」，
 *   <br> 是 contentEditable 标准的换行节点，光标可以稳定落在它前后。）
 * 每次输入后重建可避免浏览器在 contentEditable 内留下错乱的内联节点，
 * 同时保证 @角色名： 的视觉高亮始终与文本模型一致。
 */
function render() {
  const el = editorEl.value
  if (!el) return
  el.innerHTML = ''
  lines.value.forEach((row, i) => {
    if (i > 0) el.appendChild(document.createElement('br'))
    const p = parseRow(row)
    if (p.kind === 'dialogue') {
      el.appendChild(makeRoleTag(`@${p.roleName}：`, 'dialogue'))
      el.appendChild(document.createTextNode(p.body))
    } else if (/^@旁白[：:]/.test(row)) {
      el.appendChild(makeRoleTag('@旁白：', 'narration'))
      el.appendChild(document.createTextNode(p.body))
    } else if (row !== '') {
      const span = document.createElement('span')
      span.className = 'narration-text'
      span.textContent = row
      el.appendChild(span)
    }
    // 空行不添加任何节点：由前一个 <br>（或空编辑器）承载
  })
}

// ── 纯文本 / 光标（<br> 在模型中计作 1 个 '\n'） ──
function nodeTextLen(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').length
  if (node.nodeName === 'BR') return 1
  return (node.textContent ?? '').length
}

function getPlainText(): string {
  const el = editorEl.value
  if (!el) return ''
  const parts: string[] = []
  const collect = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '')
    else if (node.nodeName === 'BR') parts.push('\n')
    else node.childNodes.forEach(collect)
  }
  el.childNodes.forEach(collect)
  return parts.join('')
}

/** 计算从编辑器开头到 (container, offset) 的模型字符数 */
function computeCaretOffset(root: HTMLElement, container: Node, offset: number): number {
  let total = 0
  const visit = (node: Node): boolean => {
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.min(offset, (node.textContent ?? '').length)
      } else if (node.nodeName === 'BR') {
        // 光标落在 <br> 上时按 <br> 之前计算
      } else {
        const childOffset = Math.max(0, Math.min(offset, node.childNodes.length))
        for (let i = 0; i < childOffset; i++) total += nodeTextLen(node.childNodes[i])
      }
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent ?? '').length
      return false
    }
    if (node.nodeName === 'BR') {
      total += 1
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true
    }
    return false
  }
  visit(root)
  return total
}

function getCaretOffset(): number {
  const el = editorEl.value
  const sel = window.getSelection()
  if (!el || !sel || !sel.rangeCount) return getPlainText().length
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return getPlainText().length
  return computeCaretOffset(el, range.startContainer, range.startOffset)
}

function setCaret(offset: number) {
  const el = editorEl.value
  const sel = window.getSelection()
  if (!el || !sel) return
  const text = getPlainText()
  const target = Math.max(0, Math.min(offset, text.length))
  const range = document.createRange()
  let remaining = target
  let placed = false
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]
    const len = nodeTextLen(node)
    if (remaining <= len) {
      if (node.nodeType === Node.TEXT_NODE) {
        range.setStart(node, remaining)
      } else if (node.nodeName === 'BR') {
        // remaining 0 → <br> 前（本行行尾）；1 → <br> 后（下一行行首）
        range.setStart(el, i + (remaining > 0 ? 1 : 0))
      } else {
        const textNode = node.firstChild
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          range.setStart(textNode, remaining)
        } else {
          range.setStart(el, i)
        }
      }
      placed = true
      break
    }
    remaining -= len
  }
  if (!placed) {
    // 光标在末尾（含最后一个 <br> 之后）
    range.selectNodeContents(el)
    range.collapse(false)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

function getCaretRect(): DOMRect | null {
  const el = editorEl.value
  const sel = window.getSelection()
  if (!el || !sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return null
  return range.getBoundingClientRect()
}

// ── 输入同步 ──
/** 纯文本 → 行模型；空文本按 0 行处理，避免产生空旁白段 */
function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n')
}

/** 是否发生过真实编辑；blur 时只有 dirty 才触发保存，避免进入页面就按分镜数量误保存 */
let dirty = false

/** 从 DOM 纯文本同步行模型并重建 DOM，光标位置保持不变。
 *  若 DOM 文本与行模型一致（例如程序化渲染触发的 input），跳过写回与重建，
 *  避免挂载/重建时误标记 dirty、误触发保存。 */
function syncFromDOM() {
  if (composing.value) return
  const text = getPlainText()
  const offset = getCaretOffset()
  const rows = splitLines(text)
  if (rows.join('\n') === lines.value.join('\n')) return
  lines.value = rows
  syncSegments()
  render()
  setCaret(offset)
  updateMenuState(text, offset)
}

function onInput(e: InputEvent) {
  if (e.isComposing || composing.value) return
  syncFromDOM()
}

function onCompositionStart() {
  composing.value = true
}

function onCompositionEnd() {
  composing.value = false
  // 等浏览器把组合结果写入 DOM 后再同步
  nextTick(() => syncFromDOM())
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const pasted = e.clipboardData?.getData('text/plain') ?? ''
  if (!pasted) return
  const current = getPlainText()
  const offset = getCaretOffset()
  const next = current.slice(0, offset) + pasted + current.slice(offset)
  lines.value = splitLines(next)
  syncSegments()
  render()
  setCaret(offset + pasted.length)
  closeMenu()
}

// ── 事件 ──
function onBlur() {
  closeMenu()
  // 只有真实编辑过才保存：进入页面（未编辑）不会按分镜数量触发多余的存储请求
  if (dirty) {
    dirty = false
    emit('save')
  }
}

function onKeydown(e: KeyboardEvent) {
  // 下拉打开时：方向键/回车/Tab/Esc 用于菜单；其他键关闭菜单并交给默认行为
  if (menuVisible.value) {
    const items = menuItems.value
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (items.length) activeIndex.value = (activeIndex.value + 1) % items.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length) activeIndex.value = (activeIndex.value - 1 + items.length) % items.length
      return
    }
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      selectItem(items[activeIndex.value])
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      selectItem(items[activeIndex.value])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
      return
    }
    closeMenu()
    // 不 return：让 Backspace/字符等按键继续走默认编辑流程
  }

  // 菜单未开：Enter 手动换行（IME 组合期间的 Enter 用于确认候选词，不拦截）
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault()
    insertNewlineAtCaret()
  }
}

/** 在光标处插入换行（纯文本模型操作）：
 *  模型插入 '\n' 后重建 DOM（<br> 分隔），再按坐标把光标放到新行行首。
 *  不再用 DOM 原生插入 <br>——那会在文本末尾 split 出空文本节点，
 *  光标落在 <br> 后 Chromium 视觉上不认，导致要按两次回车。
 *  重建后的 watch 由 syncingSegments 抑制，不会二次重建、光标不乱跳。 */
function insertNewlineAtCaret() {
  const text = getPlainText()
  const offset = getCaretOffset()
  const next = text.slice(0, offset) + '\n' + text.slice(offset)
  lines.value = splitLines(next)
  syncSegments()
  render()
  setCaret(offset + 1)
  closeMenu()
}

// ── @ 菜单 ──
function updateMenuState(text = getPlainText(), offset = getCaretOffset()) {
  if (!composing.value && offset > 0 && text[offset - 1] === '@' && menuItems.value.length) {
    openMenu()
  } else {
    closeMenu()
  }
}

function openMenu() {
  const el = editorEl.value
  if (!el) return
  const caretRect = getCaretRect()
  const editorRect = el.getBoundingClientRect()
  if (caretRect && caretRect.height > 0) {
    menuTop.value = caretRect.bottom - editorRect.top + 4
    const left = caretRect.left - editorRect.left
    menuLeft.value = Math.max(0, Math.min(left, Math.max(0, el.offsetWidth - MENU_WIDTH)))
  } else {
    // 光标矩形不可用时回退到输入框底部
    menuTop.value = el.offsetHeight + 4
    menuLeft.value = 0
  }
  activeIndex.value = 0
  menuVisible.value = true
}

function closeMenu() {
  menuVisible.value = false
}

function selectItem(item: MenuItem | undefined) {
  if (!item) {
    closeMenu()
    return
  }
  const text = getPlainText()
  const offset = getCaretOffset()
  const at = offset - 1
  if (text[at] !== '@') {
    closeMenu()
    return
  }

  const prefix = item.kind === 'narration' ? '@旁白：' : `@${item.name}：`
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const before = text.slice(lineStart, at)
  // 当前行已有内容时再次选角色 → 强制从新的一行开始；空行/行首则原地替换 @
  const forceNewline = before.length > 0
  const next = forceNewline
    ? text.slice(0, at) + '\n' + prefix + text.slice(offset)
    : text.slice(0, at) + prefix + text.slice(offset)

  lines.value = splitLines(next)
  syncSegments()
  closeMenu()
  render()
  const caret = (forceNewline ? at + 1 : at) + prefix.length
  nextTick(() => {
    setCaret(caret)
    editorEl.value?.focus()
  })
}
</script>

<template>
  <div class="relative">
    <!-- 对白/旁白编辑区 -->
    <div ref="editorEl" contenteditable="true" :data-placeholder="placeholder"
      class="dialogue-editor min-h-[3rem] max-h-40 overflow-y-auto text-[13px] leading-relaxed outline-none whitespace-pre-wrap break-words cursor-text rounded-lg px-2 py-1.5 bg-base-200/40 hover:bg-base-200/60 focus:bg-base-200/60 transition-colors"
      @input="onInput" @keydown="onKeydown" @blur="onBlur" @paste="onPaste"
      @compositionstart="onCompositionStart" @compositionend="onCompositionEnd"></div>

    <!-- 下拉：角色（带头像）+ 旁白 -->
    <div v-if="menuVisible" ref="menuListEl"
      class="absolute z-30 mt-1 w-44 max-h-52 overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-lg py-1"
      :style="{ top: menuTop + 'px', left: menuLeft + 'px' }">
      <template v-for="(item, i) in menuItems" :key="`${item.kind}-${item.name}-${i}`">
        <div class="px-1 py-0.5">
          <button :data-index="i" class="w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2"
            :class="[
              i === activeIndex ? 'bg-primary/10 text-primary font-medium' : 'text-base-content/80 hover:bg-base-200',
              item.kind === 'narration' ? 'italic text-base-content/70' : '',
            ]" @mousedown.prevent="selectItem(item)" @mouseenter="activeIndex = i">
            <img v-if="item.kind === 'character' && item.avatar" :src="item.avatar" alt=""
              class="w-6 h-6 object-contain shrink-0 rounded bg-base-200" />
            <span v-else
              class="flex items-center justify-center w-5 h-5 rounded-full bg-base-200 shrink-0 text-[10px]">
              {{ item.kind === 'narration' ? '📖' : item.name.slice(0, 1) }}
            </span>
            <span class="truncate">{{ item.name }}</span>
          </button>
        </div>
      </template>
      <div v-if="!menuItems.length" class="px-3 py-2 text-xs text-base-content/30">暂无角色</div>
    </div>
  </div>
</template>

<style scoped>
.dialogue-editor:empty::before {
  content: attr(data-placeholder);
  color: color-mix(in oklab, var(--color-base-content) 25%, transparent);
  font-style: italic;
  font-size: 12px;
  pointer-events: none;
}
</style>

<!--
  下面的样式作用于 JS 动态创建的 span（role-tag / narration-text），
  不能用 scoped：动态节点不会带 data-v 属性，scoped 选择器匹配不到。
-->
<style>
/* 角色标签：@角色名： 视觉高亮（--color-primary 缺失时回退到蓝色，保证一定有颜色） */
.role-tag {
  border-radius: 4px;
  padding: 0 2px;
  margin-right: 1px;
  font-weight: 600;
}

.role-tag--dialogue {
  color: var(--color-primary, #2563eb);
  background: color-mix(in oklab, var(--color-primary, #2563eb) 10%, transparent);
}

/* 旁白标签：与角色一样带颜色高亮（用不同色系区分） */
.role-tag--narration {
  color: var(--color-secondary, #7c3aed);
  background: color-mix(in oklab, var(--color-secondary, #7c3aed) 10%, transparent);
}

/* 无前缀普通文本（旁白段落）弱化显示 */
.narration-text {
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}
</style>

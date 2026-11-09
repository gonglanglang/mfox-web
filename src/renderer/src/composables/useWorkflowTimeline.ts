// ============================================
// 全局工作流时间链状态（跨页面持久化）
// ============================================
// 模块级单例：Home（发起）、Write/VideoStoryboard（承接）、WorkflowTimeline（展示/重连）
// 共享同一份状态，页面跳转后事件流由新页面接管，状态不丢失。
// ============================================
import { ref } from 'vue'
import type { Ref } from 'vue'

export interface TimelineStep {
  name: string
  label: string
  status: 'wait' | 'running' | 'done' | 'failed'
}

// ── 全局状态（模块级单例） ──
/** 时间链步骤列表 */
const steps: Ref<TimelineStep[]> = ref([])
/** 时间链弹窗是否可见 */
const visible = ref(false)
/** 目标作品 ID（create-novel 步骤产出，供页面跳转使用） */
const targetWorkId = ref(0)
/** 流式增量内容（NovelEditor 通过 watch 消费后清空） */
const generatedContent = ref('')
/** 内容是否已最终完成（SSE [DONE] / generate-chapter-content 步骤完成时置 true） */
const contentFinalized = ref(false)
/**
 * 步骤完成时的权威完整内容（整体替换流式累积，避免与增量 chunk 重复）。
 * 由 Home 侧 onStepDone('generate-chapter-content') 通过 setFinalContent 写入，
 * 由 NovelEditor 在 contentFinalized 时消费（若存在则整体替换编辑器内容）。
 */
const finalContent = ref('')
/**
 * create-volumes-chapter 步骤完成时产出的新章节 ID（前端需刷新并选中）。
 * 由 WorkflowTimeline 恢复模式 / 主动发起方在步骤完成时写入，Write.vue watch 消费后清空。
 */
const pendingSelectChapterId = ref<number | null>(null)

export function useWorkflowTimeline() {
  // ── 重置 ──
  /** 重置全部时间链状态（新任务开始 / 页面恢复前） */
  function reset() {
    steps.value = []
    visible.value = false
    targetWorkId.value = 0
    generatedContent.value = ''; contentFinalized.value = false; finalContent.value = ''
    pendingSelectChapterId.value = null
  }

  // ── 启动 / 恢复 ──
  /** 启动新时间链 */
  function start(stepsConfig: { name: string; label: string }[]) {
    reset()
    visible.value = true
    steps.value = stepsConfig.map(s => ({ ...s, status: 'wait' as const }))
  }

  /** 从持久化状态恢复时间链（保留已有 status，供重连回显） */
  function restore(stepsConfig: TimelineStep[]) {
    reset()
    if (!stepsConfig.length) {
      // 恢复早期任务表的 stepsConfig 可能尚未落库：仍显示时间链壳（visible 置 true），
      // 待重连 running 快照携带最新 stepsConfig 后再调用一次 restore 填充步骤
      console.warn('时间链配置暂为空，已显示占位（等待快照补充）')
      visible.value = true
      steps.value = []
      return
    }
    visible.value = true
    steps.value = stepsConfig.map(s => ({
      name: s.name,
      label: s.label,
      status: s.status || 'wait',
    }))
  }

  // ── 步骤状态 ──
  /** 设置步骤为 running 状态 */
  function setRunning(name: string) {
    const s = steps.value.find(t => t.name === name)
    if (s) s.status = 'running'
  }

  /** 设置步骤为 done 状态 */
  function setDone(name: string) {
    const s = steps.value.find(t => t.name === name)
    if (s) s.status = 'done'
  }

  /** 设置步骤为 failed；未传名称时优先标记当前运行中的步骤 */
  function setFailed(name?: string) {
    const s = name
      ? steps.value.find(t => t.name === name)
      : steps.value.find(t => t.status === 'running') || steps.value.find(t => t.status === 'wait')
    if (s) s.status = 'failed'
  }

  // ── 内容状态 ──
  /** 设置流式增量内容（每次推送一个 token，NovelEditor 消费后清空） */
  function setContent(text: string) {
    generatedContent.value = text
  }

  /** 设置步骤完成时的权威完整内容（整体替换，而非追加） */
  function setFinalContent(text: string) {
    finalContent.value = text
  }

  // ── 完成 / 隐藏 ──
  /** 检查所有步骤是否完成 */
  function allDone() {
    return steps.value.length > 0 && steps.value.every(s => s.status === 'done')
  }

  /**
   * 一步到位把所有未完成步骤标记为 done。
   * 用于「服务端任务其实已完成、但 SSE 长连接中途断开」的对账收尾：
   * 弹窗只在 allDone / hasFailed 时自动隐藏，缺了这一步会永久停在“进行中”。
   */
  function finishAll() {
    for (const s of steps.value) if (s.status !== 'done') s.status = 'done'
  }

  /** 隐藏时间链 */
  function hide() {
    visible.value = false
  }

  return { steps, visible, targetWorkId, generatedContent, contentFinalized, finalContent, pendingSelectChapterId, reset, start, restore, setRunning, setDone, setFailed, setContent, setFinalContent, allDone, finishAll, hide }
}

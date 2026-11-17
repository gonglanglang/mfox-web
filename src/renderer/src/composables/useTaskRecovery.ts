import { onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { listTasks, reconnectStream } from '@/api/task'
import { SKIP_AUTH_MODE, getAuthToken } from '@/composables/useAuth'

export interface TaskRecoveryStep {
  name: string
  label?: string
  status?: 'wait' | 'running' | 'done' | 'failed'
}

export interface TaskRecoveryOptions {
  /** 任务类型筛选（缺省匹配所有类型） */
  types?: string[]
  /** 任务链：与任务持久化的 stepsConfig 合并后，通过 onRecoverMeta 的 steps 字段回传 */
  steps?: TaskRecoveryStep[]
  /** 首次查找未命中 running 任务时的重试次数（间隔 retryIntervalMs）。默认 2（覆盖 SPA 跳转的竞态窗口） */
  retries?: number
  /** 重试间隔（毫秒）。默认 1000 */
  retryIntervalMs?: number
  /** 重连到失败任务或续流失败时的回调 */
  onError?: (err: Error) => void
  onStepProgress?: (step: string, label: string) => void
}

/** 合并调用方任务链与后端持久化步骤状态，得到恢复用任务链 */
function resolveSteps(steps: TaskRecoveryStep[] | undefined, stepsConfig?: string): TaskRecoveryStep[] {
  const normalizeStatus = (s: any): TaskRecoveryStep['status'] =>
    s === 'running' || s === 'done' || s === 'failed' ? s : 'wait'

  const base = (steps || []).map(s => ({ ...s, status: normalizeStatus(s.status) }))

  let persisted: any[] = []
  if (stepsConfig) {
    try {
      const parsed = JSON.parse(stepsConfig)
      if (Array.isArray(parsed)) persisted = parsed
    } catch { /* stepsConfig 损坏时忽略 */ }
  }

  if (!base.length) {
    return persisted.map((p: any) => ({ name: p?.name ?? '', label: p?.label, status: normalizeStatus(p?.status) }))
  }
  if (!persisted.length) return base

  return base.map(s => {
    const p = persisted.find((x: any) => x?.name === s.name)
    return p ? { ...s, label: p.label || s.label, status: normalizeStatus(p.status ?? s.status) } : s
  })
}

/**
 * 任务恢复：页面加载时检查是否有未完成的任务，自动重连其 SSE 流。
 *
 * @param onRecoverToken 回显任务流式输出
 * @param onRecoverDone  任务流结束（[DONE]）
 * @param onRecoverMeta  回显任务元信息（含合并后的 steps 任务链）
 * @param onStep         workflow 步骤开始
 * @param onStepDone     workflow 步骤完成
 * @param options        任务类型筛选 + 任务链配置
 */
export function useTaskRecovery(
  onRecoverToken: (token: string) => void,
  onRecoverDone: (fullText: string) => void,
  onRecoverMeta?: (meta: Record<string, any>) => void,
  onStep?: (step: string) => void,
  onStepDone?: (step: string, output: any) => void,
  options?: TaskRecoveryOptions,
) {
  const route = useRoute()
  // 重连流的取消函数（组件卸载时断开）
  let stopStream: (() => void) | null = null

  onMounted(async () => {
    if (!SKIP_AUTH_MODE && !getAuthToken()) return
    const retries = options?.retries ?? 2
    const interval = options?.retryIntervalMs ?? 1000

    // 直接拉取任务列表，避免复用可能滞后的共享缓存导致已 done 任务被误重连
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (stopStream) return // 已被并发重试/卸载接管
      try {
        const tasks = await listTasks()

        // 筛选出当前路由 + 任务类型匹配的未完成任务
        // （types 筛选必须生效：Home 只重连 polish，Write 只重连 aiNovel，
        //   否则同一任务会被两个页面重复订阅）
        const running = tasks.find(t => (
          t.status === 'running' // 任务必须是 running 状态
          && (t.router === route?.path || route?.path?.startsWith(t.router)) // 任务必须是当前路由
          && (!options?.types || options.types.includes(t.type)) // 任务类型必须匹配
        ))

        if (running) {
          // 回显任务元信息（题材、目标读者、steps 任务链等）
          onRecoverMeta?.({ ...running, steps: resolveSteps(options?.steps, running.stepsConfig) })

          // 统一重连：快照回显历史全文 → 长连接续推后续 token / workflow 步骤事件 → [DONE]
          let shownLen = 0
          stopStream = reconnectStream(running.taskId, {
            // 快照全文：与续流增量共享 shownLen 去重
            onSnapshot(result, meta) {
              // running 快照携带最新落库的 stepsConfig：恢复早期 listTasks 读到的
              // stepsConfig 可能滞后（任务表尚未刷新），用它重新恢复时间链（幂等）
              if (meta?.stepsConfig) {
                const freshSteps = resolveSteps(undefined, meta.stepsConfig)
                if (freshSteps.length) {
                  onRecoverMeta?.({ ...running, steps: freshSteps })
                }
              }
              if (result && result.length > shownLen) {
                onRecoverToken(result.slice(shownLen))
                shownLen = result.length
              }
            },
            // 续流增量：直接透传，并推进 shownLen 防止快照重复回显
            onToken(text) {
              onRecoverToken(text)
              shownLen += text.length
            },
            onStep,
            onStepDone,
            onStepProgress: options?.onStepProgress,
            onDone: onRecoverDone,
            onError(err) { options?.onError?.(err) },
          })
          return
        }

        // 未命中：SPA 跳转（如 Home 生成中跳 Write）时任务落库可能略滞后，短暂等待后重试
        if (attempt < retries) {
          console.warn(`任务恢复：第 ${attempt + 1} 次未找到匹配的 running 任务，${interval}ms 后重试`,
            tasks.map(t => ({ taskId: t.taskId, type: t.type, status: t.status, router: t.router })))
          await new Promise(r => setTimeout(r, interval))
        }
      } catch {
        // 任务列表获取失败时静默跳过恢复
        if (attempt < retries) await new Promise(r => setTimeout(r, interval))
      }
    }
  })

  onUnmounted(() => {
    stopStream?.()
    stopStream = null
  })
}

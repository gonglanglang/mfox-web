import { get, del } from './request'
import { streamSSE } from './sse'

export interface TaskItem {
  userId: number
  taskId: string
  status: 'running' | 'done' | 'failed'
  router: string
  type: string
  result?: string
  genre?: string
  targetAudience?: string
  audience?: string
  pov?: string
  content?: string
  description?: string
  text?: string
  stepsConfig?: string
  workId?: number
  createdAt: string
}

/** 任务分页结果（后端 /agent/task?page=&pageSize= 返回） */
export interface TaskPage {
  list: TaskItem[]
  total: number
  page: number
  pageSize: number
}

/** 获取用户任务列表（全量，供 NavBar 轮询 / 任务恢复使用） */
export function listTasks(): Promise<TaskItem[]> {
  return get('/agent/task')
}

/** 分页获取用户任务列表 */
export function listTasksPage(page = 1, pageSize = 10): Promise<TaskPage> {
  return get('/agent/task', { page, pageSize })
}

/** 清理已完成任务 */
export function deleteTask(taskId: string): Promise<void> {
  return del(`/agent/task/${taskId}`)
}

/** 重连运行中的任务流（token 快照 + 续订广播，统一处理 token / workflow 事件） */
export function reconnectStream(
  taskId: string,
  callbacks: {
    /** running 快照的已生成全文（meta.stepsConfig 为最新落库的时间链，供恢复时间链使用） */
    onSnapshot: (result: string, meta?: { stepsConfig?: string }) => void
    /** 续流增量文本 */
    onToken: (text: string) => void
    /** workflow 步骤开始（可选） */
    onStep?: (step: string) => void
    /** workflow 步骤完成（可选） */
    onStepDone?: (step: string, output: any) => void
    onStepProgress?: (step: string, label: string) => void
    /** 流结束（[DONE]） */
    onDone: (fullText: string) => void
    /** 流错误 */
    onError: (err: Error) => void
  }
): () => void {
  const base = import.meta.env.VITE_API_BASE_URL || '/api'
  const url = `${base}/agent/task/${taskId}/stream`
  let fullText = ''

  const sse = streamSSE(url, {
    method: 'GET',
    onMessage(data) {
      if (data === '[DONE]') {
        // 任务保留在列表中，由用户手动删除（不自动清理）
        callbacks.onDone(fullText)
        return
      }
      try {
        const parsed = JSON.parse(data)

        // running：当前快照（result 已实时落库），回显已生成部分
        if (parsed?.type === 'running') {
          const result = parsed.result || ''
          if (result) {
            fullText = result
          }
          callbacks.onSnapshot(result, { stepsConfig: parsed.stepsConfig as string | undefined })
          return
        }
        // 刷新竞态：列表仍为 running 但后端已完成 → 以后端 result 为准
        if (parsed?.type === 'done') {
          const result = parsed.result || ''
          if (result) {
            fullText = result
            callbacks.onSnapshot(result)
          }
          return
        }
        if (parsed?.type === 'failed') {
          callbacks.onError(new Error(parsed.result || '任务执行失败'))
          return
        }
        // workflow 步骤事件
        if (parsed?.type === 'workflow-step-output' && parsed.payload?.output?.type === 'frame-prompt-progress') {
          const progress = parsed.payload.output
          if (typeof progress.label === 'string') callbacks.onStepProgress?.(progress.stepName, progress.label.slice(0, 180))
          return
        }
        if (parsed?.type === 'workflow-step-start') {
          callbacks.onStep?.(parsed.payload?.stepName || parsed.payload?.id || '')
          return
        }
        if (parsed?.type === 'workflow-step-result') {
          callbacks.onStepDone?.(parsed.payload?.stepName || parsed.payload?.id || '', parsed.payload?.output ?? {})
          return
        }

        const chunk = parsed?.chunk ?? parsed?.token ?? parsed?.data?.token ?? ''
        if (chunk) {
          fullText += chunk
          callbacks.onToken(chunk)
        }
      } catch {
        fullText += data
        callbacks.onToken(data)
      }
    },
    onError(err) {
      callbacks.onError(err)
    },
  })

  return sse.abort
}

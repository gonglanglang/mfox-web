import { fetchEventSource } from '@microsoft/fetch-event-source'
import { toHttpError } from '@/utils/status'
import { AUTH_UNAUTHORIZED_EVENT } from '@/utils/authEvents'
import { useToast } from '@/composables/useToast'

const { show: showToast } = useToast()

export interface SSERequestOptions {
  /** 请求方法，默认 POST */
  method?: 'GET' | 'POST'
  /** 请求体（POST 时 JSON.stringify） */
  body?: unknown
  /** 额外的请求头 */
  headers?: Record<string, string>
  /** 收到一条 SSE 消息（已去除 data: 前缀） */
  onMessage: (data: string) => void
  /** 流错误回调（会在内部 rethrow 以停止 fetch-event-source 重试） */
  onError?: (err: Error) => void
  /** 自定义 onopen 处理（在默认的鉴权/状态码检查之后执行） */
  onOpen?: (response: Response) => Promise<void> | void
}

/**
 * 统一的 SSE 流式请求封装。
 * - 自动携带 Authorization
 * - 401 时派发全局未登录事件
 * - 非 2xx 时转换为带状态码的 HttpError
 * - 返回 abort 函数用于中断连接
 */
export function streamSSE(url: string, options: SSERequestOptions): { abort: () => void } {
  const method = options.method || 'POST'
  const token = localStorage.getItem('token') || ''
  const ctrl = new AbortController()
  // 业务错误（后端 sseError 发送 { error }）主动 abort 后，onerror 不再重复回调
  let aborted = false

  const headers: Record<string, string> = {
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  fetchEventSource(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: ctrl.signal,
    async onopen(response) {
      if (!response.ok) {
        if (response.status === 401) {
          window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT))
        }
        throw await toHttpError(response)
      }
      await options.onOpen?.(response)
    },
    onmessage(ev) {
      // 后端业务错误事件（sseError 发送 { error: msg }）：转成 Error 走 onError 并终止连接
      try {
        const parsed = JSON.parse(ev.data)
        console.log("parsed", parsed)
        if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string' && parsed.error) {
          showToast(parsed.error, 'error')
          aborted = true
          // 调用方已提供 onError 时由其处理（避免 toast + alert 双提示）；
          // 未提供时才用全局 toast 兜底提示
          options.onError?.(new Error(parsed.error))
          ctrl.abort()
          return
        }
      } catch {
        // 非 JSON 内容（如 [DONE] 或原始文本），走正常消息分支
      }
      options.onMessage(ev.data)
    },
    onerror(err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (!aborted) options.onError?.(error) // 业务错误主动 abort 后不再重复回调
      throw err
    },
  })

  return {
    abort: () => {
      aborted = true // 用户主动取消：不再触发 onError（避免取消被误报为错误）
      ctrl.abort()
    },
  }
}

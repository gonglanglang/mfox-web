// ============================================
// HTTP 状态码 / 业务码 → 用户友好提示信息
// ============================================

const STATUS_MESSAGE_MAP: Record<number, string> = {
  400: '请求参数有误',
  401: '请先完成登录',
  403: '没有权限执行此操作',
  404: '请求的资源不存在',
  409: '资源冲突，请刷新后重试',
  429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误，请稍后再试',
  502: '网关错误，请稍后再试',
  503: '服务暂不可用，请稍后再试',
  504: '网关超时，请稍后再试',
}

/**
 * 根据 HTTP 状态码（或后端业务 code）返回用户友好的提示信息
 */
export function getStatusMessage(status: number | null | undefined): string {
  if (status == null) return '网络错误，请稍后再试'
  return STATUS_MESSAGE_MAP[status] ?? `请求失败（状态码 ${status}）`
}

/** 带状态码/业务码的错误对象 */
export interface HttpError extends Error {
  status?: number
  code?: number
}

/**
 * 从 fetch Response 解析为带状态码的错误。
 * 优先使用后端返回的 message，否则回退到状态码映射的提示。
 */
export async function toHttpError(response: Response): Promise<HttpError> {
  let code: number | undefined
  let message = ''
  try {
    const body = await response.json()
    code = body?.code
    message = body?.message || ''
  } catch {
    // 非 JSON 响应体，忽略
  }

  const status = response.status
  const err = new Error(message || getStatusMessage(code ?? status)) as HttpError
  err.status = status
  err.code = code ?? status
  return err
}

/** 判断错误是否为「未登录 / 登录过期」 */
export function isUnauthorizedError(err: unknown): boolean {
  const status = (err as HttpError)?.status
  const code = (err as HttpError)?.code
  return status === 401 || code === 401
}

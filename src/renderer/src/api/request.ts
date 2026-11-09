import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from 'axios'
import { getStatusMessage } from '@/utils/status'
import { AUTH_UNAUTHORIZED_EVENT } from '@/utils/authEvents'

// ============================================
// Response wrapper
// ============================================
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

/** 未登录：通知全局复位登录态并弹出登录框（由 useAuth 模块级监听处理） */
function handleUnauthorized(): void {
  window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT))
}

/** 构造带 status 的错误（供调用方按状态码判断，如 initAuth） */
function toError(message: string, status?: number): Error {
  const err = new Error(message) as Error & { status?: number }
  if (status != null) err.status = status
  return err
}

// ============================================
// Create axios instance
// ============================================
const instance: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// ============================================
// Request interceptor
// ============================================
instance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Attach token if exists
    const token = localStorage.getItem('token')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ============================================
// Response interceptor — 统一错误信息处理
// ============================================
instance.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const { code, data, message } = response.data

    if (code === 0 || code === 200) {
      return data as never
    }

    // 未登录 / 登录过期
    if (code === 401) {
      handleUnauthorized()
      return Promise.reject(toError(message || getStatusMessage(401), code))
    }

    // 其他业务错误：优先后端 message，否则用状态码映射提示
    return Promise.reject(toError(message || getStatusMessage(code), code))
  },
  (error) => {
    const status = error.response?.status

    // HTTP 401：复位登录态并弹登录
    if (status === 401) {
      handleUnauthorized()
    }

    const msg =
      error.response?.data?.message ||
      (status ? getStatusMessage(status) : '网络错误，请稍后再试')
    return Promise.reject(toError(msg, status))
  }
)

// ============================================
// Typed request helpers
// ============================================
export function get<T = any>(url: string, params?: Record<string, unknown>, config?: AxiosRequestConfig): Promise<T> {
  return instance.get(url, { params, ...config })
}

export function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return instance.post(url, data, config)
}

export function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return instance.put(url, data, config)
}

export function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return instance.delete(url, config)
}

export function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return instance.patch(url, data, config)
}

export default instance

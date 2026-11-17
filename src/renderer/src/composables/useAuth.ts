import { ref } from 'vue'
import { authApi } from '@/api/auth'
import { AUTH_UNAUTHORIZED_EVENT } from '@/utils/authEvents'

export interface UserInfo {
  id: number
  nickname: string
  penName: string
  gender: 'male' | 'female' | 'secret'
  avatar: string
  bio: string
  email: string
  phone: string
  wechatOpenid: string
  wechatUnionid: string
  appId: string
  loginType: 'account' | 'phone' | 'wechat'
  points: number
  createdAt: string
}

export const BYPASS_TOKEN_SENTINEL = 'dev-bypass-token'
export const SKIP_AUTH_MODE =
  String(import.meta.env.VITE_SKIP_AUTH ?? 'true').trim().toLowerCase() !== 'false'

function createBypassUserPlaceholder(): UserInfo {
  return {
    id: 1,
    nickname: '测试免登用户',
    penName: '测试创作者',
    gender: 'secret',
    avatar: '',
    bio: '临时免登录、免Token校验、免积分测试模式',
    email: '',
    phone: '',
    wechatOpenid: 'dev_bypass_default_user',
    wechatUnionid: '',
    appId: 'dev_bypass_app',
    loginType: 'account',
    points: 99999999,
    createdAt: new Date().toISOString(),
  }
}

if (typeof window !== 'undefined' && SKIP_AUTH_MODE) {
  try {
    if (!localStorage.getItem('token')) {
      localStorage.setItem('token', BYPASS_TOKEN_SENTINEL)
    }
  } catch { /* ignore storage errors */ }
}

/** 获取当前请求应携带的鉴权 token（免登录测试模式下缺失时自动回退为占位 token，永不返回 'null'） */
export function getAuthToken(): string {
  try {
    const raw = localStorage.getItem('token')
    if (raw && raw !== 'null' && raw !== 'undefined') {
      return raw
    }
  } catch { /* ignore storage errors */ }
  return SKIP_AUTH_MODE ? BYPASS_TOKEN_SENTINEL : ''
}

/** 构造请求所需的 Authorization 头（无 token 且非免登模式时不注入空头） */
export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const isLoggedIn = ref(SKIP_AUTH_MODE)
const user = ref<UserInfo | null>(SKIP_AUTH_MODE ? createBypassUserPlaceholder() : null)
const showLoginModal = ref(false)
const authReady = ref(false)

// 模块级监听全局未登录事件：复位登录态并弹出登录框。
// request.ts 无法直接引用 useAuth（避免循环依赖），通过事件解耦，
// 且此监听在模块加载时注册，不依赖任何组件挂载。
function handleGlobalUnauthorized(): void {
  if (SKIP_AUTH_MODE) {
    isLoggedIn.value = true
    showLoginModal.value = false
    if (!user.value) user.value = createBypassUserPlaceholder()
    try {
      localStorage.setItem('token', BYPASS_TOKEN_SENTINEL)
    } catch { /* ignore */ }
    return
  }
  isLoggedIn.value = false
  user.value = null
  localStorage.removeItem('token')
  showLoginModal.value = true
}

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleGlobalUnauthorized)
}

/** 页面加载时自动恢复登录态 */
export async function initAuth(): Promise<void> {
  let token = localStorage.getItem('token')
  if (!token && SKIP_AUTH_MODE) {
    token = BYPASS_TOKEN_SENTINEL
    try {
      localStorage.setItem('token', token)
    } catch { /* ignore */ }
  }
  if (!token) {
    authReady.value = true
    return
  }
  try {
    const info = await authApi.userinfo()
    user.value = {
      ...info,
      penName: (info as any).pen_name ?? (info as any).penName ?? '',
      wechatOpenid: (info as any).wechat_openid ?? (info as any).wechatOpenid ?? '',
      wechatUnionid: (info as any).wechat_unionid ?? (info as any).wechatUnionid ?? '',
      appId: (info as any).app_id ?? (info as any).appId ?? '',
      loginType: (info as any).login_type ?? (info as any).loginType ?? 'account',
      points: (info as any).points ?? (SKIP_AUTH_MODE ? 99999999 : 0),
    }
    isLoggedIn.value = true
  } catch (err: any) {
    if (SKIP_AUTH_MODE) {
      try {
        localStorage.setItem('token', BYPASS_TOKEN_SENTINEL)
      } catch { /* ignore */ }
      if (!user.value) user.value = createBypassUserPlaceholder()
      isLoggedIn.value = true
      authReady.value = true
      return
    }
    // 只在认证真正失效时才删除 token；网络错误/服务器故障保留 token 静默降级
    const isAuthExpired =
      err?.status === 401 ||
      err?.response?.status === 401 ||
      err?.message?.includes('登录已过期') ||
      err?.message?.includes('token')
    if (isAuthExpired) {
      localStorage.removeItem('token')
    }
    // 网络错误、500、超时等：保留 token，页面显示未登录但不丢失登录态
  }
  authReady.value = true
}

export function useAuth() {
  function login() {
    isLoggedIn.value = true
    showLoginModal.value = false
    initAuth() // fetch userinfo after login
  }

  function logout() {
    if (SKIP_AUTH_MODE) {
      showLoginModal.value = false
      localStorage.setItem('token', BYPASS_TOKEN_SENTINEL)
      isLoggedIn.value = true
      void initAuth()
      return
    }
    isLoggedIn.value = false
    user.value = null
    localStorage.removeItem('token')
  }

  function updateUser(data: Partial<UserInfo>) {
    if (user.value) Object.assign(user.value, data)
  }

  /** 重新拉取用户信息（Profile 页挂载时调用，确保头像等最新） */
  async function refreshUser(): Promise<void> {
    try {
      const info = await authApi.userinfo()
      user.value = {
        ...info,
        penName: (info as any).pen_name ?? (info as any).penName ?? '',
        wechatOpenid: (info as any).wechat_openid ?? (info as any).wechatOpenid ?? '',
        wechatUnionid: (info as any).wechat_unionid ?? (info as any).wechatUnionid ?? '',
        appId: (info as any).app_id ?? (info as any).appId ?? '',
        loginType: (info as any).login_type ?? (info as any).loginType ?? 'account',
        points: (info as any).points ?? (SKIP_AUTH_MODE ? 99999999 : 0),
      }
    } catch { /* ignore */ }
  }

  function openLogin() {
    if (SKIP_AUTH_MODE) {
      isLoggedIn.value = true
      showLoginModal.value = false
      return
    }
    showLoginModal.value = true
  }

  return { isLoggedIn, user, showLoginModal, authReady, login, logout, updateUser, refreshUser, openLogin }
}

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

const isLoggedIn = ref(false)
const user = ref<UserInfo | null>(null)
const showLoginModal = ref(false)
const authReady = ref(false)

// 模块级监听全局未登录事件：复位登录态并弹出登录框。
// request.ts 无法直接引用 useAuth（避免循环依赖），通过事件解耦，
// 且此监听在模块加载时注册，不依赖任何组件挂载。
function handleGlobalUnauthorized(): void {
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
  const token = localStorage.getItem('token')
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
      points: (info as any).points ?? 0,
    }
    isLoggedIn.value = true
  } catch (err: any) {
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
        points: (info as any).points ?? 0,
      }
    } catch { /* ignore */ }
  }

  function openLogin() {
    showLoginModal.value = true
  }

  return { isLoggedIn, user, showLoginModal, authReady, login, logout, updateUser, refreshUser, openLogin }
}

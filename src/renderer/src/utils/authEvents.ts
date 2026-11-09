/**
 * 全局未登录事件。
 * axios（request.ts）或流式请求返回 401 时派发该事件，
 * 由 useAuth 模块级监听器统一复位登录态并弹出登录框。
 */
export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized'

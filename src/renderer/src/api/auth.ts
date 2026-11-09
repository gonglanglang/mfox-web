import { get, put, post } from './request'

export const authApi = {
  /** 获取个人信息 */
  userinfo() {
    return get<{
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
      createdAt: string
    }>('/users/userinfo')
  },

  /** 更新个人信息 */
  update(data: Record<string, unknown>) {
    return put<{ message: string }>('/users/userinfo', data)
  },

  /** 上传头像 */
  uploadAvatar(userId: number, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return post<{ url: string }>(`/oss/${userId}/avatar`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  },

  /** 测试登录（开发用）：按 wechatOpenid 直接签发 token */
  testLogin(wechatOpenid: string) {
    return post<{ token: string }>('/auth/test-login', { wechatOpenid })
  },

  /** 退出登录 */
  logout() {
    return post<{ message: string }>('/auth/logout')
  }
}

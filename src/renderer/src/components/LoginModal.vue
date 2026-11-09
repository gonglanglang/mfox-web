<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { fetchWechatQr, checkWechatStatus } from '@/api/stream'
import { authApi } from '@/api/auth'
import AppModal from '@/components/AppModal.vue'

const { showLoginModal, login } = useAuth()

const qrUrl = ref('')
const qrLoading = ref(false)
const qrExpired = ref(false)
const qrError = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

// 测试登录使用的微信 openid（对应用户 id=1 的测试账号）
const TEST_OPENID = 'oIrB72JwyfkjiPMSZvlEkRhbQfNU'

async function loadQr(): Promise<void> {
  qrExpired.value = false
  qrError.value = ''
  qrLoading.value = true
  stopPoll()
  try {
    const { qrcodeUrl, scene_str } = await fetchWechatQr()
    qrUrl.value = qrcodeUrl
    startPoll(scene_str)
  } catch { qrError.value = '获取二维码失败' }
  qrLoading.value = false
}

/** 测试登录：直接按测试 openid 签发 token，跳过扫码 */
async function testLogin(): Promise<void> {
  try {
    const { token } = await authApi.testLogin(TEST_OPENID)
    localStorage.setItem('token', token)
    login()
  } catch (e: any) {
    qrError.value = e?.message || '测试登录失败'
  }
}

function startPoll(scene: string): void {
  pollTimer = setInterval(async () => {
    try {
      const { status, token } = await checkWechatStatus(scene)
      if (status === 'ok' && token) {
        stopPoll()
        localStorage.setItem('token', token)
        login()
      } else if (status === 'expired') {
        stopPoll()
        qrExpired.value = true
      }
    } catch { /* ignore */ }
  }, 2000)
}

function stopPoll(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

watch(showLoginModal, (open) => {
  if (open) {
    // 每次打开都重新加载二维码并启动轮询（旧二维码可能已过期）
    loadQr()
  } else {
    stopPoll()
    qrUrl.value = '' // 清空旧二维码，下次打开重新加载
  }
})
</script>

<template>
  <AppModal :open="showLoginModal" @close="showLoginModal = false">
    <div class="modal-box max-w-md p-0 overflow-hidden">
      <!-- 扫码区 -->
      <div class="p-8 flex flex-col items-center justify-center">
        <h3 class="text-xl font-bold mb-2">微信扫码登录</h3>
        <p class="text-sm text-base-content/50 mb-6">关注公众号自动完成登录</p>

        <div class="w-44 h-44 bg-base-300 rounded-2xl flex items-center justify-center mb-5 overflow-hidden">
          <span v-if="qrLoading" class="loading loading-spinner loading-lg text-primary"></span>
          <div v-else-if="qrError" class="text-base-content/40 text-sm text-center p-4">
            <div class="text-3xl mb-2">😢</div>
            <div>{{ qrError }}</div>
            <button class="btn btn-xs btn-outline mt-2" @click="loadQr">重试</button>
          </div>
          <div v-else-if="qrExpired" class="text-base-content/50 text-sm text-center p-4">
            <div class="text-3xl mb-2">⏰</div>
            <div>已过期</div>
            <button class="btn btn-xs btn-outline btn-primary mt-2" @click="loadQr">刷新</button>
          </div>
          <img v-else :src="qrUrl" class="w-full h-full object-cover" alt="微信扫码" />
        </div>

        <p class="text-xs text-base-content/30">扫码后自动登录</p>

        <!-- 测试登录（开发用） -->
        <button class="btn btn-outline btn-xs mt-3" @click="testLogin">测试登录</button>
      </div>
    </div>
  </AppModal>
</template>

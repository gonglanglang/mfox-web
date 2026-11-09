<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { authApi } from '@/api/auth'
import LoginModal from '@/components/LoginModal.vue'

const { isLoggedIn, user, logout, openLogin } = useAuth()
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

async function handleLogout(): Promise<void> {
  menuOpen.value = false
  try { await authApi.logout() } catch { /* ignore */ }
  logout()
}

// 点击组件外部时关闭下拉菜单
function onDocClick(e: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <!-- 已登录：头像 + 昵称 + 下拉菜单 -->
  <div v-if="isLoggedIn" ref="menuRef" class="relative shrink-0">
    <div class="flex items-center gap-2 pl-3 md:px-4 border-l border-base-300 cursor-pointer"
      @click.stop="menuOpen = !menuOpen">
      <div v-if="user?.avatar" class="avatar">
        <div class="w-8 rounded-full">
          <img :src="user.avatar" alt="avatar" />
        </div>
      </div>
      <div v-else class="avatar placeholder">
        <div class="bg-primary/10 text-primary rounded-full w-8 border border-primary/20">
          <span class="text-xs font-bold">{{ (user?.nickname || '?').charAt(0) }}</span>
        </div>
      </div>
      <span class="text-sm font-medium hidden sm:inline-block">{{ user?.nickname }}</span>
    </div>

    <div v-if="menuOpen"
      class="absolute right-0 z-50 mt-2 w-44 bg-base-100 rounded-box shadow-lg border border-base-200 p-1 flex flex-col">
      <RouterLink to="/profile"
        class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-base-200 transition-colors"
        @click="menuOpen = false">
        <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        个人信息
      </RouterLink>
      <RouterLink to="/orders"
        class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-base-200 transition-colors"
        @click="menuOpen = false">
        <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        订单信息
      </RouterLink>
      <div class="border-t border-base-200"></div>
      <button
        class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-base-content/60 hover:bg-base-200 transition-colors"
        @click="handleLogout()">
        <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        退出登录
      </button>
    </div>
  </div>

  <!-- 未登录：登录入口 -->
  <button v-else
    class="flex items-center gap-2 pl-3 md:px-4 border-l border-base-300 hover:opacity-80 transition-opacity shrink-0"
    @click="openLogin">
    <div class="avatar placeholder">
      <div class="bg-primary/10 text-primary rounded-full w-8 border border-primary/20 flex items-center justify-center">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
    </div>
    <span class="text-sm font-medium hidden sm:inline-block">未登录</span>
  </button>

  <!-- 登录弹窗（未登录时点击登录入口使用） -->
  <LoginModal />
</template>

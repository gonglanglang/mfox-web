<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useTaskStatus } from '@/composables/useTaskStatus'
import TaskList from '@/components/TaskList.vue'
import PointsBadge from '@/components/PointsBadge.vue'
import UserMenu from '@/components/UserMenu.vue'

const route = useRoute()
const { runningCount, refresh: refreshTaskStatus } = useTaskStatus()
const showTaskList = ref(false)
let statusTimer: number | undefined

function toggleTaskList(): void {
  showTaskList.value = !showTaskList.value
  // 任务列表打开时由 TaskList 自行拉取（useTaskStatus 防重），这里不需要额外请求
}

onMounted(() => {
  // 定时刷新任务进行中状态（未登录时内部自动跳过）
  refreshTaskStatus()
  statusTimer = window.setInterval(refreshTaskStatus, 10000)
})
onUnmounted(() => {
  if (statusTimer) window.clearInterval(statusTimer)
})

const navLinks = [
  { to: '/', label: '首页', icon: "icon-shouye" },
  { to: '/create', label: '文章创作', icon: "icon-wodechuangzuo" },
  { to: '/videos', label: '漫剧视频', icon: "icon-manjuguanli" }
]
</script>

<template>
  <nav class="sticky top-0 z-50">
    <div class="navbar bg-base-100 shadow-sm">
      <a class="btn btn-ghost text-xl">萌狐MFox AI</a>

      <div class="flex-none">

        <div class="megamenu p-2">
          <span class="megamenu-active"></span>
          <button class="after:content-none" :popovertarget="`e${link.to}`" v-for="link in navLinks" :key="link.to">
            <RouterLink :to="link.to" class="hover:text-primary transition-colors"
              :class="{ 'text-primary font-semibold': route.path === link.to }">
              <i :class="`iconfont ${link.icon}`"></i>
              {{ link.label }}
            </RouterLink>
          </button>
        </div>

        <!-- <ul class="menu menu-horizontal px-1">
          <li v-for="link in navLinks" :key="link.to">
            <RouterLink :to="link.to" class="hover:text-primary transition-colors"
              :class="{ 'text-primary font-semibold': route.path === link.to }">
              <i :class="`iconfont ${link.icon}`"></i>
              {{ link.label }}
            </RouterLink>
          </li>
          <li>
          <details>
            <summary>Parent</summary>
            <ul class="bg-base-100 rounded-t-none p-2">
              <li><a>Link 1</a></li>
              <li><a>Link 2</a></li>
            </ul>
          </details>
        </li>
        </ul> -->
      </div>

      <!-- Right: user menu -->
      <div class="navbar-end flex flex-1 items-center gap-3 md:gap-4 shrink-0">
        <!-- 任务列表入口：有进行中任务时显示指示灯 -->
        <button class="btn btn-ghost btn-sm btn-circle relative" title="任务列表" @click="toggleTaskList">
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span v-if="runningCount > 0"
            class="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-success rounded-full border-2 border-base-100 animate-pulse"
            title="有任务进行中"></span>
        </button>

        <button class="btn btn-ghost btn-sm btn-circle relative">
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span class="absolute top-1.5 right-1.5 w-2 h-2 bg-error rounded-full border-2 border-base-100"></span>
        </button>

        <!-- 积分 + 用户菜单 -->
        <PointsBadge />
        <!-- 用户菜单入口 -->
        <UserMenu />
      </div>
    </div>
  </nav>

  <!-- 任务列表面板 -->
  <TaskList :visible="showTaskList" @close="showTaskList = false" />
</template>

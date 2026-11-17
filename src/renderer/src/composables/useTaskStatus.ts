import { ref } from 'vue'
import { listTasks, type TaskItem } from '@/api/task'
import { SKIP_AUTH_MODE, getAuthToken } from '@/composables/useAuth'

/**
 * 全局任务状态（模块级单例，唯一的数据源）
 * - tasks：任务列表缓存
 * - runningCount：进行中任务数（NavBar 指示灯）
 * - refreshTasks()：拉取列表并更新缓存，带“进行中请求防重”——并发调用合并为 1 次请求
 * 注意：useTaskRecovery 需要精确判断任务是否 running，不使用这里的缓存，而是直接 listTasks()
 */
const tasks = ref<TaskItem[]>([])
const runningCount = ref(0)

/** 进行中的请求（防重：多个调用方并发时只发 1 个 HTTP 请求） */
let inflight: Promise<TaskItem[]> | null = null

function isLoggedIn(): boolean {
  return SKIP_AUTH_MODE || Boolean(getAuthToken())
}

/** 拉取任务列表并更新缓存（并发去重，未登录时返回空列表不请求） */
export async function refreshTasks(): Promise<TaskItem[]> {
  if (!isLoggedIn()) {
    tasks.value = []
    runningCount.value = 0
    return []
  }
  if (!inflight) {
    inflight = listTasks()
      .then((data) => {
        tasks.value = data
        runningCount.value = data.filter((t) => t.status === 'running').length
        return data
      })
      .catch(() => {
        // 网络错误/服务器故障：保留上次缓存，不打扰用户
        return tasks.value
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** 刷新并返回进行中任务数（NavBar 指示灯轮询用） */
export async function refreshTaskStatus(): Promise<number> {
  await refreshTasks()
  return runningCount.value
}

// 任务状态管理
export function useTaskStatus() {
  return { tasks, runningCount, refreshTasks, refresh: refreshTaskStatus }
}

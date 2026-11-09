<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { authApi } from '@/api/auth'
import PointsBadge from '@/components/PointsBadge.vue'
import AppModal from '@/components/AppModal.vue'

const router = useRouter()
const { user, updateUser, refreshUser } = useAuth()

onMounted(() => {
  refreshUser()
})

const activeTab = ref<'profile' | 'delete'>('profile')

const profileForm = reactive({
  nickname: user.value?.nickname ?? '',
  penName: user.value?.penName ?? '',
  gender: user.value?.gender ?? 'secret',
  bio: user.value?.bio ?? '',
  email: user.value?.email ?? ''
})

const saving = ref(false)
const uploading = ref(false)

// --- 头像上传 ---
const fileInput = ref<HTMLInputElement | null>(null)
function triggerAvatarUpload(): void {
  fileInput.value?.click()
}
async function handleAvatarChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !user.value?.id) return

  // 限制大小 5MB
  if (file.size > 5 * 1024 * 1024) {
    showToast('头像图片不能超过 5MB', false)
    return
  }

  uploading.value = true
  try {
    const { url } = await authApi.uploadAvatar(user.value.id, file)
    // 静态更新头像信息
    updateUser({ avatar: url })
    showToast('头像上传成功')
  } catch {
    showToast('头像上传失败', false)
  }
  uploading.value = false
  // 重置 input 以便重复选择同一文件
  input.value = ''
}

const deleteChecked = ref(false)
const showDeleteModal = ref(false)
const confirmText = ref('')
const deleteStep = ref(1)

const toast = ref({ show: false, message: '', type: 'alert-success' as string })
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, ok = true): void {
  toast.value = { show: true, message: msg, type: ok ? 'alert-success' : 'alert-error' }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value.show = false }, 3000)
}

async function saveProfile(): Promise<void> {
  if (!profileForm.nickname.trim()) return showToast('昵称不能为空', false)
  saving.value = true
  try {
    await authApi.update({ ...profileForm })
    updateUser({ ...profileForm })
    showToast('保存成功')
  } catch { showToast('保存失败', false) }
  saving.value = false
}

function submitDelete(): void {
  showDeleteModal.value = false
  deleteStep.value = 2
}
</script>

<template>
  <div class="min-h-screen bg-base-200/30">
    <header class="h-14 border-b border-base-200 bg-base-100 flex items-center px-4">
      <button class="btn btn-ghost btn-xs btn-square shrink-0 mr-3" @click="router.back()" title="返回上一页">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      </button>
      <span class="text-lg font-bold">个人中心</span>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-8 flex flex-col md:flex-row gap-6">
      <!-- Sidebar -->
      <aside class="w-full md:w-64 shrink-0">
        <div class="card bg-base-100 border border-base-200">
          <div class="card-body p-5 items-center text-center">
            <!-- 隐藏文件选择 -->
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="handleAvatarChange"
            />

            <!-- 头像：有图片用 avatar，无图片用 avatar placeholder -->
            <div
              class="mb-4 cursor-pointer group relative inline-block"
              :class="{ 'pointer-events-none opacity-70': uploading }"
              @click="triggerAvatarUpload"
            >
              <div v-if="user?.avatar" class="avatar">
                <div class="w-20 rounded-full ring-4 ring-base-100 ring-offset-2 ring-offset-base-200">
                  <img :src="user.avatar" :alt="user.nickname" />
                </div>
              </div>
              <div v-else class="avatar placeholder">
                <div class="bg-primary/10 text-primary w-20 rounded-full ring-4 ring-base-100 ring-offset-2 ring-offset-base-200">
                  <span class="text-2xl font-bold">{{ (user?.nickname || '?').charAt(0) }}</span>
                </div>
              </div>
              <!-- 上传中 loading -->
              <div v-if="uploading" class="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
                <span class="loading loading-spinner loading-md text-white"></span>
              </div>
              <!-- hover 遮罩 -->
              <div v-else class="absolute inset-0 flex items-center justify-center rounded-full bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                <span class="text-white text-xs font-medium">更换</span>
              </div>
            </div>
            <h2 class="text-lg font-semibold">{{ user?.nickname }}</h2>
            <p class="text-sm text-base-content/50">笔名：{{ user?.penName }}</p>
            <p class="text-xs text-base-content/30 mt-1">注册于 {{ user?.createdAt }}</p>
            <div class="mt-2"><PointsBadge /></div>
          </div>
        </div>
        <div class="mt-4 flex flex-col gap-1">
          <button class="flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors"
            :class="activeTab === 'profile' ? 'bg-primary/10 text-primary font-semibold' : 'text-base-content/60 hover:bg-base-200'"
            @click="activeTab = 'profile'"><span>👤</span> 个人资料</button>
          <button class="flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors text-error"
            :class="activeTab === 'delete' ? 'bg-error/10 font-semibold' : 'hover:bg-error/10'"
            @click="activeTab = 'delete'"><span>⚠️</span> 注销账号</button>
        </div>
      </aside>

      <!-- Content -->
      <section class="flex-1">
        <div class="card bg-base-100 border border-base-200 min-h-[500px]">
          <div class="card-body p-6 md:p-8">

            <!-- 个人资料 -->
            <div v-if="activeTab === 'profile'" class="space-y-6 max-w-lg">
              <h3 class="text-xl font-bold flex items-center gap-2">个人资料</h3>
              <div class="form-control"><label class="label"><span class="label-text font-medium">昵称</span></label><input v-model="profileForm.nickname" class="input input-bordered w-full" placeholder="请输入昵称" /></div>
              <div class="form-control"><label class="label"><span class="label-text font-medium">笔名</span></label><input v-model="profileForm.penName" class="input input-bordered w-full" placeholder="请输入笔名（选填）" /></div>
              <div class="form-control">
                <label class="label"><span class="label-text font-medium">性别</span></label>
                <div class="flex gap-2">
                  <button v-for="g in ([{k:'male',l:'男'},{k:'female',l:'女'},{k:'secret',l:'保密'}] as const)" :key="g.k"
                    class="btn btn-sm" :class="profileForm.gender === g.k ? 'btn-primary' : 'btn-ghost'" @click="profileForm.gender = g.k">{{ g.l }}</button>
                </div>
              </div>
              <div class="form-control"><label class="label"><span class="label-text font-medium">个人简介</span></label><textarea v-model="profileForm.bio" class="textarea textarea-bordered w-full h-24" placeholder="介绍一下自己吧～"></textarea></div>
              <div class="form-control"><label class="label"><span class="label-text font-medium">邮箱</span></label><input v-model="profileForm.email" class="input input-bordered w-full" placeholder="请输入邮箱" /></div>
              <button class="btn btn-primary" :disabled="saving" @click="saveProfile"><span v-if="saving" class="loading loading-spinner loading-xs"></span>{{ saving ? '保存中' : '保存修改' }}</button>
            </div>

            <!-- 注销账号 -->
            <div v-if="activeTab === 'delete'" class="max-w-md mx-auto">
              <template v-if="deleteStep === 1">
                <div class="text-center space-y-4">
                  <div class="text-5xl mb-4">⚠️</div>
                  <h3 class="text-xl font-bold">注销账号</h3>
                  <div class="bg-error/5 p-5 rounded-xl border border-error/20 text-left text-sm space-y-2 text-base-content/70">
                    <p class="font-semibold">注销后，所有数据将被永久删除且不可恢复：</p>
                    <p>• 所有已创作的作品及章节内容</p>
                    <p>• 角色设定、世界观数据、写作素材</p>
                    <p>• 账号信息及个人资料</p>
                  </div>
                  <label class="flex items-center justify-center gap-2 cursor-pointer">
                    <input v-model="deleteChecked" type="checkbox" class="checkbox checkbox-error checkbox-xs" />
                    <span class="text-sm">我已阅读并了解以上注销后果</span>
                  </label>
                  <button class="btn btn-error" :disabled="!deleteChecked" @click="showDeleteModal = true">申请注销账号</button>
                </div>
                <AppModal :open="showDeleteModal" @close="showDeleteModal = false">
                  <div class="modal-box text-center">
                    <h4 class="text-lg font-bold mb-2">确定要注销账号吗？</h4>
                    <p class="text-sm text-base-content/50 mb-4">此操作不可恢复</p>
                    <p class="text-xs mb-2">请输入「<span class="text-error font-bold">确认注销</span>」</p>
                    <input v-model="confirmText" class="input input-bordered w-full text-center" placeholder="请输入内容" />
                    <div class="modal-action justify-center">
                      <button class="btn btn-ghost btn-sm" @click="showDeleteModal = false">我再想想</button>
                      <button class="btn btn-error btn-sm" :disabled="confirmText !== '确认注销'" @click="submitDelete">确定注销</button>
                    </div>
                  </div>
                </AppModal>
              </template>
              <div v-else class="text-center py-12 space-y-4">
                <div class="text-6xl">✅</div>
                <h3 class="text-xl font-bold">申请已提交</h3>
                <p class="text-sm text-base-content/50">账号注销申请将在 7 天后正式生效</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <div v-if="toast.show" class="toast toast-end z-[80]">
      <div class="alert text-sm" :class="toast.type">{{ toast.message }}</div>
    </div>
  </div>
</template>

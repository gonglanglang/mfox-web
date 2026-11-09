<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PersonaItem } from '@/api/personas'
import { personaImage } from '@/utils/personas'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{
  open: boolean
  characters: PersonaItem[]
  selectedIds: number[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:selectedIds': [value: number[]]
  'confirm': []
}>()

const picked = computed({
  get: () => props.selectedIds,
  set: (v) => emit('update:selectedIds', v),
})

const search = ref('')

/** 按名称搜索过滤 */
const filteredCharacters = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return props.characters
  return props.characters.filter(c => c.name.toLowerCase().includes(kw))
})

function toggle(id: number) {
  const ids = [...picked.value]
  const idx = ids.indexOf(id)
  if (idx >= 0) ids.splice(idx, 1)
  else ids.push(id)
  picked.value = ids
}

function close() {
  search.value = ''
  emit('update:open', false)
}
</script>

<template>
  <AppModal :open="open" @close="close">
      <div v-if="open" class="modal-box rounded-2xl p-5 flex flex-col" style="max-width: 80vw; width: 80vw; min-height: 50vh; max-height: 85vh">
        <h3 class="font-bold text-sm mb-1">绑定出镜角色</h3>
        <p class="text-[10px] text-base-content/40 mb-3">点击角色卡片勾选本分镜出镜的角色（可多选）</p>

        <!-- 搜索框 -->
        <label class="input input-bordered input-sm flex items-center gap-2 mb-3">
          <svg class="w-3.5 h-3.5 text-base-content/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input v-model="search" type="text" class="grow" placeholder="搜索角色名称..." />
        </label>

        <!-- 角色卡片网格 -->
        <div v-if="filteredCharacters.length" class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 flex-1 overflow-y-auto min-h-0 mb-4 auto-rows-max">
          <div
            v-for="c in filteredCharacters"
            :key="c.id"
            class="card bg-base-100 border-2 rounded-xl cursor-pointer transition-all hover:shadow-md overflow-hidden"
            :class="picked.includes(c.id) ? 'border-primary shadow-sm shadow-primary/20' : 'border-base-200'"
            @click="toggle(c.id)"
          >
            <!-- 图片区 -->
            <figure class="aspect-[3/4] flex items-center justify-center bg-base-200 relative">
              <img v-if="personaImage(c)" :src="personaImage(c)" alt="角色形象" class="w-full h-full object-contain" />
              <span v-else class="text-3xl text-base-content/20">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </span>
              <!-- 选中标记 -->
              <div v-if="picked.includes(c.id)" class="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <svg class="w-3 h-3 text-primary-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </figure>
            <!-- 名称 -->
            <div class="p-2 text-center">
              <span class="text-xs font-semibold truncate block">{{ c.name }}</span>
            </div>
          </div>
        </div>
        <p v-else class="text-xs text-base-content/30 italic mb-4">
          {{ search ? '没有匹配的角色' : '暂无角色，请先在「素材」中添加角色' }}
        </p>

        <!-- 底部按钮 -->
        <div class="flex gap-2 justify-end">
          <button class="btn btn-sm btn-primary rounded-xl" :disabled="!characters.length" @click="emit('confirm')">确认</button>
          <button class="btn btn-sm btn-ghost rounded-xl" @click="close">取消</button>
        </div>
      </div>
    </AppModal>
</template>

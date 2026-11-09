<script setup lang="ts">
import { ref, computed } from 'vue'

const search = ref('')
const category = ref('all')
const page = ref(1)

const allComics = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  title: `漫画作品 ${i + 1}`,
  author: `创作者 ${(i % 8) + 1}`,
  cover: ['🌸','⚔️','🐱','🔮','💕','🐉','😂','☕','🌟','🎭','🌙','🎪','🏫','🛡️','🎵','🍰','🌈','👻','🧙','🎀','💎','🌺','🍭','🪄'][i],
  chapters: Math.floor(Math.random() * 80) + 1,
  isHot: i < 4,
  isNew: i >= 8 && i < 14,
  category: ['恋爱','奇幻','搞笑','日常'][i % 4]
}))

const filtered = computed(() => {
  let list = allComics
  if (category.value !== 'all') list = list.filter(c => c.category === category.value)
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    list = list.filter(c => c.title.includes(q) || c.author.includes(q))
  }
  return list
})

const totalPages = computed(() => Math.ceil(filtered.value.length / 12))
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-3">
      <label class="input input-bordered input-sm flex-1 max-w-xs">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 opacity-50">
          <path fill-rule="evenodd" d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" clip-rule="evenodd" />
        </svg>
        <input v-model="search" type="text" class="grow" placeholder="搜索漫画或作者..." />
      </label>
      <div class="join">
        <button
          v-for="c in [{id:'all',label:'全部'},{id:'恋爱',label:'💕 恋爱'},{id:'奇幻',label:'🐉 奇幻'},{id:'搞笑',label:'😂 搞笑'},{id:'日常',label:'☕ 日常'}]"
          :key="c.id"
          class="join-item btn btn-sm"
          :class="category === c.id ? 'btn-active' : 'btn-ghost'"
          @click="category = c.id; page = 1"
        >{{ c.label }}</button>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <div v-for="c in filtered.slice((page-1)*12, page*12)" :key="c.id"
        class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
        <div class="card-body p-3 items-center text-center">
          <div class="w-full aspect-[3/4] bg-base-200 rounded-lg mb-2 flex items-center justify-center text-3xl relative overflow-hidden">
            {{ c.cover }}
            <span v-if="c.isHot" class="badge badge-error badge-xs absolute top-1 left-1">🔥</span>
            <span v-if="c.isNew" class="badge badge-info badge-xs absolute top-1 right-1">NEW</span>
          </div>
          <h3 class="text-sm font-semibold truncate w-full">{{ c.title }}</h3>
          <p class="text-xs text-base-content/50">{{ c.author }}</p>
          <p class="text-xs text-base-content/30">共 {{ c.chapters }} 话</p>
        </div>
      </div>
    </div>

    <div v-if="filtered.length === 0" class="text-center py-16 text-base-content/40">
      <div class="text-4xl mb-2">🔍</div><p>没有找到相关漫画</p>
    </div>

    <div v-if="totalPages > 1" class="flex justify-center">
      <div class="join">
        <button class="join-item btn btn-sm" :disabled="page <= 1" @click="page--">«</button>
        <button v-for="p in totalPages" :key="p" class="join-item btn btn-sm" :class="p === page ? 'btn-active' : ''" @click="page = p">{{ p }}</button>
        <button class="join-item btn btn-sm" :disabled="page >= totalPages" @click="page++">»</button>
      </div>
    </div>
  </div>
</template>

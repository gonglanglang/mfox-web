<script setup lang="ts">
import { ref } from 'vue'
const sort = ref<'hot'|'new'>('hot')
const items = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1, title: `作品 ${i + 1}`, artist: `画师 ${(i%6)+1}`,
  emoji: ['🌟','🌸','🌙','💫','🦋','🍀','🌈','🎭','💎','🌺','🍭','🎪','🪄','🎀','💖','🎵','🍰','👻','🧙','🏰','🦄','🎯','🌻','🍒'][i],
  likes: Math.floor(Math.random()*9900)+100, views: Math.floor(Math.random()*99000)+1000
}))
</script>

<template>
  <div class="space-y-6">
    <div class="tabs tabs-bordered">
      <a class="tab tab-sm" :class="{'tab-active':sort==='hot'}" @click="sort='hot'">🔥 热门</a>
      <a class="tab tab-sm" :class="{'tab-active':sort==='new'}" @click="sort='new'">🆕 最新</a>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      <div v-for="item in items" :key="item.id"
        class="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer group overflow-hidden">
        <div class="aspect-square bg-base-200 flex items-center justify-center text-4xl relative overflow-hidden group-hover:scale-105 transition-transform duration-300">{{ item.emoji }}</div>
        <div class="p-3">
          <h3 class="text-sm font-semibold truncate">{{ item.title }}</h3>
          <p class="text-xs text-base-content/50">{{ item.artist }}</p>
          <div class="flex gap-3 mt-1.5 text-xs text-base-content/40">
            <span>❤️ {{ item.likes }}</span><span>👁️ {{ item.views }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="text-center pt-4"><button class="btn btn-outline btn-wide">加载更多</button></div>
  </div>
</template>

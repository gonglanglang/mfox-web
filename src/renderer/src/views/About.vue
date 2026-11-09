<script setup lang="ts">
const tech = [
  { name: 'Vue 3', desc: '渐进式前端框架', icon: '💚' },
  { name: 'TypeScript', desc: '类型安全', icon: '📘' },
  { name: 'Electron', desc: '跨平台桌面应用', icon: '⚡' },
  { name: 'TailwindCSS', desc: '原子化 CSS', icon: '🎨' },
  { name: 'DaisyUI', desc: 'Tailwind 组件库', icon: '🌼' },
  { name: 'Axios', desc: 'HTTP 客户端', icon: '📡' }
]
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div class="text-center space-y-2">
      <div class="text-5xl mb-2">🎨</div>
      <h1 class="text-2xl font-extrabold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">AI Comic Web</h1>
      <p class="text-sm text-base-content/50">AI 驱动的二次元漫画阅读与创作平台</p>
      <span class="badge badge-primary">🧁 cupcake theme · v1.0.0</span>
    </div>
    <div class="card bg-base-100 border border-base-200 shadow-sm">
      <div class="card-body">
        <h2 class="card-title text-base">🛠️ 技术栈</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
          <div v-for="t in tech" :key="t.name" class="flex items-center gap-2 p-2 rounded-lg hover:bg-base-200 transition-colors">
            <span class="text-xl">{{ t.icon }}</span>
            <div><div class="text-sm font-semibold">{{ t.name }}</div><div class="text-xs text-base-content/50">{{ t.desc }}</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="text-center text-xs text-base-content/30 space-y-1 py-4">
      <p>Built with 💖 using Electron + Vue3 + DaisyUI</p>
      <p>© 2026 AI Comic Web</p>
    </div>
  </div>
</template>

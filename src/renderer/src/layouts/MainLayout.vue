<script setup lang="ts">
import { RouterView } from 'vue-router'
import NavBar from '@/components/NavBar.vue'
</script>

<template>
  <div class="flex items-center flex-col h-screen">
    <div class="w-full h-16.25 shrink-0">
      <NavBar />
    </div>

    <div class="w-full flex-1 min-h-0 overflow-y-auto">
      <main class="w-[90%] mx-auto px-4 md:px-6 py-8">
        <RouterView />
      </main>
    </div>
  </div>
</template>

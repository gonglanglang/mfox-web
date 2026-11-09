<script setup lang="ts">
import type { AssetCategory } from '@/types/assets'

defineProps<{
  categories: { key: AssetCategory; label: string; count: number }[]
  activeCategory: AssetCategory
  search: string
  selecting: boolean
  generating: boolean
  selectedCount: number
  currentCategoryLabel: string
}>()

const emit = defineEmits<{
  'update:activeCategory': [value: AssetCategory]
  'update:search': [value: string]
  selectAll: []
  cancelSelect: []
  create: []
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 justify-between">
    <div role="tablist" class="tabs tabs-box px-2">
      <button v-for="cat in categories" :key="cat.key" role="tab" class="tab tab-sm font-medium"
        :class="activeCategory === cat.key ? 'tab-active' : ''" @click="emit('update:activeCategory', cat.key)">
        {{ cat.label }}
        <span class="ml-1 text-[10px] opacity-60">{{ cat.count }}</span>
      </button>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <template v-if="selecting">
        <button class="btn btn-sm btn-ghost" :disabled="generating" @click="emit('selectAll')">全选</button>
        <button class="btn btn-sm btn-ghost" :disabled="generating" @click="emit('cancelSelect')">取消</button>
        <span class="badge badge-sm badge-primary badge-outline">已选 {{ selectedCount }}</span>
      </template>

      <label class="input input-sm w-72">
        <svg class="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <g stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </g>
        </svg>
        <input :value="search" type="search" class="grow text-sm" placeholder="查询角色 / 场景 / 道具"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)" />
        <button v-if="search" type="button" class="btn btn-ghost btn-xs btn-circle" title="清空搜索"
          @click="emit('update:search', '')">
          ×
        </button>
      </label>

      <button class="btn btn-sm btn-soft btn-primary" @click="emit('create')">
        添加{{ currentCategoryLabel }}
      </button>
    </div>
  </div>
</template>

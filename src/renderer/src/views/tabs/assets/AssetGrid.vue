<script setup lang="ts">
import { computed } from 'vue'
import ImageViewer from '@/components/ImageViewer.vue'
import VoicePicker from '@/components/VoicePicker.vue'
import type { PersonaItem } from '@/api/personas'
import type { VoiceItem } from '@/api/voices'
import type { AssetCategory } from '@/types/assets'
import { getAssetLabel, getSelectedAssetImage } from '@/utils'

const props = defineProps<{
  category: AssetCategory
  items: PersonaItem[]
  selectedIds: number[]
  selecting: boolean
  emptyText: string
  showEmpty: boolean
  voices: VoiceItem[]
  voiceOptions: string[]
  editingNameId: number | null
  editName: string
}>()

const emit = defineEmits<{
  toggleSelect: [id: number]
  edit: [asset: PersonaItem]
  delete: [asset: PersonaItem]
  startRename: [asset: PersonaItem]
  finishRename: [asset: PersonaItem]
  voiceChange: [asset: PersonaItem, voiceName: string]
  'update:editName': [value: string]
  cancelRename: []
}>()

const gridClass = computed(() => {
  if (props.category === 'persona') return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5'
  if (props.category === 'scene') return 'grid-cols-2 md:grid-cols-4'
  return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6'
})
const emptyIcon = computed(() => props.category === 'prop' ? 'icon-daoju' : props.category === 'scene' ? 'icon-changjing' : 'icon-touxiang')

function getVoiceName(voiceId: number | null): string {
  const voice = props.voices.find(v => v.id === voiceId)
  return voice?.voice_name || '未指定'
}

function viewerImages(asset: PersonaItem) {
  return (asset.images || [])
    .filter(image => image.url && image.job_status !== 'running')
    .map((image, index) => ({ src: image.url, title: `${asset.name} ${index + 1}` }))
}
</script>

<template>
  <div class="grid gap-4" :class="gridClass">
    <template v-if="category === 'persona'">
      <div v-for="asset in items" :key="asset.id"
        class="card relative bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden group h-full"
        :class="[
          selecting ? 'cursor-pointer' : '',
          selectedIds.includes(asset.id) ? 'ring-2 ring-primary border-primary' : '',
        ]" @click="emit('toggleSelect', asset.id)">
        <input v-if="selecting" type="checkbox"
          class="checkbox checkbox-primary checkbox-sm absolute left-2 top-[14px] z-20"
          :checked="selectedIds.includes(asset.id)" @click.stop="emit('toggleSelect', asset.id)" />

        <div class="flex items-center justify-between gap-1 px-3 pt-3 pb-1">
          <div class="min-w-0 ml-6">
            <input v-if="editingNameId === asset.id" :value="editName"
              class="input input-xs input-ghost w-full font-semibold text-sm"
              @input="emit('update:editName', ($event.target as HTMLInputElement).value)"
              @blur="emit('finishRename', asset)" @keydown.enter="emit('finishRename', asset)"
              @keydown.escape="emit('cancelRename')" />
            <span v-else class="text-sm font-semibold truncate block cursor-text" title="双击重命名"
              @dblclick="emit('startRename', asset)">{{ asset.name }}</span>
          </div>

          <div class="flex">
            <button class="btn btn-ghost btn-xs btn-square shrink-0" @click.stop="emit('edit', asset)"
              title="编辑">
              <span class="iconfont icon-bianji text-sm"></span>
            </button>

            <button class="btn btn-ghost btn-xs btn-square text-error shrink-0" @click.stop="emit('delete', asset)"
              title="删除">
              <span class="iconfont icon-shanchu text-xs"></span>
            </button>
          </div>
        </div>

        <figure
          class="aspect-[3/4] flex items-center justify-center mx-3 mt-1 rounded-xl overflow-hidden relative cursor-pointer group/img">
          <ImageViewer
            v-if="!selecting && getSelectedAssetImage(asset) && getSelectedAssetImage(asset)!.job_status !== 'running'"
            :src="getSelectedAssetImage(asset)!.url" :images="viewerImages(asset)" :title="asset.name"
            class="w-full h-full" @click.stop>
            <img :src="getSelectedAssetImage(asset)!.url"
              class="w-full h-full object-contain bg-base-200 group-hover/img:blur-sm transition-all" alt="角色形象" />
            <span
              class="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 group-hover/img:opacity-100 transition-opacity">
              <span class="iconfont icon-fangda" style="font-size: 28px;"></span>
            </span>
          </ImageViewer>
          <img v-else-if="getSelectedAssetImage(asset) && getSelectedAssetImage(asset)!.job_status !== 'running'"
            :src="getSelectedAssetImage(asset)!.url" class="w-full h-full object-contain bg-base-200" alt="角色形象" />
          <div v-else-if="getSelectedAssetImage(asset) && getSelectedAssetImage(asset)!.job_status === 'running'"
            class="flex flex-col items-center justify-center gap-2 text-base-content/40">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <span class="text-xs">生成中...</span>
          </div>
          <span v-else class="text-4xl text-base-content/20 group-hover/img:opacity-40 transition-opacity">
            <span class="iconfont icon-touxiang" style="font-size: 25px;"></span>
          </span>

        </figure>

        <div class="card-body w-full p-3 pt-2">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-base-content/40 shrink-0">配音</span>
            <VoicePicker :model-value="getVoiceName(asset.voice_id)" label="角色" :options="voiceOptions" :voices="voices"
              @update:model-value="(value: string) => emit('voiceChange', asset, value)" />
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div v-for="asset in items" :key="asset.id"
        class="card relative bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden group"
        :class="[
          selecting ? 'cursor-pointer' : '',
          selectedIds.includes(asset.id) ? 'ring-2 ring-primary border-primary' : '',
        ]" @click="emit('toggleSelect', asset.id)">
        <input v-if="selecting" type="checkbox" class="checkbox checkbox-primary checkbox-sm absolute left-2 top-2 z-20"
          :checked="selectedIds.includes(asset.id)" @click.stop="emit('toggleSelect', asset.id)" />

        <figure class="relative bg-base-200 overflow-hidden"
          :class="category === 'scene' ? 'aspect-[16/10]' : 'aspect-square'">
          <img v-if="getSelectedAssetImage(asset) && getSelectedAssetImage(asset)!.job_status !== 'running'"
            :src="getSelectedAssetImage(asset)!.url" class="absolute inset-0 w-full h-full"
            :class="category === 'scene' ? 'object-cover transition-transform duration-500 group-hover:scale-105' : 'object-contain p-2'"
            :alt="`${getAssetLabel(category)}图`" />
          <div v-else-if="getSelectedAssetImage(asset) && getSelectedAssetImage(asset)!.job_status === 'running'"
            class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-base-content/45">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <span class="text-xs">生成中...</span>
          </div>
          <div v-else class="absolute inset-0 flex items-center justify-center text-base-content/25">
            <span class="iconfont text-5xl" :class="emptyIcon"></span>
          </div>

          <div v-if="!selecting"
            class="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ImageViewer v-if="getSelectedAssetImage(asset)" :src="getSelectedAssetImage(asset)!.url"
              :images="viewerImages(asset)" :title="asset.name" class="btn btn-xs btn-square shrink-0"
              @click.stop>
              <span class="iconfont icon-fangda text-xs"></span>
            </ImageViewer>
            <button class="btn btn-xs btn-square shrink-0" @click.stop="emit('edit', asset)" title="编辑">
              <span class="iconfont icon-bianji text-xs"></span>
            </button>
            <button class="btn btn-xs btn-square shrink-0 text-error" @click.stop="emit('delete', asset)"
              title="删除">
              <span class="iconfont icon-shanchu text-xs"></span>
            </button>
          </div>
        </figure>

        <div class="card-body p-3 gap-1">
          <div v-if="category === 'scene'" class="flex items-start justify-between gap-2">
            <h3 class="card-title text-sm leading-tight line-clamp-1">{{ asset.name }}</h3>
            <span v-if="asset.detail?.interior !== undefined" class="badge badge-xs badge-ghost shrink-0">
              {{ asset.detail.interior ? '室内' : '室外' }}
            </span>
          </div>
          <h3 v-else class="card-title text-sm leading-tight line-clamp-1">{{ asset.name }}</h3>
          <div v-if="category === 'scene'" class="flex gap-1.5 text-[11px] text-base-content/45 min-h-4">
            <span v-if="asset.detail?.time" class="truncate">{{ asset.detail.time }}</span>
            <span v-if="asset.detail?.location" class="truncate">{{ asset.detail.location }}</span>
          </div>
          <p class="text-xs text-base-content/55 line-clamp-2 min-h-8">
            {{ asset.description || asset.detail?.description || '暂无描述' }}
          </p>
        </div>
      </div>
    </template>

    <div v-if="items.length === 0 && showEmpty" class="col-span-full py-16 text-center text-sm text-base-content/45">
      {{ emptyText }}
    </div>
  </div>
</template>

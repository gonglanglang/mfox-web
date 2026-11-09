<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { PersonaItem } from '@/api/personas'

const props = defineProps<{ assets: PersonaItem[]; ids: number[]; multiple?: boolean; disabled?: boolean; readonly?: boolean }>()
const emit = defineEmits<{ change: [ids: number[]] }>()
const selected = computed(() => props.ids.map(id => ({ id, asset: props.assets.find(asset => asset.id === id) })))
const trigger = ref<HTMLButtonElement>()
const popup = ref<HTMLElement>()
const opened = ref(false)
const keyword = ref('')
const position = ref({ left: '0px', top: '0px', width: '288px', maxHeight: '360px' })
const label = computed(() => props.multiple ? '道具' : '场景')
const options = computed(() => props.assets.filter(asset =>
  description(asset).toLowerCase().includes(keyword.value.trim().toLowerCase())))

// 原生 popover 进入顶层，避免被表格滚动容器裁切，并提供点击外部/Escape 关闭。
function openPicker() {
  if (props.readonly || props.disabled || !trigger.value || !popup.value) return
  if (opened.value) { closePicker(); return }
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.min(288, window.innerWidth - 16)
  const below = window.innerHeight - rect.bottom - 16
  const above = rect.top - 16
  const height = Math.min(360, Math.max(below, above))
  position.value = {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    top: `${below >= Math.min(360, above) ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
  }
  keyword.value = ''
  popup.value.showPopover()
}
function closePicker() { popup.value?.hidePopover() }
function onToggle(event: Event) { opened.value = (event as ToggleEvent).newState === 'open' }
function onScroll(event: Event) {
  if (event.target instanceof Node && popup.value?.contains(event.target)) return
  closePicker()
}
function choose(id: number) {
  if (props.readonly || props.disabled) return
  if (props.multiple) toggle(id)
  else { emit('change', [id]); closePicker() }
}
function clear() { if (props.readonly || props.disabled) return; emit('change', []); closePicker() }
onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', closePicker)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', closePicker)
})
function imageUrl(asset?: PersonaItem) {
  return asset?.images?.find(image => image.id === asset.cur_image_id && image.url &&
    (!image.job_status || image.job_status === 'ready'))?.url
}
function description(asset?: PersonaItem) {
  if (!asset) return props.readonly ? '关联素材已删除或不可用' : '素材已删除或不在当前可选范围，请重新绑定'
  const detail = asset.detail
  return [asset.name, detail?.interior === true ? '室内' : detail?.interior === false ? '室外' : '',
    detail?.time, detail?.location, asset.description, detail?.description, detail?.mood].filter(Boolean).join('\n')
}
function toggle(id: number) {
  if (props.readonly || props.disabled) return
  emit('change', props.ids.includes(id) ? props.ids.filter(value => value !== id) : [...props.ids, id])
}
</script>

<template>
  <div class="flex items-center gap-2 min-w-[140px]">
    <!-- 缩略图只展示当前选中版本，悬浮显示素材文字。 -->
    <div v-if="selected.length" class="flex flex-wrap gap-2 min-w-0">
      <div v-for="item in selected" :key="item.id" :title="description(item.asset)" tabindex="0"
        class="flex items-center gap-1 max-w-[180px]">
        <img v-if="imageUrl(item.asset)" :src="imageUrl(item.asset)" :alt="item.asset?.name"
          class="w-10 h-10 shrink-0 rounded object-cover border border-base-300" />
        <span v-else class="w-10 h-10 shrink-0 flex items-center justify-center bg-base-200 text-[10px]">未选图</span>
        <!-- <span class="text-xs break-words">{{ item.asset?.name || '素材失效' }}</span> -->
      </div>
    </div>
    <span v-if="readonly && !selected.length" class="text-xs text-base-content/40">暂无</span>
    <button v-if="!readonly" ref="trigger" type="button" class="btn btn-ghost btn-xs shrink-0 text-primary"
      :disabled="disabled" :aria-expanded="opened" :title="`绑定或修改${label}`" @click="openPicker">
      {{ selected.length ? '修改' : '未绑定' }}
    </button>
    <!-- 顶层浮动选择面板，不占据分镜行高度。 -->
    <div v-if="!readonly" ref="popup" popover="auto" :style="position" :aria-label="`选择${label}`"
      class="asset-picker bg-base-100 text-base-content border border-base-300 rounded-lg shadow-xl p-0"
      @toggle="onToggle">
      <div class="flex items-center justify-between px-3 py-2 border-b border-base-200">
        <span class="text-sm font-medium">选择{{ label }}</span>
        <button type="button" class="btn btn-ghost btn-xs btn-square" title="关闭" aria-label="关闭" @click="closePicker">×</button>
      </div>
      <div class="p-2">
        <input v-model="keyword" type="search" class="input input-bordered input-sm w-full"
          :placeholder="`搜索${label}`" :aria-label="`搜索${label}`" />
      </div>
      <div class="picker-options overflow-y-auto px-2 pb-2">
        <label v-for="asset in options" :key="asset.id" :title="description(asset)"
          class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-base-200"
          :class="ids.includes(asset.id) ? 'bg-base-200' : ''">
          <input :type="multiple ? 'checkbox' : 'radio'" :checked="ids.includes(asset.id)" :disabled="disabled"
            :class="multiple ? 'checkbox checkbox-xs' : 'radio radio-xs'" @change="choose(asset.id)" />
          <img v-if="imageUrl(asset)" :src="imageUrl(asset)" alt="" class="w-9 h-9 shrink-0 rounded object-cover" />
          <span v-else class="w-9 h-9 shrink-0 flex items-center justify-center bg-base-200 text-[10px]">未选图</span>
          <span class="text-xs break-words min-w-0">{{ asset.name }}</span>
        </label>
        <div v-if="!options.length" class="py-5 text-center text-xs opacity-50">{{ keyword ? '没有匹配素材' : '暂无可绑定素材' }}</div>
      </div>
      <div class="flex items-center justify-between px-3 py-2 border-t border-base-200">
        <button type="button" class="btn btn-ghost btn-xs" :disabled="disabled || !ids.length" @click="clear">解除绑定</button>
        <button type="button" class="btn btn-ghost btn-xs" @click="closePicker">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* popover 在浏览器顶层显示，固定定位使打开前后表格尺寸保持不变。 */
.asset-picker { position: fixed; inset: auto; margin: 0; box-sizing: border-box; }
.asset-picker:popover-open { display: flex; flex-direction: column; }
.picker-options { min-height: 0; flex: 1; }
</style>

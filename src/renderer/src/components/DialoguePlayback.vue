<script setup lang="ts">
import { computed, ref, onUnmounted, watch } from 'vue'
import type { Segment } from '@/utils/segments'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ segments: Segment[]; characters: { id: number; name: string }[] }>()
const emit = defineEmits<{ play: [] }>()
const { show } = useToast()
const active = ref(-1)
const progress = ref(0)
const loading = ref(false)
const names = computed(() => new Map(props.characters.map(role => [role.id, role.name])))
const lines = computed(() => props.segments.map(segment => ({ ...segment, chars: Array.from(segment.text) })))
let audio: HTMLAudioElement | null = null
let frame = 0
let sequence = 0

function stop() {
  sequence++
  cancelAnimationFrame(frame)
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    audio = null
  }
  active.value = -1
  progress.value = 0
  loading.value = false
}

// 当前 TTS 仅返回整段音频，按播放时间估算字进度；保留片段边界，不能合并有音频的旁白。
async function play(index: number) {
  const url = props.segments[index]?.audioUrl
  if (!url) return
  const wasActive = active.value === index
  stop()
  if (wasActive) return
  const currentSequence = sequence
  const source = new Audio(url)
  audio = source
  active.value = index
  loading.value = true
  const failed = () => {
    if (currentSequence !== sequence) return
    stop()
    show('语音播放失败，请检查音频是否可用', 'error')
  }
  source.onended = () => { if (currentSequence === sequence) stop() }
  source.onerror = failed
  try {
    emit('play')
    await source.play()
    if (currentSequence !== sequence) return
    loading.value = false
    const tick = () => {
      if (currentSequence !== sequence) return
      progress.value = Number.isFinite(source.duration) && source.duration > 0 ? source.currentTime / source.duration : 0
      frame = requestAnimationFrame(tick)
    }
    tick()
  } catch { failed() }
}

// 轮询更新音频或切换分镜时中止旧播放，避免文字和声音错位。
watch(() => JSON.stringify(props.segments.map(segment => [segment.text, segment.audioUrl])), stop)
onUnmounted(stop)
defineExpose({ stop })
</script>

<template>
  <div class="space-y-1 max-h-44 overflow-y-auto text-sm leading-relaxed" aria-label="分镜台词">
    <button v-for="(segment, index) in lines" :key="index" type="button"
      class="block w-full rounded px-2 py-1.5 text-left break-words transition-colors disabled:cursor-default"
      :class="active === index ? 'bg-white/10 text-white' : 'text-white/65 enabled:hover:bg-white/5'"
      :disabled="!segment.audioUrl" :aria-pressed="active === index"
      :title="segment.audioUrl ? '点击播放或停止；逐字高亮按音频时长估算' : '尚无语音'"
      @click="play(index)">
      <span v-if="loading && active === index" class="loading loading-spinner loading-xs mr-1"></span>
      <span class="mr-2 text-xs" :class="segment.type === 'dialogue' ? 'text-warning' : 'text-white/45'">
        {{ segment.speaker || (segment.type === 'narration' ? '旁白' : names.get(segment.role_id!) || '未关联角色') }}
      </span>
      <span v-for="(char, charIndex) in segment.chars" :key="charIndex"
        :class="active === index && charIndex < Math.floor(progress * segment.chars.length) ? 'text-warning' : ''">{{ char }}</span>
      <span v-if="segment.audioUrl" class="ml-2 text-xs text-white/40" aria-hidden="true">{{ active === index ? '■' : '▶' }}</span>
    </button>
  </div>
</template>

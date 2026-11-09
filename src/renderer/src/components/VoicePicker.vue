<script setup lang="ts">
import { ref } from 'vue'
import type { VoiceItem } from '@/api/voices'
import AppModal from '@/components/AppModal.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  options: string[]
  voices?: VoiceItem[]
  label?: string
}>(), {
  label: '音色',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const audioRef = ref<HTMLAudioElement | null>(null)

function select(v: string) {
  emit('update:modelValue', v)
  open.value = false
}

function playPreview(voiceName: string) {
  if (!props.voices) return
  const v = props.voices.find(v => v.voice_name === voiceName)
  if (!v?.example_url) return
  if (audioRef.value) { audioRef.value.pause(); audioRef.value = null }
  const audio = new Audio(v.example_url)
  audio.play()
  audioRef.value = audio
}
</script>

<template>
  <!-- 触发区：badge + 试听 -->
  <span class="flex items-center justify-between w-full">
    <button class="btn btn-dash btn-xs btn-primary w-[90%]" @click="open = true">
      <svg class="swap-on fill-current" xmlns="http://www.w3.org/2000/svg" width="23" height="23" viewBox="0 0 24 24">
        <path
          d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" />
      </svg>
      {{ modelValue }}
    </button>

    <button class="btn btn-square btn-ghost w-6 h-6" @click.stop="playPreview(modelValue)">
      <svg class="size-[1.2em]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <g stroke-linejoin="round" stroke-linecap="round" stroke-width="2" fill="none" stroke="currentColor">
          <path d="M6 3L20 12 6 21 6 3z"></path>
        </g>
      </svg>
    </button>
  </span>

  <!-- 弹窗 -->
  <AppModal :open="open" @close="open = false">
    <div v-if="open" class="modal-box max-w-sm w-full rounded-2xl p-0 overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-base-200">
        <h3 class="font-bold text-sm">选择{{ label }}音色</h3>
        <button class="btn btn-sm btn-ghost btn-circle" @click="open = false">✕</button>
      </div>

      <!-- 列表区 -->
      <ul class="list bg-base-100 rounded-box shadow-md max-h-72 overflow-y-auto">
        <li class="list-row cursor-pointer transition-colors" v-for="v in voices" :key="v.voice_name"
          :class="modelValue === v.voice_name ? 'bg-primary/10' : 'hover:bg-base-200'" @click="select(v.voice_name)">
          <div><img class="size-10 rounded-box" src="https://img.daisyui.com/images/profile/demo/3@94.webp" /></div>
          <div>
            <div>{{ v.voice_name }}</div>
            <div class="text-xs uppercase font-semibold opacity-60">{{ v?.tags?.join(', ') || '无' }}</div>
          </div>
          <button class="btn btn-square btn-ghost" @click.stop="playPreview(v.voice_name)">
            <svg class="size-[1.2em]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <g stroke-linejoin="round" stroke-linecap="round" stroke-width="2" fill="none" stroke="currentColor">
                <path d="M6 3L20 12 6 21 6 3z"></path>
              </g>
            </svg>
          </button>
        </li>

      </ul>
    </div>
  </AppModal>
</template>

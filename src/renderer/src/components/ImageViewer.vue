<script setup lang="ts">
import { computed } from 'vue'
import { api as viewerApi } from 'v-viewer'
import 'viewerjs/dist/viewer.css'

export interface ImageViewerItem {
  src: string
  title?: string
  alt?: string
}

const props = withDefaults(defineProps<{
  src: string
  images?: Array<string | ImageViewerItem>
  title?: string
  alt?: string
  disabled?: boolean
}>(), {
  images: () => [],
  title: '',
  alt: '',
  disabled: false,
})

const normalizedImages = computed<ImageViewerItem[]>(() => {
  const items = props.images.length ? props.images : [{ src: props.src, title: props.title, alt: props.alt }]
  return items.flatMap(item => {
    const normalized = typeof item === 'string' ? { src: item } : item
    return normalized.src ? [normalized] : []
  })
})

function open() {
  if (props.disabled || !props.src || !normalizedImages.value.length) return
  const initialViewIndex = Math.max(0, normalizedImages.value.findIndex(item => item.src === props.src))
  const hasMultipleImages = normalizedImages.value.length > 1

  viewerApi({
    images: normalizedImages.value.map(item => ({
      src: item.src,
      alt: item.title || item.alt || '',
      'data-source': item.src,
    })),
    options: {
      url: 'data-source',
      initialViewIndex,
      navbar: hasMultipleImages,
      loop: false,
      keyboard: true,
      movable: true,
      rotatable: true,
      scalable: true,
      zoomable: true,
      title: [1, image => image.alt || ''],
      toolbar: {
        zoomIn: true,
        zoomOut: true,
        oneToOne: true,
        reset: true,
        prev: hasMultipleImages,
        play: false,
        next: hasMultipleImages,
        rotateLeft: true,
        rotateRight: true,
        flipHorizontal: true,
        flipVertical: true,
      },
      zIndex: 10000,
    },
  })
}

defineExpose({ open })
</script>

<template>
  <button type="button" class="block cursor-zoom-in" :disabled="disabled || !src" :aria-label="`查看${title || alt || '图片'}`"
    @click="open">
    <slot />
  </button>
</template>

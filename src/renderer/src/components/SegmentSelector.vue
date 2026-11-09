<script setup lang="ts">
defineProps<{
  label: string
  options: readonly string[]
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="flex items-center gap-3 md:gap-4">
    <span class="text-sm font-semibold text-base-content/40 shrink-0">{{ label }}</span>
    <div class="flex bg-base-200 p-1 rounded-xl">
      <button
        v-for="o in options"
        :key="o"
        class="px-4 py-1 rounded-lg text-sm font-medium transition-all"
        :class="
          modelValue === o
            ? 'bg-primary text-primary-content shadow-sm'
            : 'text-base-content/60 hover:bg-base-100 hover:shadow-sm'
        "
        @click="emit('update:modelValue', o)"
      >
        {{ o }}
      </button>
    </div>
  </div>
</template>

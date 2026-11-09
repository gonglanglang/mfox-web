<script setup lang="ts">
import { RouterView } from 'vue-router'

/* 全局组件 */
import Toast from '@/components/Toast.vue' // 引入Toast组件

</script>

<template>
  <!-- 全局Toast组件 -->
  <Toast />
  <!-- 路由出口 -->
  <RouterView />
</template>

<style>
/* 图标字体 */
@import './assets/icon/iconfont.css';

.icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.15em;
  fill: currentColor;
  overflow: hidden;
}
</style>

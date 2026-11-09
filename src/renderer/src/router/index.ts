import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '@/layouts/MainLayout.vue'
import Home from '@/views/Home.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        {
          path: '',
          name: 'home',
          component: Home
        },
        {
          path: 'comics',
          name: 'comics',
          component: () => import('@/views/Comics.vue')
        },
        {
          path: 'create',
          name: 'create',
          component: () => import('@/views/Create.vue')
        },
        {
          path: 'videos',
          name: 'videos',
          component: () => import('@/views/Videos.vue')
        },
        {
          path: 'gallery',
          name: 'gallery',
          component: () => import('@/views/Gallery.vue')
        },
        {
          path: 'about',
          name: 'about',
          component: () => import('@/views/About.vue')
        }
      ]
    },
    {
      path: '/write',
      name: 'write',
      component: () => import('@/views/Write.vue')
    },
    {
      path: '/video-storyboard/:workId',
      redirect: '/video-storyboard/:workId/story',
      component: () => import('@/views/VideoStoryboard.vue'),
      children: [
        { path: 'story', name: 'vs-story', meta: { tab: 'story' }, children: [] },
        { path: 'assets', name: 'vs-assets', meta: { tab: 'assets' }, children: [] },
        { path: 'breakdown', name: 'vs-breakdown', meta: { tab: 'breakdown' }, children: [] },
        { path: 'storyboard', name: 'vs-storyboard', meta: { tab: 'storyboard' }, children: [] },
        { path: 'compose', name: 'vs-compose', meta: { tab: 'compose' }, children: [] },
      ]
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/Profile.vue')
    },
    {
      path: '/orders',
      name: 'orders',
      component: () => import('@/views/Orders.vue')
    }
  ]
})

export default router

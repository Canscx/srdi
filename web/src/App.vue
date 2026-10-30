<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { goto, useRoute } from '@/router'
import { useSession } from '@/composables/useSession'
import PortalShell from '@/components/shell/PortalShell.vue'
import AdminShell from '@/components/shell/AdminShell.vue'
import LoginView from '@/views/LoginView.vue'
import ProjectsView from '@/views/ProjectsView.vue'
import ReviewView from '@/views/ReviewView.vue'
import ScoringView from '@/views/ScoringView.vue'
import StatusView from '@/views/StatusView.vue'
import SubmissionsView from '@/views/admin/Submissions.vue'
import PortalHome from '@/views/portal/Home.vue'
import PortalAssessing from '@/views/portal/Assessing.vue'
import PortalResult from '@/views/portal/Result.vue'

const route = useRoute()
const { state, ensure, reset } = useSession()
const booting = ref(true)
const sessionReady = ref(false)

const isCustomer = computed(() => state.value.role === 'customer')
const authenticated = computed(() => state.value.authenticated)

const ADMIN_ROUTES = ['projects', 'review', 'score', 'status', 'admin-submissions']
const PORTAL_ROUTES = ['portal-home', 'portal-assessing', 'portal-result']

const portalView = computed(() => {
  if (route.value.name === 'portal-assessing') return PortalAssessing
  if (route.value.name === 'portal-result') return PortalResult
  return PortalHome
})

const adminView = computed(() => {
  if (route.value.name === 'admin-submissions') return SubmissionsView
  if (route.value.name === 'review') return ReviewView
  if (route.value.name === 'score') return ScoringView
  if (route.value.name === 'status') return StatusView
  return ProjectsView
})

const adminActive = computed(() => {
  if (route.value.name === 'admin-submissions') return 'admin'
  if (route.value.name === 'status') return 'status'
  return 'projects'
})

watch(
  [() => route.value.name, isCustomer, authenticated, sessionReady],
  () => {
    if (!sessionReady.value) return
    if (!authenticated.value) {
      if (route.value.name !== 'login') goto('/login')
      return
    }
    if (route.value.name === 'login') {
      goto(isCustomer.value ? '/' : '/projects')
      return
    }
    if (isCustomer.value && ADMIN_ROUTES.includes(route.value.name)) goto('/')
    if (!isCustomer.value && PORTAL_ROUTES.includes(route.value.name)) goto('/projects')
  },
  { immediate: true }
)

const onLoggedIn = async () => {
  await ensure(true)
  sessionReady.value = true
  booting.value = false
  goto(isCustomer.value ? '/' : '/projects')
}

const signOut = () => {
  reset()
  sessionReady.value = false
}

onMounted(async () => {
  await ensure(true)
  sessionReady.value = true
  booting.value = false
})
</script>

<template>
  <div v-if="booting" class="boot" />

  <LoginView v-else-if="!authenticated || route.name === 'login'" @done="onLoggedIn" />

  <PortalShell v-else-if="isCustomer">
    <component
      :is="portalView"
      :job-id="route.jobId ?? ''"
      :project-id="route.projectId ?? ''"
    />
  </PortalShell>

  <AdminShell v-else :active="adminActive" @sign-out="signOut">
    <component :is="adminView" />
  </AdminShell>
</template>

<style scoped>
.boot {
  min-height: 100vh;
}
</style>

<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>
<template>
  <div class="workspace-empty">
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M24 6 40 15v18L24 42 8 33V15L24 6Z M8 15l16 9 16-9 M24 24v18"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>
<style scoped>
.workspace-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  color: var(--color-text-muted);
  text-align: center;
}
svg {
  width: 48px;
  height: 48px;
  margin-bottom: var(--space-2);
  color: var(--color-text-disabled);
}
h3 {
  margin: 0;
  font-size: var(--typography-title-size);
  font-weight: var(--typography-title-weight);
  color: var(--color-text-primary);
}
p {
  max-width: 26ch;
  margin: 0;
  font-size: var(--typography-body-size);
  line-height: 1.65;
  text-wrap: pretty;
}
</style>

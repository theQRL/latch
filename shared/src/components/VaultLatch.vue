<script setup>
defineProps({ open: Boolean });
</script>
<template>
  <div class="vault-art" :class="{ 'vault-open': open }" aria-hidden="true">
    <div class="vault-frame">
      <div class="vault-plate">
        <div class="vault-hinge hinge-top"></div>
        <div class="vault-hinge hinge-bottom"></div>
        <div class="vault-bolt bolt-top"></div>
        <div class="vault-bolt bolt-bottom"></div>
        <div class="vault-wheel"><i></i><i></i><i></i><b></b></div>
        <div class="vault-indicator"></div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.vault-art {
  width: 192px;
  height: 192px;
  display: grid;
  place-items: center;
  margin: 0 auto 1.6rem;
  perspective: 600px;
}
.vault-frame {
  position: relative;
  width: 158px;
  height: 158px;
  padding: 10px;
  border: 1px solid #54708380;
  border-radius: 27px;
  background: linear-gradient(145deg, #243744, #0d1d28);
}
.vault-plate {
  position: relative;
  width: 100%;
  height: 100%;
  border: 1px solid #56718360;
  border-radius: 18px;
  background: linear-gradient(140deg, #1f3443, #102330);
  transform-origin: 5% 50%;
  transition: transform 0.65s cubic-bezier(0.2, 0.75, 0.2, 1);
}
.vault-hinge {
  position: absolute;
  left: -14px;
  width: 12px;
  height: 25px;
  background: #547083;
  border: 3px solid #2c4556;
  border-radius: 3px;
}
.hinge-top {
  top: 16px;
}
.hinge-bottom {
  bottom: 16px;
}
.vault-bolt {
  position: absolute;
  right: -15px;
  width: 23px;
  height: 10px;
  border: 1px solid #8c9ba6;
  background: linear-gradient(#8c9ba6, #3b5262);
  border-radius: 2px;
  transition: transform 0.3s;
}
.bolt-top {
  top: 25px;
}
.bolt-bottom {
  bottom: 25px;
}
.vault-wheel {
  position: absolute;
  inset: 32px;
  border: 4px solid #9aa8b0;
  border-radius: 50%;
  transition: transform 0.5s;
  background: #172c3b;
}
.vault-wheel i {
  position: absolute;
  left: calc(50% - 2px);
  top: 0;
  height: 50%;
  width: 4px;
  transform-origin: bottom;
  background: #9aa8b0;
}
.vault-wheel i:nth-child(2) {
  transform: rotate(120deg);
}
.vault-wheel i:nth-child(3) {
  transform: rotate(240deg);
}
.vault-wheel b {
  position: absolute;
  inset: 24px;
  border-radius: 50%;
  background: #ffa729;
}
.vault-indicator {
  position: absolute;
  bottom: 10px;
  left: calc(50% - 9px);
  width: 18px;
  height: 3px;
  background: #ffa729;
  border-radius: 4px;
}
.vault-open .vault-bolt {
  transform: translateX(-12px);
}
.vault-open .vault-wheel {
  transform: rotate(-70deg);
}
.vault-open .vault-indicator {
  background: #72d4a4;
}
.vault-open .vault-plate {
  transform: rotateY(-14deg);
}
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
</style>

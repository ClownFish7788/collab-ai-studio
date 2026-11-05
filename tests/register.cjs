require('../scripts/register-typescript.cjs');

global.requestAnimationFrame ??= callback => { const timer = setTimeout(() => callback(performance.now()), 16); timer.unref(); return timer; };
global.cancelAnimationFrame ??= timer => clearTimeout(timer);
if (global.BroadcastChannel) {
  const Channel = global.BroadcastChannel;
  global.BroadcastChannel = class extends Channel {
    constructor(...args) { super(...args); this.unref(); }
  };
}

// "Assets changed" notifications (PWM-F-031: refresh the chart when asset values
// or holdings change).
//
// Whatever changes an asset (the add / edit / delete forms, a manual revaluation)
// should call notifyAssetsChanged() after the server confirms the change. The
// dashboard listens and reloads its numbers. Other open tabs are told too, via
// BroadcastChannel, so a dashboard in another tab stays current.

const EVENT = 'pwm:assets-changed';
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pwm-assets') : null;

export function notifyAssetsChanged() {
  window.dispatchEvent(new Event(EVENT));
  channel?.postMessage(EVENT);
}

/** Call `callback` whenever assets change, in this tab or another. Returns an unsubscribe function. */
export function onAssetsChanged(callback) {
  const onMessage = (e) => e.data === EVENT && callback();
  window.addEventListener(EVENT, callback);
  channel?.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener(EVENT, callback);
    channel?.removeEventListener('message', onMessage);
  };
}

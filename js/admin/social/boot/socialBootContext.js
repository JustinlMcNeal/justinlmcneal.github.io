// Injected state, DOM helper, and tab lazy-load callbacks for boot/tab modules

let _state;
let _$;
let _tabHandlers;

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {(id: string) => HTMLElement|null} deps.$
 * @param {Record<string, () => void>} deps.tabHandlers
 */
export function initSocialBootContext(deps) {
  _state = deps.state;
  _$ = deps.$;
  _tabHandlers = deps.tabHandlers;
}

export function getSocialBootContext() {
  return {
    state: _state,
    $: _$,
    tabHandlers: _tabHandlers,
  };
}

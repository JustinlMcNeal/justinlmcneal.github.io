// Injected dependencies for templates feature modules

let _state;
let _els;

/**
 * @param {object} deps
 */
export function initTemplatesContext(deps) {
  _state = deps.state;
  _els = deps.els;
}

export function getTemplatesContext() {
  return {
    state: _state,
    els: _els,
  };
}

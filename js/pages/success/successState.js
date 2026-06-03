export const SUCCESS_QUERY_KEYS = Object.freeze({
  orderId: "oid",
  sessionId: "session_id",
});

export const successState = {
  initialized: false,
  params: {
    orderId: null,
    sessionId: null,
  },
  order: null,
  lineItems: [],
};

export function markPageInitialized() {
  if (successState.initialized) return false;
  successState.initialized = true;
  return true;
}

export function readSuccessParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  return {
    orderId: params.get(SUCCESS_QUERY_KEYS.orderId) || null,
    sessionId: params.get(SUCCESS_QUERY_KEYS.sessionId) || null,
  };
}

export function setSuccessParams(params) {
  successState.params = {
    orderId: params?.orderId || null,
    sessionId: params?.sessionId || null,
  };
}

export function setOrderData(order, lineItems = []) {
  successState.order = order || null;
  successState.lineItems = Array.isArray(lineItems) ? lineItems : [];
}

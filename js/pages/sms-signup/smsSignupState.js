export const smsSignupState = {
  initialized: false,
  submitting: false,
};

export function markPageInitialized() {
  if (smsSignupState.initialized) return false;
  smsSignupState.initialized = true;
  return true;
}

export function isSubmitting() {
  return smsSignupState.submitting;
}

export function setSubmitting(value) {
  smsSignupState.submitting = Boolean(value);
}

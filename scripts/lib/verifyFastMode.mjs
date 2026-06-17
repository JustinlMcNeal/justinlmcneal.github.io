/**
 * Composed verify scripts: set VERIFY_FAST=1 or VERIFY_SKIP_DEEP_REGRESSION=1
 * to skip expensive nested regression chains (full 059C freeze, etc.).
 */
export function isVerifyFastMode(env = process.env) {
  return env.VERIFY_FAST === "1" || env.VERIFY_SKIP_DEEP_REGRESSION === "1";
}

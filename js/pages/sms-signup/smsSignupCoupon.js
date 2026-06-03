export function getCouponDisplayState(data) {
  if (data?.already_redeemed) {
    return {
      couponCode: "—",
      expiryNote: "Welcome back! Your signup coupon was already used.",
    };
  }

  if (data?.already_subscribed) {
    return {
      couponCode: data.coupon_code,
      expiryNote: "You already have a coupon — use it before it expires!",
    };
  }

  return {
    couponCode: data?.coupon_code,
    expiryNote: null,
  };
}

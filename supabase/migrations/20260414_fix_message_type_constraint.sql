-- Fix sms_messages.message_type CHECK constraint
-- Original only allowed: coupon_delivery, reminder, campaign, transactional
-- New types needed for abandoned cart and welcome series flows
ALTER TABLE sms_messages DROP CONSTRAINT sms_messages_message_type_check;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_message_type_check
  CHECK (message_type IN (
    'coupon_delivery',
    'reminder',
    'campaign',
    'transactional',
    'abandoned_cart_reminder',
    'abandoned_cart_urgency',
    'abandoned_cart_discount',
    'welcome_discovery',
    'welcome_conversion'
  ));

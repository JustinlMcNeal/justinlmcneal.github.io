SELECT setting_key, setting_value
FROM social_settings
WHERE setting_key IN ('autopilot','autopilot_last_run','auto_queue_last_run','auto_queue')
ORDER BY 1;

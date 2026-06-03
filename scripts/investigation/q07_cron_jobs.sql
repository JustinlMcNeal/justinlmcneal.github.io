SELECT jobid, jobname, schedule, active, LEFT(command, 120) AS command_preview
FROM cron.job
WHERE jobname ILIKE '%autopilot%'
   OR jobname ILIKE '%process%scheduled%'
   OR jobname ILIKE '%instagram%insight%'
   OR jobname ILIKE '%refresh%token%'
ORDER BY jobname;

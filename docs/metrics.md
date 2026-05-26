# PromptOptimizer Metrics (MVP)

## Reporting rules
- Source of truth: `analytics_events` in Postgres.
- Reporting timezone: UTC.
- Event retention: 13 months.

## Chrome Web Store metrics (manual)
Track in the Chrome Web Store dashboard (no in-app implementation):
- Daily Installs
- Store Conversion Rate
- Average Rating

Recommended review cadence:
- Daily: installs, conversion
- Weekly: rating trend and reviews

## Custom product metrics (SQL source of truth)

### DAU
```sql
SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day,
       count(DISTINCT user_id) AS dau
FROM analytics_events
WHERE event_name = 'popup_opened'
GROUP BY 1
ORDER BY 1;
```

### Activation Rate
```sql
WITH installs AS (
  SELECT user_id, min(occurred_at) AS installed_at
  FROM analytics_events
  WHERE event_name = 'extension_installed'
  GROUP BY user_id
), activations AS (
  SELECT user_id, min(occurred_at) AS activated_at
  FROM analytics_events
  WHERE event_name = 'first_result_copied'
  GROUP BY user_id
)
SELECT
  date_trunc('day', i.installed_at AT TIME ZONE 'UTC') AS cohort_day,
  count(*) AS installs,
  count(*) FILTER (
    WHERE a.activated_at >= i.installed_at
      AND a.activated_at < i.installed_at + interval '24 hours'
  ) AS activated_24h,
  100.0 * count(*) FILTER (
    WHERE a.activated_at >= i.installed_at
      AND a.activated_at < i.installed_at + interval '24 hours'
  ) / nullif(count(*), 0) AS activation_rate
FROM installs i
LEFT JOIN activations a USING (user_id)
GROUP BY 1
ORDER BY 1;
```

### Retention D7
```sql
WITH installs AS (
  SELECT user_id, date_trunc('day', min(occurred_at) AT TIME ZONE 'UTC') AS install_day
  FROM analytics_events
  WHERE event_name = 'extension_installed'
  GROUP BY user_id
), active_days AS (
  SELECT DISTINCT user_id, date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS active_day
  FROM analytics_events
  WHERE event_name = 'popup_opened'
)
SELECT
  i.install_day AS cohort_day,
  count(*) AS installs,
  count(a.user_id) AS retained_d7,
  100.0 * count(a.user_id) / nullif(count(*), 0) AS retention_d7
FROM installs i
LEFT JOIN active_days a
  ON a.user_id = i.user_id
 AND a.active_day = i.install_day + interval '7 days'
GROUP BY 1
ORDER BY 1;
```

### Copy Rate
```sql
WITH displayed AS (
  SELECT DISTINCT properties->>'request_id' AS request_id
  FROM analytics_events
  WHERE event_name = 'result_displayed'
    AND properties ? 'request_id'
), used AS (
  SELECT DISTINCT properties->>'request_id' AS request_id
  FROM analytics_events
  WHERE event_name = 'result_copied'
    AND properties ? 'request_id'
    AND properties->>'copy_method' IN ('copy_button', 'insert_button', 'hotkey_auto_insert')
)
SELECT
  count(used.request_id) AS used_results,
  count(displayed.request_id) AS displayed_results,
  100.0 * count(used.request_id) / nullif(count(displayed.request_id), 0) AS copy_rate
FROM displayed
LEFT JOIN used USING (request_id);
```

### Error Rate
```sql
WITH prompts AS (
  SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, count(*) AS submitted
  FROM analytics_events
  WHERE event_name = 'prompt_submitted'
  GROUP BY 1
), errors AS (
  SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, count(*) AS api_errors
  FROM analytics_events
  WHERE event_name = 'api_error'
    AND properties->>'endpoint' = '/v1/improve'
  GROUP BY 1
)
SELECT
  p.day,
  p.submitted,
  coalesce(e.api_errors, 0) AS api_errors,
  100.0 * coalesce(e.api_errors, 0) / nullif(p.submitted, 0) AS error_rate
FROM prompts p
LEFT JOIN errors e USING (day)
ORDER BY p.day;
```

## Retention cleanup (13 months)
Backend includes a cleanup script:
```bash
cd backend
python -m app.scripts.cleanup_analytics_events
```

Recommended schedule:
- Run daily from cron/systemd timer/k8s cronjob.
- Monitor output `deleted_analytics_events=<n>`.

## Feature flags
- Extension: `VITE_ANALYTICS_ENABLED=true|false`
- Backend ingestion: `ANALYTICS_ENABLED=true|false`
- Backend retention window: `ANALYTICS_RETENTION_MONTHS=13`

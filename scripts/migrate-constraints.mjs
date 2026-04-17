import pg from 'pg'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const migrations = [
  { table: 'customers', old: 'customers_user_id_customer_id_key', cols: 'account_id, customer_id' },
  { table: 'subscriptions', old: 'subscriptions_user_id_subscription_id_key', cols: 'account_id, subscription_id' },
  { table: 'plans', old: 'plans_user_id_plan_id_key', cols: 'account_id, plan_id' },
  { table: 'feature_definitions', old: 'feature_definitions_user_id_feature_key_key', cols: 'account_id, feature_key' },
  { table: 'feature_pricing', old: 'feature_pricing_user_id_feature_key_key', cols: 'account_id, feature_key' },
  { table: 'integrations', old: 'integrations_user_id_provider_key', cols: 'account_id, provider' },
  { table: 'customer_health_snapshots', old: 'customer_health_snapshots_user_id_customer_id_snapshot_date_key', cols: 'account_id, customer_id, snapshot_date' },
  { table: 'cloud_integrations', old: 'cloud_integrations_user_id_provider_key', cols: 'account_id, provider' },
  { table: 'routing_configs', old: 'routing_configs_user_id_name_key', cols: 'account_id, name' },
  { table: 'inference_profiles', old: 'inference_profiles_user_id_profile_type_scope_key_key', cols: 'account_id, profile_type, scope_key' },
  { table: 'integration_requests', old: 'integration_requests_user_id_integration_name_key', cols: 'account_id, integration_name' },
  { table: 'proxy_cache', old: 'proxy_cache_user_id_cache_key_key', cols: 'account_id, cache_key' },
  { table: 'custom_cohorts', old: 'custom_cohorts_user_id_name_key', cols: 'account_id, name' },
  { table: 'user_data_status', old: 'user_data_status_user_id_key', cols: 'account_id' },
]

async function run() {
  for (const m of migrations) {
    try {
      await pool.query(`ALTER TABLE ${m.table} DROP CONSTRAINT IF EXISTS ${m.old}`)
      const newName = m.old.replace('user_id', 'account_id')
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${newName} ON ${m.table} (${m.cols})`)
      console.log(`${m.table}: (${m.cols})`)
    } catch (e) {
      console.error(`${m.table} FAILED:`, e.message)
    }
  }

  // Also fix observe_events idempotency constraint
  try {
    await pool.query(`ALTER TABLE observe_events DROP CONSTRAINT IF EXISTS observe_events_user_id_idempotency_key_key`)
    // Can't drop the partial unique index by constraint name — drop by index name
    await pool.query(`DROP INDEX IF EXISTS observe_events_user_id_idempotency_key_key`)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS observe_events_account_id_idempotency_key_key ON observe_events (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
    console.log('observe_events: (account_id, idempotency_key)')
  } catch (e) {
    console.error('observe_events idempotency FAILED:', e.message)
  }

  // Fix sdk_api_keys
  try {
    await pool.query(`DROP INDEX IF EXISTS sdk_api_keys_user_name_active`)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sdk_api_keys_account_name_active ON sdk_api_keys (account_id, name) WHERE revoked_at IS NULL`)
    console.log('sdk_api_keys: (account_id, name) WHERE revoked_at IS NULL')
  } catch (e) {
    console.error('sdk_api_keys FAILED:', e.message)
  }

  console.log('\nDone.')
  await pool.end()
}

run().catch(e => { console.error('FATAL:', e); process.exit(1) })

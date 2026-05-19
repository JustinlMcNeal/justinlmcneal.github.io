// Injected dependencies for platform OAuth / connect modules

let _supabaseFunctionsUrl;
let _supabaseAnonKey;
let _getSupabaseClient;

/**
 * @param {object} deps
 */
export function initPlatformsContext(deps) {
  _supabaseFunctionsUrl = deps.SUPABASE_FUNCTIONS_URL;
  _supabaseAnonKey = deps.SUPABASE_ANON_KEY;
  _getSupabaseClient = deps.getSupabaseClient;
}

export function getPlatformsContext() {
  return {
    SUPABASE_FUNCTIONS_URL: _supabaseFunctionsUrl,
    SUPABASE_ANON_KEY: _supabaseAnonKey,
    getSupabaseClient: _getSupabaseClient,
  };
}

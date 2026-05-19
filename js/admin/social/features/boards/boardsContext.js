// Injected dependencies for boards feature modules

let _state;
let _els;
let _getSupabaseClient;
let _supabaseFunctionsUrl;
let _supabaseAnonKey;

/**
 * @param {object} deps
 */
export function initBoardsContext(deps) {
  _state = deps.state;
  _els = deps.els;
  _getSupabaseClient = deps.getSupabaseClient;
  _supabaseFunctionsUrl = deps.SUPABASE_FUNCTIONS_URL;
  _supabaseAnonKey = deps.SUPABASE_ANON_KEY;
}

export function getBoardsContext() {
  return {
    state: _state,
    els: _els,
    getSupabaseClient: _getSupabaseClient,
    SUPABASE_FUNCTIONS_URL: _supabaseFunctionsUrl,
    SUPABASE_ANON_KEY: _supabaseAnonKey,
  };
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[FleetOps] Supabase env vars not set. Falling back to localStorage.\n' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable the database.'
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const isDbEnabled = () => Boolean(supabase);

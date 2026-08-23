import { createClient } from "@supabase/supabase-js";

// Данные вашего проекта Supabase
const SUPABASE_URL = "https://cmbcgebjssfzevxohrtl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g9MY0VJFrYsbrMy8SE0hMw_GV9EnHnf";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// sync-config.js — configuration du backend de synchro (Supabase).
// Tant que ces deux valeurs sont vides, la synchro est invisible dans l'app.
// La clé « anon public » de Supabase est CONÇUE pour être embarquée côté client :
// l'accès aux données est verrouillé côté serveur (voir supabase/schema.sql).
export const SYNC_URL = '';  // ex. 'https://abcdefgh.supabase.co'
export const SYNC_KEY = '';  // clé "anon public" du projet

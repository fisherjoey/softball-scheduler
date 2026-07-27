import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

// prepare: false is required for Supabase's transaction pooler.
const sql = postgres(url, { prepare: false })
export const db = drizzle(sql, { schema })

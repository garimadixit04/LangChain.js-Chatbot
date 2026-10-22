// Shared setup: reads .env and creates the OpenAI and Supabase clients once.
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'

const REQUIRED = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY']

// Names of required settings that are missing from .env (empty when all set)
export const missingEnv = REQUIRED.filter((name) => !process.env[name])

let clients = null

// Create the clients on first use, so the server can still start and
// show a helpful message when .env is not filled in yet.
export function getClients() {
  if (missingEnv.length) {
    throw new Error(`Missing settings in .env: ${missingEnv.join(', ')}. See README.md, step 3.`)
  }
  if (!clients) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
    const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' }) // 1536 numbers per text
    const llm = new ChatOpenAI({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0 })
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: supabase,
      tableName: 'documents',
      queryName: 'match_documents',
    })
    clients = { supabase, embeddings, llm, vectorStore }
  }
  return clients
}

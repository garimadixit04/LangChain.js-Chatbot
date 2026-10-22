// Run with: npm run ingest
// Reads every .txt and .md file in the docs folder, then:
//   1. normal RAG: splits it into chunks, embeds them, stores them in "documents"
//   2. Graph RAG: asks the model for facts (subject -> relation -> object), stores them in "relations"
// Running it again replaces the stored data for each file, so it is safe to repeat.
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'
import { getClients } from './config.js'

const DOCS_DIR = path.resolve('docs')

// The shape of the facts we want the model to return
const factsSchema = z.object({
  facts: z.array(
    z.object({
      subject: z.string().describe('A named thing: person, team, product, place, policy...'),
      relation: z.string().describe('A short verb phrase, e.g. "manages", "is built by"'),
      object: z.string().describe('Another named thing'),
    })
  ),
})

async function main() {
  const { supabase, embeddings, llm } = getClients()

  const files = (await fs.readdir(DOCS_DIR)).filter((f) => /\.(txt|md)$/i.test(f))
  if (!files.length) throw new Error('No .txt or .md files found in the docs folder.')

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 })
  const extractFacts = llm.withStructuredOutput(factsSchema)

  for (const file of files) {
    const text = await fs.readFile(path.join(DOCS_DIR, file), 'utf8')

    // Remove anything stored for this file earlier, so re-running doesn't duplicate it
    await supabase.from('documents').delete().eq('metadata->>source', file)
    await supabase.from('relations').delete().eq('source', file)

    // 1. Normal RAG: split, embed and store, remembering which file each chunk came from
    const chunks = await splitter.createDocuments([text], [{ source: file }])
    await SupabaseVectorStore.fromDocuments(chunks, embeddings, {
      client: supabase,
      tableName: 'documents',
      queryName: 'match_documents',
    })

    // 2. Graph RAG: pull facts out of each chunk and store them as rows
    const rows = []
    for (const chunk of chunks) {
      const { facts } = await extractFacts.invoke(
        `Extract the factual relationships between named things in this text. ` +
          `Use the exact names from the text. Skip vague or opinion statements.\n\nText:\n${chunk.pageContent}`
      )
      for (const f of facts) rows.push({ source: file, subject: f.subject, relation: f.relation, object: f.object })
    }
    if (rows.length) {
      const { error } = await supabase.from('relations').insert(rows)
      if (error) throw new Error(`Saving graph facts failed: ${error.message}`)
    }

    console.log(`${file}: ${chunks.length} chunks, ${rows.length} graph facts`)
  }
  console.log('Done. Start the chat with: npm start')
}

main().catch((err) => {
  console.error('Ingest failed:', err.message)
  process.exit(1)
})

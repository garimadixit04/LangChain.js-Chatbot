// Answers one question. The same steps as the course, plus an optional graph lookup:
//   1. rewrite the question as a standalone question (uses the chat history)
//   2. normal RAG: find the nearest chunks in Supabase
//   3. Graph RAG: find facts about the things the question mentions, and one step further
//   4. answer from the chunks + facts + original question + history
import { z } from 'zod'
import { PromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { getClients } from './config.js'

const standaloneTemplate = `Given some conversation history (if any) and a question, convert the question to a standalone question.
conversation history: {conv_history}
question: {question}
standalone question:`

const answerTemplate = `You are a helpful assistant that answers questions using only the information provided below.
Try to find the answer in the context and the graph facts. If the answer is not there, look in the conversation history.
If you still don't know, say "Sorry, I couldn't find that in the documents." Don't make up an answer.
Answer in a friendly, concise way.
context: {context}
graph facts: {facts}
conversation history: {conv_history}
question: {question}
answer:`

// "Human: ..." / "AI: ..." lines, as in the course
function formatConvHistory(messages) {
  return messages.map((m, i) => (i % 2 === 0 ? `Human: ${m}` : `AI: ${m}`)).join('\n')
}

// Join the retrieved chunks into one string, labelled with their file names
function combineDocuments(docs) {
  return docs.map((d) => `[${d.metadata.source}] ${d.pageContent}`).join('\n\n')
}

// Graph RAG lookup: name -> its facts -> facts about its neighbours (two hops)
async function findGraphFacts(question) {
  const { supabase, llm } = getClients()

  const { names } = await llm
    .withStructuredOutput(z.object({ names: z.array(z.string()) }))
    .invoke(`List the named things (people, teams, products, places, policies) mentioned in this question. ` +
      `Return an empty list if there are none.\n\nQuestion: ${question}`)

  const clean = (s) => s.replace(/[,()%*\\]/g, ' ').trim() // keep the filter syntax safe
  const lookup = async (terms) => {
    const filters = terms.map(clean).filter(Boolean).flatMap((t) => [`subject.ilike.%${t}%`, `object.ilike.%${t}%`])
    if (!filters.length) return []
    const { data, error } = await supabase.from('relations').select('source, subject, relation, object').or(filters.join(',')).limit(25)
    if (error) throw new Error(`Graph lookup failed: ${error.message}`)
    return data
  }

  const hop1 = await lookup(names)
  const neighbours = [...new Set(hop1.flatMap((f) => [f.subject, f.object]))].filter((n) => !names.includes(n))
  const hop2 = await lookup(neighbours.slice(0, 10))

  // Remove duplicates and keep the list short
  const seen = new Set()
  return [...hop1, ...hop2].filter((f) => {
    const key = `${f.subject}|${f.relation}|${f.object}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 30)
}

export async function ask({ question, history = [], useGraph = true }) {
  const { llm, vectorStore } = getClients()
  const conv_history = formatConvHistory(history)

  const standaloneChain = PromptTemplate.fromTemplate(standaloneTemplate).pipe(llm).pipe(new StringOutputParser())
  const answerChain = PromptTemplate.fromTemplate(answerTemplate).pipe(llm).pipe(new StringOutputParser())

  const standaloneQuestion = await standaloneChain.invoke({ question, conv_history })

  // Normal RAG and the graph lookup run at the same time
  const [docs, facts] = await Promise.all([
    vectorStore.asRetriever(4).invoke(standaloneQuestion),
    useGraph ? findGraphFacts(standaloneQuestion) : Promise.resolve([]),
  ])

  const answer = await answerChain.invoke({
    context: combineDocuments(docs) || 'none',
    facts: facts.map((f) => `${f.subject} -> ${f.relation} -> ${f.object} [${f.source}]`).join('\n') || 'none',
    conv_history: conv_history || 'none',
    question,
  })

  return {
    answer,
    standaloneQuestion,
    sources: [...new Set(docs.map((d) => d.metadata.source))],
    facts,
  }
}

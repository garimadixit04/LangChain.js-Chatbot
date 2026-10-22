// Run with: npm start, then open http://localhost:3000
// A tiny web server: it serves the chat page and answers questions.
// Keys stay here on the server; the browser never sees them.
import express from 'express'
import { ask } from './ask.js'
import { missingEnv } from './config.js'

const app = express()
app.use(express.json())
app.use(express.static('public'))

// Lets the page warn you if .env isn't set up yet
app.get('/api/health', (req, res) => {
  res.json({ ok: missingEnv.length === 0, missing: missingEnv })
})

app.post('/api/chat', async (req, res) => {
  const { question, history, useGraph } = req.body ?? {}
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Please type a question.' })
  }
  try {
    const result = await ask({
      question: question.trim(),
      history: Array.isArray(history) ? history.slice(-10) : [], // last 5 exchanges
      useGraph: useGraph !== false,
    })
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Chat is running at http://localhost:${port}`)
  if (missingEnv.length) console.log(`Warning: missing in .env: ${missingEnv.join(', ')} (see README.md)`)
})

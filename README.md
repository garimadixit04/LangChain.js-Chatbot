# Docs Chat: RAG + Graph RAG

A small chatbot that answers questions about **your own documents**. Drop `.txt` or `.md` files into the `docs` folder, load them once, then chat in your browser. Every answer shows which files it came from and which graph facts it used.

It is built the way Scrimba's *Learn LangChain.js* course teaches (text splitter, OpenAI embeddings, Supabase vector store, standalone question, conversation memory), plus **Graph RAG** and a small server that keeps your API keys safe.

## What you need

- **Node.js 20 or newer**: check with `node --version`.
- **An OpenAI API key** from https://platform.openai.com/api-keys. The sample documents cost well under 1 cent to load and query.
- **A free Supabase account** at https://supabase.com.

## Setup (about 10 minutes)

1. **Install the packages.** In this folder, run:

   ```bash
   npm install
   ```

2. **Create the database.** In Supabase, create a new project. Open **SQL Editor**, paste the whole of `supabase/setup.sql`, and click **Run**. You should see "Success. No rows returned".

3. **Add your keys.** Copy `.env.example` to a new file called `.env` and fill in:
   - `OPENAI_API_KEY`: your OpenAI key.
   - `SUPABASE_URL` and `SUPABASE_KEY`: from Supabase **Project Settings > API**. Use the **service_role** key: it stays on the server and is never sent to the browser.

4. **Load your documents.** Run:

   ```bash
   npm run ingest
   ```

   You should see a line per file, such as `team.md: 1 chunks, 7 graph facts`.

5. **Start the chat.** Run the command below, then open http://localhost:3000.

   ```bash
   npm start
   ```

## Try it

The `docs` folder has two small sample files about a made-up bike company. Ask:

- "How much does the City Glide cost?" Normal RAG answers this from one chunk.
- "Who manages the team that builds the Trail X?" The answer is spread across **two files**: `products.md` says the E-Bikes team builds it, and `team.md` says Marco Rossi manages that team. Graph RAG follows that link.
- Then ask "And when did he join?" Memory lets the bot work out who "he" is.

Untick **Use Graph RAG** and ask the same questions to compare the two approaches.

## Use your own documents

1. Delete the sample files in `docs` and add your own `.txt` or `.md` files.
2. Run `npm run ingest` again. It replaces the stored data for each file, so you can re-run it whenever a file changes.

To remove a file from the bot's knowledge completely, delete its rows in Supabase. In the SQL Editor, run `delete from documents where metadata->>'source' = 'file.md'; delete from relations where source = 'file.md';`.

## How it works

**Loading (`npm run ingest`, in `src/ingest.js`)**
1. Each file is split into chunks of about 500 characters, with 50 characters of overlap.
2. **Normal RAG:** each chunk is turned into an embedding (1,536 numbers capturing its meaning) and saved in the `documents` table with its file name.
3. **Graph RAG:** the model reads each chunk and extracts facts as *subject → relation → object*, such as *Marco Rossi → manages → E-Bikes team*. They are saved in the `relations` table.

**Answering a question (`src/ask.js`)**
1. The question is rewritten as a **standalone question** using the chat history, so "he" or "it" become real names.
2. **Normal RAG:** the 4 chunks closest in meaning are fetched from Supabase.
3. **Graph RAG:** the names in the question are looked up in `relations`, then one more step out to their neighbours. This is how it joins facts from different files.
4. The model answers from the chunks, the facts, the original question and the history. It is told to say it couldn't find the answer rather than make one up.

**Files**

| File | What it does |
|---|---|
| `supabase/setup.sql` | Creates the `documents` table, the `match_documents` search function and the `relations` table. |
| `src/config.js` | Reads `.env` and creates the OpenAI and Supabase clients. |
| `src/ingest.js` | Loads the `docs` folder into Supabase (chunks + graph facts). |
| `src/ask.js` | Answers one question with RAG and Graph RAG. |
| `src/server.js` | The web server: serves the page and the `/api/chat` endpoint. |
| `public/index.html` | The chat page. |

## Normal RAG vs Graph RAG, in one paragraph

Normal RAG finds text that is **similar in meaning** to the question, which works well when the answer sits in one place. Graph RAG also stores **how things are connected**, so it can answer questions that need facts from several places joined together ("the team that builds X" → "who manages that team"). The cost is an extra model call per chunk while loading, so loading is slower and slightly more expensive.

## Ideas to extend it

- Support PDFs with LangChain's `PDFLoader`.
- Save chat history in Supabase so it survives a page refresh.
- Stream answers word by word with `chain.stream()`.
- Store a "department" in each chunk's metadata and filter searches by it.

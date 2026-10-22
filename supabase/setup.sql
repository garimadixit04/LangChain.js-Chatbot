-- Run this once in your Supabase project: SQL Editor > New query > paste > Run.

-- 1. Turn on pgvector so Postgres can store and compare embeddings
create extension if not exists vector;

-- 2. Normal RAG: one row per text chunk
create table if not exists documents (
  id bigserial primary key,
  content text,               -- the chunk's text
  metadata jsonb,             -- e.g. { "source": "team.md" }
  embedding vector(1536)      -- matches OpenAI's text-embedding-3-small
);

-- 3. The search function LangChain's SupabaseVectorStore calls
create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default null,
  filter jsonb default '{}'
) returns table (id bigint, content text, metadata jsonb, similarity float)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select id, content, metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 4. Graph RAG: one row per fact, "subject -> relation -> object"
create table if not exists relations (
  id bigserial primary key,
  source text,                -- which file the fact came from
  subject text,               -- e.g. "Marco Rossi"
  relation text,              -- e.g. "manages"
  object text                 -- e.g. "E-Bikes team"
);

create index if not exists relations_subject_idx on relations (lower(subject));
create index if not exists relations_object_idx on relations (lower(object));

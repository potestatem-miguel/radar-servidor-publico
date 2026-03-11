# Radar Servidor App

API simples para o fluxo:

1. `n8n` dispara no cron.
2. `n8n` chama `POST /radar-servidor`.
3. A app consulta RSS e sitemap, filtra itens do dia anterior, chama a OpenAI e devolve JSON pronto.
4. `n8n` usa a resposta para enviar o e-mail.

## Endpoints

### `GET /health`
Retorna status da aplicacao.

### `POST /radar-servidor`
Requer header `Authorization: Bearer SEU_TOKEN`.

Body opcional:

```json
{
  "date": "2026-03-09",
  "sources": [
    "https://www.mg.gov.br/rss.xml",
    "https://www.gov.br/rss.xml"
  ]
}
```

- `date`: opcional, no formato `YYYY-MM-DD`
- `sources`: opcional, sobrescreve as fontes padrao

## Resposta esperada

```json
{
  "analysisWindow": "2026-03-09",
  "requestedAt": "2026-03-10T23:00:00.000Z",
  "totalCollected": 42,
  "totalRelevant": 3,
  "sources": [],
  "sourceErrors": [],
  "resumo_executivo": "...",
  "oportunidades_gerais": ["..."],
  "analysis": [
    {
      "titulo": "...",
      "url": "...",
      "fonte": "...",
      "data": "...",
      "tema": "...",
      "resumo": "...",
      "impacto_para_servidor": "...",
      "classificacao": "ajuda_o_servidor",
      "como_aproveitar_no_educamundo": "...",
      "acao_sugerida": "criar_artigo",
      "prioridade": "alta"
    }
  ]
}
```

## Rodando localmente

```bash
cp .env.example .env
npm install
npm start
```

## Variaveis de ambiente

Veja `.env.example`.

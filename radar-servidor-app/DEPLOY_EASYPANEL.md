# Deploy no EasyPanel

## 1. Subir o codigo no GitHub

Envie a pasta `radar-servidor-app` para um repositorio GitHub.

## 2. Criar a aplicacao no EasyPanel

1. Entre no EasyPanel.
2. Clique em `New Project` ou use um projeto existente.
3. Clique em `New Service`.
4. Escolha `App`.
5. Conecte o repositorio GitHub.
6. Selecione a pasta raiz da app: `radar-servidor-app`.

## 3. Configuracoes recomendadas

- Build pack: `Dockerfile` ou `Node`
- Porta: `3000`
- Dominio: algo como `radar-servidor.seudominio.com`

Se usar `Dockerfile`, o EasyPanel detecta automaticamente.

## 4. Variaveis de ambiente

Configure estas variaveis:

- `PORT=3000`
- `N8N_SHARED_TOKEN=um-token-forte`
- `OPENAI_API_KEY=sua-chave-openai`
- `OPENAI_MODEL=gpt-4o-mini`
- `TIMEZONE=America/Sao_Paulo`
- `DEFAULT_SOURCES=https://www.mg.gov.br/rss.xml,https://www.gov.br/rss.xml,https://www.congressoemfoco.com.br/rss,https://www.gov.br/servidor/sitemap.xml,https://www.gov.br/servidor/rss.xml`

## 5. Health check

Depois do deploy, teste:

```text
GET https://seu-dominio/health
```

Resposta esperada:

```json
{ "ok": true, "service": "radar-servidor-app" }
```

## 6. Teste manual do endpoint principal

```bash
curl -X POST https://seu-dominio/radar-servidor \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-03-09"}'
```

## 7. Integracao com n8n

No `n8n`, use um no `HTTP Request` apontando para:

- Metodo: `POST`
- URL: `https://seu-dominio/radar-servidor`
- Header `Authorization: Bearer SEU_TOKEN`
- Header `Content-Type: application/json`
- Body JSON opcional com a data

A resposta dessa app pode alimentar diretamente o no que monta o e-mail.

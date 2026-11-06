<p align="center">
  <img src="docs/public/logo.svg" alt="Logo do projeto" width="300">
</p>

# jwbot

Bot simples para receber notificações do Jellyfin e enviá-las para números do WhatsApp.

## O que ele faz

- recebe requisições HTTP do Jellyfin;
- valida um token secreto;
- envia mensagens para os destinatários configurados;
- ignora notificações duplicadas em um intervalo configurável;
- mostra um QR code para conectar a conta do WhatsApp.

## Requisitos

- Node.js 24+
- Chromium/Puppeteer compatível
- Jellyfin com o plugin `Webhook`

## Instalação

```bash
git clone https://github.com/wagchi22/jwbot.git
cd jwbot
npm install
```

## Configuração

1. Gere o arquivo `.env`:

```bash
node bin/jwbot.js init
# ou, após a instalação local do pacote:
jwbot init
```

2. Ajuste os valores em `.env`:

```env
PORT=3000
API_TOKEN=troque-por-um-token-secreto
WA_RECIPIENTS=15550100101,15550100102
WA_SELF_NUMBER=
WA_DEDUPE_WINDOW_SECONDS=300
```

- `API_TOKEN`: token usado para autenticar requisições.
- `WA_RECIPIENTS`: números no formato E.164 sem `+`.
- `WA_SELF_NUMBER`: use apenas quando um destinatário for o próprio número da conta conectada.
- `WA_DEDUPE_WINDOW_SECONDS`: tempo para ignorar eventos repetidos; use `0` para desativar.

## Execução

```bash
npm start
```

Depois, escaneie o QR code exibido no terminal com a conta do WhatsApp.
As mensagens do terminal incluem data/hora local e nível (`INFO` ou `ERRO`), com cores quando executadas em um terminal. Defina `NO_COLOR` para desativar as cores.

### Docker Compose

Gere e configure o arquivo `.env` conforme a seção anterior. Em seguida, construa e inicie o serviço:

```bash
docker compose pull jwbot
docker compose up -d jwbot
docker compose logs -f jwbot
```

O QR code de autenticação aparece nos logs. A sessão e o cache do WhatsApp são mantidos em volumes Docker mesmo após recriar o contêiner. Para parar o serviço sem remover esses dados, use `docker compose down`.

No Windows, o painel de logs do Docker Desktop pode não renderizar corretamente o QR code no terminal. Abra o Windows Terminal maximizado e gere/acompanhe o código por lá:

```powershell
docker restart jwbot
docker logs -f jwbot
```

Escaneie o QR code em **WhatsApp > Aparelhos conectados > Conectar aparelho**. Se o código expirar, aguarde o próximo ou reinicie o contêiner para gerar outro. Não compartilhe capturas dos logs enquanto um QR code estiver visível, pois ele pode ser usado para conectar à sessão do WhatsApp.

O Compose usa a imagem `ghcr.io/wagchi22/jwbot:latest`, publicada no GitHub Container Registry. Após a publicação inicial, deixe o pacote com visibilidade pública nas configurações do pacote no GitHub para permitir pulls sem autenticação. Commits na branch principal e tags `v*` publicam imagens automaticamente, depois da aprovação dos testes. Por padrão, a API fica disponível na porta definida por `PORT` no `.env` (3000, se não definida). O contêiner usa Chromium instalado na imagem; não é necessário instalar Node.js ou Chromium no host.

No Windows, também é possível usar:

```powershell
.\jwbot.bat
```

Ou iniciar direto:

```powershell
node .\src\index.js
```

A sessão do WhatsApp fica em `.wwebjs_auth/` e não deve ser compartilhada nem versionada.

O endpoint `GET /health` informa se a conexão com o WhatsApp já está pronta.

## Integração com o Jellyfin

Configure o webhook do Jellyfin para enviar requisições `POST` para:

```text
http://<host-da-api>:3000/api/notifications
```

Exemplo de payload com token e mensagem:

```json
{
  "apiToken": "<API_TOKEN>",
  "notificationType": "{{json_encode NotificationType}}",
  "itemId": "{{json_encode ItemId}}",
  "message": "Jellyfin: {{#if_equals ItemType 'Episode'}}*{{json_encode SeriesName}} - {{json_encode Name}}*{{else}}*{{json_encode Name}}{{#if_exist Year}} ({{json_encode Year}}){{/if_exist}}*{{/if_equals}} {{#if_equals NotificationType 'ItemRemoved'}}saiu do catálogo{{else}}entrou no catálogo{{/if_equals}}"
}
```

Assim, eventos `ItemRemoved` são enviados como `Jellyfin: *<título>* saiu do catálogo`; os demais eventos continuam usando `entrou no catálogo`.

Você também pode enviar um payload simples:

```json
{
  "message": "Teste de notificação do Jellyfin"
}
```

Para autenticar via cabeçalho, use `X-API-Key` com o mesmo valor de `API_TOKEN`.

Exemplo de teste:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/notifications `
  -Method Post `
  -Headers @{ "X-API-Key" = "<API_TOKEN>" } `
  -ContentType "application/json" `
  -Body '{"message":"Teste de notificação do Jellyfin"}'
```

## Observações importantes

- `localhost` só funciona quando o Jellyfin e a API estiverem na mesma máquina ou rede local.
- Se a API estiver exposta fora da rede local, proteja-a com autenticação e use HTTPS.
- A API responde com `503` enquanto o WhatsApp estiver desconectado ou reconectando, `400` para payload inválido e `502` se o envio falhar para algum destinatário.
- O campo `recipient` pode ser usado para enviar a mensagem apenas para um número específico já configurado.

## Testes

```bash
npm test
```

## Releases

Commits convencionais enviados para `main` geram uma release e uma tag no
GitHub. O plugin `@semantic-release/npm` atualiza `package.json` e
`package-lock.json` sem publicar o pacote; `@semantic-release/git` commita essas
versões na `main`.

O ruleset exige PR para alterações normais e permite bypass ao usuário
mantenedor autenticado pelo workflow de release.

Configure o secret `SEMANTIC_RELEASE_TOKEN` com um fine-grained personal access
token do mantenedor, limitado a este repositório e com permissão de leitura e
escrita em **Contents**. Esse token é usado apenas para enviar o commit de
versão; a publicação da release no GitHub usa `GITHUB_TOKEN`.

## Licença

Este projeto está sob a licença [MIT](./LICENSE).

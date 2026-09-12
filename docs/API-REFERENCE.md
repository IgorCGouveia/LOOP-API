# LOOP API — referência para quem for construir um cliente

Documento autocontido pra dar de contexto a uma sessão nova (outro projeto,
outra pasta) que vai construir um app consumindo esta API. Não presume
conhecimento de nenhuma conversa anterior — tudo que precisa saber pra
integrar está aqui.

## Contexto do app cliente (decisões já tomadas em 11/09/2026, revisado 12/09/2026)

- **Plataforma: mobile multiplataforma** — React Native ou Flutter, **ainda
  não escolhido entre os dois**. Isso é uma decisão em aberto pra quando
  começar o projeto novo: pedir 2-3 alternativas reais com trade-off antes
  de escolher, não ir direto pra "óbvia".
- **Um segundo cliente, `loop-web`, entrou no radar em 12/09/2026** — é
  pra ele que CORS e o refresh token em cookie (seções abaixo) existem.
  Se o próximo cliente construído for o mobile, **as duas seções não se
  aplicam ainda**: mobile não sofre CORS, e não tem refresh token — só o
  `accessToken` de 1h, igual antes. Ver `DECISIONS.md` (12/09) pro
  raciocínio completo dessa divisão de escopo.
- **Onde guardar o token no mobile**: usuário ainda vai aprender esse
  tópico — não assumir uma solução de cara. Conforme a stack escolhida,
  os candidatos de mercado são `expo-secure-store` (Expo/React Native) ou
  `flutter_secure_storage` (Flutter) — armazenamento criptografado do
  sistema operacional, não `AsyncStorage`/`SharedPreferences` puro (esses
  não são seguros pra token). Trazer essa dúvida de volta na sessão nova
  antes de implementar, pra explicar o porquê antes de escolher.
- **No `loop-web`, o refresh token vem sozinho num cookie `httpOnly`** —
  o navegador guarda e envia automaticamente, o cliente web nunca lê nem
  armazena esse valor. O `accessToken` (JWT de 1h) continua vindo no
  corpo da resposta, igual ao mobile — cabe ao `loop-web` decidir onde
  guardar só esse (memória da aplicação é a opção mais segura contra
  XSS; evitar `localStorage`).
- Telas previstas: cadastro/login, lista de hábitos, criar/editar hábito
  (com formulário pro `schedule`), check-in, exibição de streak/progresso
  do dia.
- Deploy do cliente é infra separada da API (loja de app / build interno,
  ou hosting estático pro `loop-web`), decisão de quando chegar lá.

## URLs

- **Produção**: `https://loop-api-wz74.onrender.com`
- **Local**: `http://localhost:3333` (ou a `PORT`/`HOST` que você setar)

⚠️ **Free tier do Render**: o serviço dorme depois de um tempo sem uso. A
primeira requisição depois disso leva **30-60s** pra responder (cold start).
Um cliente decente precisa de timeout generoso e alguma indicação visual de
"carregando" nessa primeira chamada — não é bug, é a infra grátis.

## CORS (configurado em 12/09/2026 — só relevante pro `loop-web`)

`@fastify/cors` está registrado em `src/app.ts`, com `credentials: true`
(necessário pro cookie de refresh — ver seção de autenticação abaixo) e
origem **explícita**, nunca `*` (a combinação `credentials: true` + `*` é
proibida pela própria spec de CORS e o navegador rejeita silenciosamente).

A origem vem da env var `CORS_ORIGIN` da API (lista separada por vírgula,
ex.: `CORS_ORIGIN=https://loop-web.exemplo.com`) — sem ela, a API cai num
default de desenvolvimento (`localhost:5173`/`localhost:3000`) e **não**
libera nenhum domínio de produção. Se o `loop-web` for hospedado em outro
domínio, isso precisa ser configurado no dashboard do Render da API antes
do deploy do `loop-web` — trabalho no repo da API, não no repo do
cliente.

Isso não afeta:
- App mobile nativo ou React Native/Flutter (CORS é regra de navegador, não existe em app mobile)
- `curl`, Postman, Insomnia (ferramentas de teste ignoram CORS)
- Chamada servidor-a-servidor (outro backend consumindo esta API)

**Ainda não validado com navegador real** — não há frontend neste
repositório pra testar contra. Validar assim que o `loop-web` tiver uma
primeira tela fazendo `fetch` com `credentials: "include"`.

## Autenticação

`accessToken` é sempre um JWT de 1h, igual pros dois clientes (mobile e
`loop-web`). Renovação (refresh) existe **só pro `loop-web`**, via cookie
`httpOnly` — o mobile ainda não tem refresh, ver "Contexto do app
cliente" no topo.

1. `POST /users` — cria a conta
2. `POST /login` — devolve `accessToken`. **No `loop-web`**, também seta
   um cookie `httpOnly` (`refreshToken`) — o navegador guarda e envia
   sozinho, o cliente nunca lê o valor.
3. Toda rota protegida: header `Authorization: Bearer <accessToken>`
4. **Quando o `accessToken` expira (1h):**
   - **Mobile**: não tem `/refresh` ainda — detectar `401` numa rota
     protegida e mandar de volta pro login.
   - **`loop-web`**: `POST /refresh` (sem corpo, sem header — o cookie já
     viaja sozinho por `credentials: "include"`) devolve um `accessToken`
     novo. **Sem rotação**: o mesmo cookie continua valendo até expirar
     (7 dias) ou até `POST /logout`.
5. `POST /logout` (só faz sentido com o cookie do `loop-web`) — revoga o
   refresh token no servidor e limpa o cookie.

Não existe verificação de email nem 2FA. `role` só tem dois valores:
`"USER"` e `"ADMIN"` (não existe endpoint público pra virar admin — é
manual no banco).

## Formato de resposta (uniforme em toda a API desde 12/09/2026)

**Sucesso**: sempre `{ "message": string, "data": T }` — `T` é o objeto,
array, ou `null` (`POST /logout`) específico do endpoint. Nunca vem cru
sem o envelope.

**Erro**: sempre tem um campo `error: string`. A validação de campo
(Zod) é a única exceção que carrega mais de um problema por vez — nesse
caso ganha um campo `details` a mais, sem deixar de ter `error`.

| Situação | Status | Corpo |
|---|---|---|
| Corpo inválido (Zod) | `400` | `{ "error": "Dados inválidos.", "details": [{ "campo": "email", "message": "Formato de email inválido." }, ...] }` |
| Sem token / token inválido / login errado | `401` | `{ "error": "..." }` |
| Autenticado mas sem permissão | `403` | `{ "error": "..." }` |
| Recurso não encontrado | `404` | `{ "error": "..." }` |
| Conflito (ex: email duplicado) | `409` | `{ "error": "Email já cadastrado." }` |
| Rate limit estourado (IP ou conta) | `429` | `{ "statusCode": 429, "error": "Too Many Requests", "reqId": "..." }` + header `Retry-After` |
| Erro não esperado / config ausente | `500` | `{ "statusCode": 500, "error": "Internal Server Error", "reqId": "..." }` — **nunca** vaza detalhe interno, use o `reqId` só se for debugar com quem tem acesso ao log do servidor |

Um handler de erro único (`if (!res.ok) throw new Error(body.error)`)
cobre a API inteira — não precisa mais inspecionar o tipo do corpo antes
de saber ler.

## Rate limiting (o que o cliente precisa saber)

- `POST /login`: **20 requisições/minuto por IP**, mais uma camada por
  conta — depois de 3 tentativas erradas seguidas pro mesmo email, a API
  **atrasa a resposta de propósito** (1s, depois 2s, depois trava em 5s),
  em vez de bloquear. Isso vale tanto pra tentativa errada quanto pra
  **login certo que vem logo depois de várias erradas** — o cliente vai
  ver a chamada demorar mais nesse caso, não é timeout, é intencional.
  Se 3 tentativas já estiverem "penduradas" pro mesmo email ao mesmo
  tempo, a 4ª leva `429` na hora.
- `POST /users`: **5 requisições/hora por IP**.
- Headers `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset`
  vêm em toda resposta de `/login` — dá pra usar pra avisar o usuário antes
  de ele bater no limite, se quiser.

## Modelo de dados (resumo)

- **User**: `id, email, name, role` (é tudo que qualquer resposta expõe —
  `password` e `timezone` nunca voltam no JSON, mesmo pro próprio dono).
- **Habit**: um hábito pertence a um usuário, tem `name`, `description`
  opcional, `longestStreak`, `longestStreakStartDate`, `graceTokens`
  (0-3), e um `schedule` (a agenda vigente).
- **Schedule** (dentro de `Habit.schedule`): `type` (`DAILY` | `WEEKLY` |
  `INTERVAL`), `targetPerDay`, e conforme o tipo: `daysOfWeek` (array de
  0-6, domingo=0) pra `WEEKLY`, ou `intervalDays` pra `INTERVAL`.
- **Check-in**: não é uma entidade que a API expõe como CRUD completo —
  é criado/desfeito por ação (`POST`/`DELETE /habits/:id/checkin`) e a
  listagem devolve só os eventos efetivos (um "desfazer" faz o check-in
  sumir da lista, mesmo persistindo internamente).

## Endpoints

Todos os corpos são JSON (`Content-Type: application/json`).

### `POST /users` — criar conta

Sem auth. Rate limit: 5/hora por IP.

```json
// request
{
  "name": "Ana Silva",
  "email": "ana@example.com",
  "password": "senha12345",
  "confirmPassword": "senha12345",
  "timezone": "America/Sao_Paulo"
}
```
- `name`: 3-50 chars
- `password`/`confirmPassword`: 8-128 chars, precisam ser iguais
- `timezone`: identificador IANA válido (`Intl.supportedValuesOf('timeZone')`) — `"America/Sao_Paulo"`, não `"Sao Paulo"` nem `"GMT-3"`

```json
// 201
{
  "message": "Usuário criado com sucesso.",
  "data": { "id": "x4g7...", "email": "ana@example.com", "name": "Ana Silva", "role": "USER" }
}
```

### `POST /login`

Sem auth. Rate limit: ver seção acima.

```json
// request
{ "email": "ana@example.com", "password": "senha12345" }
```
```json
// 200
{
  "message": "Login realizado com sucesso.",
  "data": {
    "accessToken": "eyJhbGci...",
    "expiresIn": "1 hora",
    "name": "Ana Silva",
    "id": "x4g7...",
    "role": "USER"
  }
}
```
No `loop-web`, essa resposta também vem com `Set-Cookie: refreshToken=...;
HttpOnly; Secure; SameSite=None` (o valor do cookie nunca aparece no
corpo JSON). Credencial errada (email não existe **ou** senha errada —
API responde igual nos dois casos de propósito, não dá pra saber qual):
`401` `{ "error": "Email ou senha incorretos." }`

### `POST /refresh` — só `loop-web`

Sem auth via header — depende só do cookie `refreshToken` (enviado
automaticamente pelo navegador com `credentials: "include"`).

```json
// 200 — mesmo shape de dado do POST /login, sem o campo accessToken antigo
{
  "message": "Token renovado com sucesso.",
  "data": { "accessToken": "eyJhbGci...", "expiresIn": "1 hora", "name": "Ana Silva", "id": "x4g7...", "role": "USER" }
}
```
Sem cookie, cookie inválido/expirado ou já revogado (logout): `401`
`{ "error": "Refresh token não informado." }` ou
`{ "error": "Refresh token inválido ou expirado." }`.

### `POST /logout` — só `loop-web`

```json
// 200
{ "message": "Logout realizado com sucesso.", "data": null }
```
Idempotente — chamar sem cookie nenhum também devolve `200`, não erro.

### `GET /users` — admin

Lista todos os usuários.

### `PATCH /users/:id` — dono

Qualquer subconjunto dos campos de criação (parcial). Se vier `password`,
`confirmPassword` também precisa vir e bater.

```json
// 200 — mesmo shape do POST /users
```

### `DELETE /users/:id` — dono ou admin (admin não deleta outro admin)

```json
// 200
{ "message": "Usuário deletado com sucesso.", "data": { "id": "...", "email": "...", "name": "...", "role": "..." } }
```

### `POST /habits` — usuário autenticado

```json
// request — schedule é opcional (default: DAILY, meta 1)
{
  "name": "Beber água",
  "description": "2L por dia",
  "schedule": { "type": "DAILY", "targetPerDay": 1 }
}
```

```json
// schedule WEEKLY
{ "type": "WEEKLY", "targetPerDay": 1, "daysOfWeek": [1, 3, 5] }

// schedule INTERVAL (a cada N dias)
{ "type": "INTERVAL", "targetPerDay": 1, "intervalDays": 3 }
```

```json
// 201
{
  "message": "Hábito criado com sucesso.",
  "data": {
    "id": "a779...",
    "name": "Beber água",
    "description": "2L por dia",
    "createdAt": "2026-09-11T03:43:15.051Z",
    "updatedAt": "2026-09-11T03:43:15.051Z",
    "userId": "x4g7...",
    "longestStreak": 0,
    "longestStreakStartDate": null,
    "graceTokens": 1,
    "graceTokensUpdatedAt": "2026-09-11T03:43:15.051Z",
    "schedule": {
      "id": "ekl3...",
      "habitId": "a779...",
      "effectiveFrom": "2026-09-11T00:00:00.000Z",
      "effectiveFromAt": "2026-09-11T03:43:15.183Z",
      "effectiveTo": null,
      "effectiveToAt": null,
      "targetPerDay": 1,
      "type": "DAILY",
      "daysOfWeek": [],
      "intervalDays": null
    }
  }
}
```

### `GET /me/habits` — usuário autenticado

`{ "message": "Hábitos encontrados.", "data": [ /* array, mesmo shape do hábito acima */ ] }`

### `GET /users/:userId/habits` — dono ou admin

### `GET /habits` — admin (todos os hábitos)

### `PATCH /habits/:id` — dono

`name`/`description` podem vir sozinhos (parcial). **`schedule`, se vier,
tem que ser o objeto inteiro** da união discriminada — não dá pra mandar só
`targetPerDay` de uma agenda `WEEKLY` sem `daysOfWeek` junto.

```json
// 200
{ "message": "Hábito atualizado com sucesso.", "data": { /* habit atualizado */ } }
```

### `DELETE /habits/:id` — dono

```json
// 200
{ "message": "Hábito apagado com sucesso.", "data": { /* habit deletado */ } }
```

### `POST /habits/:habitId/checkin` — dono

Registra o check-in de hoje (o "hoje" é calculado no timezone do dono do
hábito, não no timezone de quem chama).

```json
// 201
{
  "message": "Check-in registrado com sucesso.",
  "data": {
    "checkin": { "id": "...", "habitId": "...", "date": "2026-09-11T00:00:00.000Z", "kind": "CHECKIN", "checkedAt": "..." },
    "currentStreak": 3,
    "longestStreak": 5,
    "graceTokens": 1,
    "todayProgress": { "count": 1, "target": 1 }
  }
}
```
`todayProgress` é útil pra hábito com `targetPerDay > 1` (ex: "beber água
4x hoje", mostra `1/4`, `2/4`...).

### `DELETE /habits/:habitId/checkin` — dono

Desfaz o check-in mais recente ainda não desfeito.

```json
// 200
{ "message": "Check-in desfeito com sucesso.", "data": { /* recalculo do streak */ } }
```
`400` (`{ "error": "Nenhum check-in para desfazer." }`) se não houver
check-in pra desfazer.

### `GET /habits/:habitId/checkins` — dono

`{ "message": "Check-ins encontrados.", "data": [ /* array, mais recente primeiro, só efetivos */ ] }`

### `GET /users/:userId/checkins` — dono ou admin

Mesma coisa, de todos os hábitos do usuário.

## Coisas que o app cliente precisa decidir sozinho (não vêm da API)

- **Onde guardar o `accessToken`**: a API não seta cookie, só devolve o
  JWT no corpo — fica a cargo do cliente. Ver nota em "Contexto do app
  cliente" no topo deste documento — é um tópico que ainda precisa ser
  estudado antes de decidir, não assumir a primeira opção que aparecer.
- **O que fazer quando o token expira** (1h): no mobile, ainda não existe
  refresh — detectar `401` numa rota protegida e mandar de volta pro
  login. No `loop-web`, interceptar o `401`, tentar `POST /refresh`
  silenciosamente (`credentials: "include"`), repetir a chamada original
  se conseguir; só redirecionar pro login se o refresh também falhar.
- **Fuso horário mostrado pro usuário**: a API guarda e calcula tudo no
  timezone que foi setado no cadastro (não muda depois via `PATCH` sem
  reconsiderar o que isso faz com dias já fechados — ver `DECISIONS.md`
  do repo da API se precisar entender esse detalhe).

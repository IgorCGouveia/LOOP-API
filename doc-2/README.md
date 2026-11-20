# Documentação do LOOP API (`doc-2`)

Documentação técnica do projeto. Esta pasta é a fonte de verdade para
arquitetura, decisões e investigações. O `README.md` da raiz continua
sendo a vitrine do projeto. O `docs/API-REFERENCE.md` continua sendo a
referência para quem constrói um cliente, até ser migrado (ver
[reference/README.md](./reference/README.md)).

## Como esta pasta é organizada

A estrutura segue dois padrões comuns no mercado:

- **[Diátaxis](https://diataxis.fr/)**: separa a documentação pelo que o
  leitor precisa fazer. *Explicação* mostra como o sistema funciona e por
  quê. *Referência* lista o contrato exato. Guias e tutoriais entram aqui
  quando houver demanda.
- **[ADR (Architecture Decision Records)](https://adr.github.io/)**, no
  formato de Michael Nygard: cada decisão de arquitetura vira um arquivo
  curto e numerado que não muda depois de aceito. Se a decisão mudar, um
  ADR novo substitui o antigo e os dois ficam no histórico.

| Pasta | Tipo | O que tem |
|---|---|---|
| [`architecture/`](./architecture/) | Explicação | Visão geral, camadas, modelo de domínio e as regras de negócio que não aparecem nos tipos |
| [`adr/`](./adr/) | Decisões | Um arquivo por decisão: contexto, opções, escolha, consequências |
| [`investigations/`](./investigations/) | Análise | Investigação de um problema concreto (geralmente uma issue): o que acontece, por quê, como reproduzir |
| [`reference/`](./reference/) | Referência | Contrato HTTP e configuração |
| [`glossary.md`](./glossary.md) | Referência | Termos do domínio (dia local, dia-alvo, grace fill...) |

## Índice

- [Visão geral da arquitetura](./architecture/overview.md)
- [Modelo de domínio e invariantes](./architecture/domain-model.md)
- [Glossário](./glossary.md)
- [Registro de decisões (ADRs)](./adr/README.md)
- Investigações
  - [Issue #15: PATCH /users deixa trocar o timezone](./investigations/issue-15-timezone-patch.md)

## Convenções

- Idioma: português, igual ao código e aos comentários do projeto.
- Toda afirmação sobre o comportamento do código cita o arquivo e a linha
  (`src/services/checkinServices.ts:110`) e o commit em que foi conferida.
  Se o código mudar, a citação mostra o que precisa ser revisto.
- Datas no formato ISO (`2026-11-19`).
- Um ADR com status `Proposto` ainda não foi decidido. Código não deve
  depender dele até virar `Aceito`.
- PR que muda comportamento documentado atualiza a doc no mesmo PR.

## Dívida de documentação conhecida

Referências no código e na doc antiga que apontam para arquivos que não
existem mais no repositório:

| Onde | Aponta para |
|---|---|
| `docs/API-REFERENCE.md:18` | `DECISIONS.md` |
| `prisma/schema.prisma:106` | `docs/explain/DECISOES-NAO-IMPLEMENTADAS.md` |
| `src/services/checkinServices.ts:45` | `docs/problems` |

A correção é trocar cada uma por um link para o ADR equivalente quando
ele existir, ou remover a referência.

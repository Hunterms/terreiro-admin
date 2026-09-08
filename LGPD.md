# Dado de filho é dado sensível

Ser filho de um terreiro é **dado pessoal sensível** pela LGPD: o art. 5º, II
lista "convicção religiosa" e "filiação a organização de caráter religioso"
lado a lado. Não é interpretação forçada — estar em `fin_filhos` de um terreiro
*é*, por si só, um registro de convicção religiosa.

Isso muda a base legal. Dado comum tem dez hipóteses (art. 7º), inclusive
"legítimo interesse". Dado sensível tem oito (art. 11), e nenhuma delas cobre
"cadastro de membro": as que sobram são obrigação legal, política pública,
pesquisa, exercício de direito, vida, saúde e prevenção à fraude. Sobra o
**consentimento específico e destacado**.

Não sou advogado e este arquivo não é parecer. É o que o sistema faz, e o que
ele ainda não faz.

## O que o sistema faz hoje

| Peça | Onde | Desde |
|---|---|---|
| Aceite registrado com versão e data | `/aceitar-termo` no Worker → `fin_filhos.consentimento_versao` / `.consentimento_em` | 08/09/2026 |
| Termo mostrado na entrada da área do filho | `area-filho.html`, modal travado, antes da casa aparecer | 08/09/2026 |
| Cópia dos dados de uma pessoa | admin → Dados → "Os dados de uma pessoa" | 08/09/2026 |
| Eliminação de verdade | admin → ficha do filho → Excluir, ou Dados → Retenção | 08/09/2026 |
| Prazo de retenção visível | admin → Dados → Retenção, quem saiu há mais de N meses | 08/09/2026 |
| Saída sem export | os três sistemas exportam CSV e backup | 08/09/2026 |

O aceite é escrito pela service account, no Worker, e não pelo navegador.
`fin_filhos` é fechada pra escrita desde 01/08, e tem que continuar: um aceite
que o navegador pudesse forjar não prova nada — nem a favor da casa, nem a
favor da pessoa.

A **versão** é guardada junto de propósito. Se a casa mudar o texto, o aceite
antigo deixa de bater com o vigente e é pedido de novo. Guardar só
`aceitou: true` perderia isso, e é o erro comum aqui.

## O que falta, e é seu

### 1. Publicar o termo

Nada aparece pro filho enquanto `adm_config/lgpd` não existir. É de propósito:
a peça técnica ficou pronta antes do texto, e não trava ninguém enquanto o
texto não estiver decidido.

Crie o documento `adm_config/lgpd` no Firestore do `terreiro-pvd`, com:

```
termo_versao    string   ex: "2026-09"
termo_texto     string   o texto abaixo, revisado
retencao_meses  number   opcional, padrão 24
```

Mudou o texto de forma relevante? Muda a `termo_versao` junto. Todo mundo
aceita de novo na próxima entrada. Correção de vírgula não precisa de versão
nova — e essa é justamente a decisão que não dá pra automatizar.

### 2. O texto

**Rascunho, não revisado por advogado.** Serve pra não começar da folha em
branco.

> **Sobre os seus dados**
>
> O Terreiro do Candieiro guarda o seu nome, telefone, e-mail, data de
> nascimento e o histórico da sua participação na casa: escalas, rega, cursos e
> mensalidade.
>
> Esse dado é usado só pra tocar a casa. Montar escala, avisar de gira, cobrar
> mensalidade e responder o que você pedir. Não é vendido, não é compartilhado
> com ninguém de fora, e não vira lista de marketing.
>
> Ser filho de um terreiro é informação sensível pela Lei Geral de Proteção de
> Dados. Por isso a casa precisa do seu aceite, e por isso ele fica registrado
> com a data.
>
> Você pode, quando quiser, pedir a cópia de tudo que a casa tem sobre você,
> corrigir o que estiver errado, ou pedir que seja apagado. É só falar com a
> administração.
>
> O registro financeiro fica guardado mesmo depois disso, porque é obrigação
> contábil da casa, e não uma escolha dela.

Duas coisas a decidir com quem entender:

- **O consentimento é frágil em contexto religioso.** A lei exige que seja
  livre, e a pessoa pode não se sentir livre pra recusar algo que a casa pede.
  A tela não oferece "recusar" por isso: fingir que existe um estado
  intermediário no sistema seria pior. Quem não aceita fecha a página e fala
  com a administração — a conversa é com gente, não com a interface.
- **Menor de idade** precisa de consentimento de quem responde por ele
  (art. 14). O sistema não distingue hoje.

### 3. O prazo

`retencao_meses` é o que a tela de Retenção usa pra marcar quem venceu. O
padrão é 24 meses depois da saída. É um número escolhido por falta de outro,
não por norma — e é o tipo de coisa que um dia de advogado resolve melhor que
um dia de programação.

## O que a eliminação NÃO apaga

Nada do financeiro. Mensalidade, pagamento, reembolso e curso ficam: são
registro contábil da casa, com guarda própria, e o titular não é dono dessa
guarda. A tela de expurgo diz isso em amarelo, na hora de apagar.

O que sai: cadastro, disponibilidade, reservas de rega, respostas de pergunta,
aparelhos com push, marcas de aviso lido, inscrições em evento, e o nome da
pessoa de dentro das alocações de escala e dos responsáveis do kanban.

Até 08/09 o botão "Excluir" apagava só `fin_filhos/{id}` e dizia que não podia
ser desfeita — sobrava a pessoa inteira nos outros oito lugares, vários com o
nome copiado junto.

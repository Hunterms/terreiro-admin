/**
 * O elenco da casa, e a prova de quem é quem — pelas páginas sem login.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * Até 01/08/2026 toda página pública lia `fin_filhos` direto do Firestore pra
 * montar o seletor de nomes. A collection era `allow read: if true`, e junto
 * com os nomes vinham telefone, valor da mensalidade, data de nascimento, email
 * e a observação interna — dos 60, de uma vez, com um curl.
 *
 * O pior não era o vazamento. O telefone É a credencial: a área do filho entra
 * com os 4 últimos dígitos dele. Eles chegavam na mesma resposta que a lista de
 * nomes, e a conferência acontecia no navegador, comparando com o dado que o
 * próprio navegador tinha baixado. Quem abrisse o devtools entrava como
 * qualquer pessoa da casa.
 *
 * Agora `fin_filhos` é fechada. O elenco vem do Worker sem os cinco campos
 * privados, e a prova é conferida do lado de lá, onde o telefone é segredo.
 *
 * Continua sendo prova FRACA: são 4 dígitos, e quem conhece o telefone de
 * alguém da casa consegue entrar como essa pessoa. A diferença é que agora
 * conhecer exige conhecer, e não baixar. É um degrau, não a escada inteira.
 *
 * ── O CUSTO, DITO EM VOZ ALTA ──────────────────────────────────────────────
 *
 * Worker fora do ar = seletor não carrega. Antes o Firestore servia direto. A
 * área do filho já dependia do Worker pra mensalidade, checkout e push; agora
 * depende pra abrir. Foi escolha: a alternativa era um espelho público sem PII
 * (padrão do `pub_slots_ocupados`), que não tem essa dependência mas pode
 * dessincronizar em silêncio, e dado desatualizado sobre gente é pior.
 */

/** URL do Worker, do mesmo `adm_config/agendamento` que o checkout já lê. */
function base(cfg) {
  const u = cfg?.checkout_worker_url;
  return u ? String(u).replace(/\/+$/, '') : null;
}

// Chamado quando uma requisição que LEVAVA sessão volta 403. Sem isto, token
// expirado deixa a tela com cara de logada e tudo falhando por baixo — a pior
// forma de quebrar, porque parece bug aleatório em vez de "entra de novo".
let aoExpirar = null;
export function quandoExpirar(fn) { aoExpirar = fn; }

async function chamar(cfg, rota, corpo) {
  const b = base(cfg);
  if (!b) throw new Error('sem_config');
  const resp = await fetch(b + rota, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo || {}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 403 && corpo?.sessao && aoExpirar) {
      esquecerSessao();
      aoExpirar();
    }
    const e = new Error(data?.error || `HTTP ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  return data;
}

/**
 * O elenco, já em ordem de nome e sem os campos privados.
 *
 * Não filtra por status aqui: cada página quer um recorte diferente (a despensa
 * quer só quem tem `gerencia_despensa`), e filtro escondido numa função
 * compartilhada é o tipo de coisa que some da vista e depois assombra.
 */
export async function carregarFilhos(cfg) {
  const data = await chamar(cfg, '/filhos');
  return Array.isArray(data.filhos) ? data.filhos : [];
}

/** Só os ativos, que é o recorte que quase toda página quer. */
export const ativos = (filhos) => filhos.filter((f) => !f.status || f.status === 'ativo');

/**
 * Confere os 4 dígitos. Devolve `{ ok, nome, tel, auth_email }` no acerto.
 *
 * `tel` e `auth_email` voltam de propósito: são dados da própria pessoa que
 * acabou de se identificar, e as telas de evento e venda preenchem o formulário
 * com eles. É o único caminho por onde esses campos saem do servidor agora.
 */
export async function entrar(cfg, filhoId, quatroDigitos) {
  try {
    return await chamar(cfg, '/entrar', { filho_id: filhoId, tel4: quatroDigitos });
  } catch (e) {
    return { ok: false, erro: e.message, status: e.status || 0 };
  }
}

/** O filho grava o que é conhecimento dele. Aceita sessão no lugar do PIN. */
export async function salvarMeuCadastro(cfg, quem, campos) {
  return chamar(cfg, '/meu-cadastro', { ...quem, ...campos });
}

/**
 * Cria ou troca o PIN. `prova` é o que abre a porta AGORA: os 4 dígitos do
 * telefone na primeira vez, o PIN atual quando for troca.
 *
 * A sessão sozinha não basta de propósito — sessão é "você entrou faz um
 * tempo", e trocar senha é justamente o momento em que isso é pouco.
 */
export async function criarPin(cfg, filhoId, prova, novoPin) {
  return chamar(cfg, '/criar-pin', { filho_id: filhoId, tel4: prova, pin: novoPin });
}

/** Pede reembolso. Nome e telefone saem do cadastro, não da tela. */
export async function pedirReembolso(cfg, quem, { descricao, valor, pix_chave }) {
  return chamar(cfg, '/reembolso', { ...quem, descricao, valor, pix_chave });
}

/** O histórico de reembolso de quem está logado. */
export async function meusReembolsos(cfg, quem) {
  return chamar(cfg, '/meus-reembolsos', quem);
}

/**
 * O mural interno: avisos, próximas atividades e as inscrições da pessoa.
 *
 * `pwa` diz se a pessoa está abrindo pela tela de início. Vai de carona aqui, e
 * não numa rota de telemetria, por dois motivos: o mural é a chamada que TODA
 * abertura faz, e uma rota nova pra contar gente é uma rota nova pra manter.
 * O Worker grava no máximo uma vez por dia, por pessoa.
 */
export async function mural(cfg, quem, pwa) {
  return chamar(cfg, '/mural', pwa ? { ...quem, pwa: true } : quem);
}

/** A caixa de avisos de quem está logado. */
export async function avisos(cfg, quem) {
  return chamar(cfg, '/avisos', quem);
}

/** Marca tudo até agora como lido. Chamado quando a aba de avisos abre. */
export async function marcarAvisosLidos(cfg, quem) {
  return chamar(cfg, '/avisos-lidos', quem);
}

// ── A SESSÃO NO NAVEGADOR ─────────────────────────────────────────────────
//
// O token fica em localStorage, não sessionStorage: fechar a aba não pode
// significar digitar o PIN de novo. Vale 30 dias, e o Worker confere a
// assinatura a cada chamada — expirado, ele recusa e a tela pede o PIN.
//
// O que NUNCA entra aqui é o PIN. Ele existe na memória da aba enquanto a
// pessoa está usando, e some quando ela sai.
const CHAVE_SESSAO = 'candieiro_sessao';

export function guardarSessao(filhoId, sessao) {
  try { localStorage.setItem(CHAVE_SESSAO, JSON.stringify({ filho_id: filhoId, sessao })); } catch {}
}
export function sessaoGuardada() {
  try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO) || 'null'); } catch { return null; }
}
export function esquecerSessao() {
  try { localStorage.removeItem(CHAVE_SESSAO); } catch {}
}

// ── LEITURA DE UMA VEZ QUE FALHA ──────────────────────────────────────────
//
// Os listeners contínuos já são embrulhados na página. Isto é pro outro caso:
// `getDocs` dentro de try/catch que, ao falhar, zera o array e segue. A tela
// desenha vazio, e vazio parece dado.
//
// Não interrompe nada: a página continua, só passa a DIZER o que não carregou.
// Uma seção vazia por engano é indistinguível de uma seção vazia de verdade, e
// foi assim que o reembolso do filho ficou invisível de junho a julho.
export function avisarFalha(oQue, e) {
  console.error(`não carregou: ${oQue}`, e);
  let b = document.getElementById('faixa-erro-leitura');
  if (!b) {
    b = document.createElement('div');
    b.id = 'faixa-erro-leitura';
    b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:4000;background:#7f1d1d;color:#fff;'
      + 'font:600 13px/1.45 -apple-system,system-ui,sans-serif;padding:10px 14px;text-align:center';
    document.body.appendChild(b);
  }
  const jaTem = b.dataset.itens ? b.dataset.itens.split('|') : [];
  if (!jaTem.includes(oQue)) jaTem.push(oQue);
  b.dataset.itens = jaTem.join('|');
  b.textContent = jaTem.length === 1
    ? `Não consegui carregar: ${jaTem[0]}. O resto da página funciona.`
    : `Não consegui carregar ${jaTem.length} partes desta página (${jaTem.join(', ')}).`;
}

/**
 * Mensagem pro humano. O Worker responde em português e a tela pode mostrar
 * direto — menos 'não confere', que precisa de contexto pra não soar acusatório
 * com quem só errou de dedo.
 */
export function explicar(erro) {
  if (erro === 'não confere') return 'Não bateu. Confere os números e tenta de novo.';
  if (erro === 'a prova atual não confere') return 'Não bateu. Confere e tenta de novo.';
  if (String(erro || '').startsWith('Muitas tentativas')) return erro;
  if (String(erro || '').startsWith('esse PIN')) return erro;
  if (erro === 'sem_config') return 'A configuração do sistema não carregou. Recarrega a página.';
  if (erro === 'filho não encontrado') return 'Não achei esse cadastro. Fala com a administração.';
  return erro || 'Não consegui agora. Tenta de novo em instantes.';
}

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

/** O filho grava a própria data de nascimento ou email. Só esses dois. */
export async function salvarMeuCadastro(cfg, filhoId, quatroDigitos, campos) {
  return chamar(cfg, '/meu-cadastro', { filho_id: filhoId, tel4: quatroDigitos, ...campos });
}

/**
 * Mensagem pro humano. O Worker responde em português e a tela pode mostrar
 * direto — menos 'não confere', que precisa de contexto pra não soar acusatório
 * com quem só errou de dedo.
 */
export function explicar(erro) {
  if (erro === 'não confere') return 'Esses 4 dígitos não batem com o cadastro. Confere e tenta de novo.';
  if (erro === 'sem_config') return 'A configuração do sistema não carregou. Recarrega a página.';
  if (erro === 'filho não encontrado') return 'Não achei esse cadastro. Fala com a administração.';
  return erro || 'Não consegui agora. Tenta de novo em instantes.';
}

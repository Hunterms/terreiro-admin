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

/**
 * Responde a uma escala: 'aceito', ou 'recusado' com o porquê.
 *
 * Passa pelo Worker porque `adm_escalas` aceita update sem login — é o que
 * deixa a gerente da lojinha montar o plantão dela. Escrito daqui, qualquer um
 * responderia no nome de qualquer um, e recusa forjada some com a pessoa da
 * escala sem ela saber.
 */
export async function responderEscala(cfg, quem, { escala_id, funcao_id, resposta, motivo }) {
  return chamar(cfg, '/responder-escala', { ...quem, escala_id, funcao_id, resposta, motivo });
}

/**
 * Registra que a pessoa aceitou o termo. `versao` é a do texto que ela LEU.
 *
 * Ser filho de um terreiro é dado sensível pela LGPD (art. 5º, II). O aceite
 * é escrito pelo Worker com a service account, e não daqui: `fin_filhos` é
 * fechada pra escrita, e um aceite que o navegador pudesse forjar não prova
 * nada — nem a favor da casa, nem a favor da pessoa.
 */
export async function aceitarTermo(cfg, quem, versao) {
  return chamar(cfg, '/aceitar-termo', { ...quem, versao });
}

/** O filho grava o que é conhecimento dele. Aceita sessão no lugar do PIN. */
export async function salvarMeuCadastro(cfg, quem, campos) {
  return chamar(cfg, '/meu-cadastro', { ...quem, ...campos });
}

/**
 * Cria, troca ou destrava o PIN. `prova` é o que abre a porta AGORA: os 4
 * dígitos do telefone na primeira vez, o PIN atual quando for troca.
 *
 * `telCheio` é a terceira porta, pra quem esqueceu: o celular COMPLETO do
 * cadastro. Quem usa ela deixa rastro — o Worker avisa o aparelho da pessoa e
 * o admin.
 *
 * A sessão sozinha não basta de propósito — sessão é "você entrou faz um
 * tempo", e trocar senha é justamente o momento em que isso é pouco.
 */
export async function criarPin(cfg, filhoId, prova, novoPin, telCheio = null) {
  return chamar(cfg, '/criar-pin', {
    filho_id: filhoId, tel4: prova, pin: novoPin,
    ...(telCheio ? { tel_cheio: telCheio } : {}),
  });
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
 * Quem já está inscrito num evento — só `filho_id` e `status`.
 *
 * A collection era pública de LIST e cada doc levava nome, telefone e valor de
 * quem se inscreveu. A tela do evento só precisa saber se a pessoa que acabou
 * de escolher o nome já está lá, e se pagou.
 */
export async function inscricoesDoEvento(cfg, eventoId) {
  const d = await chamar(cfg, '/inscricoes-do-evento', { evento_id: eventoId });
  return Array.isArray(d.inscricoes) ? d.inscricoes : [];
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

// ── O CENSO DA CASA ───────────────────────────────────────────────────────
//
// Quem é a casa: cor, gênero, de onde veio na fé. Cada resposta fica no
// cadastro da pessoa (`fin_filhos.censo_*`), e o admin soma no mapa.
//
// Cor, gênero e orientação são dado sensível (LGPD art. 5º, II), igual ser
// filho de terreiro. Por isso três travas:
//   - "Prefiro não dizer" é resposta, e conta como respondida;
//   - o valor NUNCA sai pelo /filhos (que é público): sai só `censo_ok`, a
//     lista do que a pessoa já respondeu, pra não perguntar de novo;
//   - só o filho escreve, pelo /meu-cadastro. A casa não declara a cor de
//     ninguém.
//
// A lista é uma só: a área do filho pergunta, o Worker valida e o admin soma
// a partir daqui. Opção nova entra aqui e vale nos três.
// Como perguntar, pelos guias de quem estuda isso (conferido em 25/11/2026):
//   - raça: as cinco categorias do IBGE, na ordem dele, e só autodeclaração.
//     O título NÃO é "cor ou raça" (termo do IBGE): a casa achou que soa mal
//     e escolheu "como você se declara racialmente", na linha do guia do MEC
//     (declaração étnico-racial). As opções seguem as do IBGE pra comparar.
//   - gênero e orientação: folder da Diretoria LGBT da Prefeitura de BH, as
//     alternativas "que devem constar em formulários de inscrição". Gênero e
//     orientação em perguntas separadas. Orientação é a última, como na PNS
//     2019 do IBGE: a mais íntima vem depois que a pessoa já confiou nas outras.
//     Intersexo saiu em 25/11, decisão da casa.
//   - toda pergunta tem "Não sei ou não quero responder" (`NAO_DIZER`).
export const NAO_DIZER = 'nao_dizer';
export const CENSO = [
  { campo: 'censo_cor', emoji: '✊🏿', titulo: 'Como você se declara?',
    porque: 'Quem diz é você, do jeito que você se vê. As opções são as do IBGE.',
    opcoes: [['branca', 'Branca'], ['preta', 'Preta'], ['amarela', 'Amarela'], ['parda', 'Parda'], ['indigena', 'Indígena']] },
  { campo: 'censo_genero', emoji: '🌗', titulo: 'Qual a sua identidade de gênero?',
    porque: 'Cis é quem se reconhece no gênero do registro de nascimento; trans é quem não. Pra casa saber quem ela acolhe.',
    opcoes: [['mulher_cis', 'Mulher cis'], ['mulher_trans', 'Mulher trans'], ['travesti', 'Travesti'], ['homem_cis', 'Homem cis'], ['homem_trans', 'Homem trans'], ['transmasculino', 'Transmasculino'], ['nao_binaria', 'Pessoa não binária'], ['outro', 'Outro']] },
  { campo: 'censo_escolaridade', emoji: '📚', titulo: 'Até onde você estudou?',
    porque: 'Ajuda a casa a pensar curso, material e jeito de ensinar.',
    opcoes: [['fundamental', 'Fundamental'], ['medio', 'Médio'], ['tecnico', 'Técnico'], ['superior', 'Superior'], ['pos', 'Pós-graduação']] },
  { campo: 'censo_origem', emoji: '🕯️', titulo: 'Antes da casa, de onde você vinha na fé?',
    porque: 'Muita gente chega de outro caminho. A casa quer conhecer esse caminho.',
    opcoes: [['catolica', 'Católica'], ['evangelica', 'Evangélica'], ['espirita', 'Espírita'], ['matriz_africana', 'Candomblé ou outra de matriz africana'], ['outra_umbanda', 'Outra casa de umbanda'], ['sem_religiao', 'Sem religião'], ['outra', 'Outra']] },
  { campo: 'censo_tempo', emoji: '⏳', titulo: 'Há quanto tempo você está na umbanda?',
    porque: 'Contando de antes da casa também. Ajuda a montar curso pra cada momento.',
    opcoes: [['menos_1', 'Menos de 1 ano'], ['1_3', '1 a 3 anos'], ['3_10', '3 a 10 anos'], ['mais_10', 'Mais de 10 anos']] },
  { campo: 'censo_orientacao', emoji: '🏳️‍🌈', titulo: 'Qual a sua orientação sexual?',
    porque: 'Terreiro sempre foi casa de quem a rua não acolhe. A casa quer saber o tamanho disso.',
    opcoes: [['assexual', 'Assexual'], ['bissexual', 'Bissexual'], ['gay', 'Gay'], ['heterossexual', 'Heterossexual'], ['lesbica', 'Lésbica'], ['pansexual', 'Pansexual'], ['outro', 'Outro']] },
];

/** O valor vale pra esta pergunta? "Prefiro não dizer" vale pra todas. */
export const respostaCensoValida = (campo, valor) => {
  const p = CENSO.find((c) => c.campo === campo);
  return !!p && (valor === NAO_DIZER || p.opcoes.some(([v]) => v === valor));
};

// ── SAÚDE E EMERGÊNCIA ─────────────────────────────────────────────────────
//
// O que a casa precisa saber se alguém passar mal numa gira: quem chamar,
// tipo de sangue, alergia (inclusive à fumaça da defumação e a erva), doença
// que pede cuidado, remédio de uso contínuo e o que a pessoa não come.
// Lista montada pelo que fichas médicas de comunidade pedem (escoteiros:
// contato de emergência, tipo sanguíneo, alergias por categoria, remédio de
// uso contínuo, condição atual, plano) mais o que é de terreiro (defumação,
// ervas, perfume/álcool). Gravidez e quizila saíram em 27/11, decisão da casa.
//
// Saúde é dado sensível (LGPD art. 5º, II e art. 11). Mesmas travas do censo:
//   - só o filho escreve, pelo /meu-cadastro, e só ele relê, pelo /minha-saude;
//   - o valor NUNCA sai pelo /filhos (público): sai só `saude_em`, a data da
//     última atualização, pra área saber se já preencheu;
//   - o admin lê direto no Firestore (rules: só admin), pra ter na mão na gira.
// Tudo é opcional. A ficha pode ser mudada quando quiser: alergia e remédio mudam.
export const SAUDE_GRUPOS = [
  { titulo: 'Quem a casa chama numa emergência', campos: [
    { campo: 'saude_contato_nome', tipo: 'texto', rotulo: 'Nome', max: 80 },
    { campo: 'saude_contato_rel', tipo: 'texto', rotulo: 'É seu ou sua…', dica: 'mãe, companheira, amigo', max: 40 },
    { campo: 'saude_contato_tel', tipo: 'tel', rotulo: 'Telefone' },
    { campo: 'saude_contato2_nome', tipo: 'texto', rotulo: 'Segunda pessoa (se a primeira não atender)', max: 80 },
    { campo: 'saude_contato2_tel', tipo: 'tel', rotulo: 'Telefone da segunda pessoa' },
  ]},
  { titulo: 'Saúde', campos: [
    { campo: 'saude_sangue', tipo: 'uma', rotulo: 'Tipo de sangue',
      opcoes: [['a+','A+'],['a-','A−'],['b+','B+'],['b-','B−'],['ab+','AB+'],['ab-','AB−'],['o+','O+'],['o-','O−'],['nao_sei','Não sei']] },
    { campo: 'saude_alergias', tipo: 'varias', rotulo: 'Tem alergia a…',
      opcoes: [['nenhuma','Nenhuma'],['alimento','Algum alimento'],['remedio','Algum remédio'],['fumaca','Fumaça ou defumação'],['ervas','Erva ou planta'],['perfume','Perfume ou álcool'],['inseto','Picada de inseto'],['latex','Látex'],['outra','Outra']] },
    { campo: 'saude_alergias_txt', tipo: 'texto', rotulo: 'Quais? E o que acontece?', dica: 'amendoim, dipirona, arruda… fica com falta de ar', max: 300, longo: true },
    { campo: 'saude_condicoes', tipo: 'varias', rotulo: 'Precisa de cuidado com…',
      opcoes: [['nenhuma','Nada'],['diabetes','Diabetes'],['pressao_alta','Pressão alta'],['pressao_baixa','Pressão baixa ou desmaio'],['asma','Asma ou problema de respiração'],['epilepsia','Epilepsia ou convulsão'],['coracao','Coração'],['locomocao','Dificuldade pra andar ou ficar em pé'],['outra','Outra']] },
    { campo: 'saude_condicoes_txt', tipo: 'texto', rotulo: 'Conta um pouco, se quiser', max: 300, longo: true },
    { campo: 'saude_remedios', tipo: 'texto', rotulo: 'Remédio que toma todo dia ou de uso contínuo', dica: 'nome e horário', max: 400, longo: true },
    { campo: 'saude_plano', tipo: 'texto', rotulo: 'Plano de saúde (se tiver)', max: 80 },
  ]},
  { titulo: 'Comida', campos: [
    { campo: 'saude_restricoes', tipo: 'varias', rotulo: 'Não come…',
      opcoes: [['nenhuma','Come de tudo'],['vegetariana','Carne (vegetariana)'],['vegana','Nada de origem animal'],['sem_gluten','Glúten'],['sem_lactose','Lactose'],['outra','Outra']] },
    { campo: 'saude_restricoes_txt', tipo: 'texto', rotulo: 'Detalhe, se precisar', max: 200 },
  ]},
  { titulo: 'Mais alguma coisa', campos: [
    { campo: 'saude_obs', tipo: 'texto', rotulo: 'O que a casa precisa saber pra cuidar de você', max: 500, longo: true },
  ]},
];
export const SAUDE = SAUDE_GRUPOS.flatMap((g) => g.campos);

/**
 * Normaliza e valida uma resposta. Devolve { ok, valor }. Vazio apaga o campo
 * (valor null): a pessoa pode tirar o que escreveu.
 */
export function validarSaude(campo, valor) {
  const c = SAUDE.find((x) => x.campo === campo);
  if (!c) return { ok: false };
  if (valor === null || valor === '' || (Array.isArray(valor) && !valor.length)) return { ok: true, valor: null };
  if (c.tipo === 'texto') { const v = String(valor).trim().slice(0, c.max || 200); return { ok: true, valor: v || null }; }
  if (c.tipo === 'tel') { const v = String(valor).replace(/\D/g, ''); return v.length >= 10 && v.length <= 13 ? { ok: true, valor: v } : { ok: false }; }
  if (c.tipo === 'uma') return c.opcoes.some(([v]) => v === valor) ? { ok: true, valor } : { ok: false };
  if (c.tipo === 'varias') {
    if (!Array.isArray(valor) || !valor.every((x) => c.opcoes.some(([v]) => v === x))) return { ok: false };
    // "Nenhuma" com outra marcada não faz sentido: vale o que foi marcado.
    const v = [...new Set(valor)];
    return { ok: true, valor: v.length > 1 ? v.filter((x) => x !== 'nenhuma') : v };
  }
  return { ok: false };
}

/** A ficha do próprio filho, pra ele ver e mudar. Só com sessão. */
export async function minhaSaude(cfg, quem) {
  return chamar(cfg, '/minha-saude', quem);
}

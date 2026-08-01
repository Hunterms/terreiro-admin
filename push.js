/**
 * Registro de notificação push — um arquivo, dois consumidores.
 *
 * Usado pelo `index.html` (admin) e pelo `area-filho.html` (filho). A diferença
 * entre os dois é um objeto de três campos, não um segundo caminho de código:
 * quem registra diz quem é, e o resto é igual.
 *
 * ── O TOKEN É O ID DO DOC ────────────────────────────────────────────────
 * `adm_push_tokens/{token}`. Duas consequências boas, de graça:
 *   · o mesmo celular re-registrando sobrescreve, não duplica
 *   · "só quem tem o token mexe no doc" vira regra de segurança que se
 *     sustenta sozinha — o token é secreto e só o aparelho dele conhece.
 *     É o que deixa o filho (que não tem login) registrar sem abrir brecha.
 *
 * ── O QUE PRECISA ESTAR CONFIGURADO ──────────────────────────────────────
 * A VAPID abaixo. Sai do Firebase Console → Configurações do projeto → Cloud
 * Messaging → "Certificados push da Web" → Gerar par de chaves. Cole a chave
 * pública aqui. Sem ela `getToken` recusa e o botão diz o que falta.
 *
 * ── iOS ──────────────────────────────────────────────────────────────────
 * No iPhone, push só funciona depois de "Adicionar à Tela de Início" — no
 * Safari normal a permissão nem é oferecida. Não é limitação daqui, é da
 * Apple. `diagnostico()` devolve esse caso nomeado pra tela poder explicar em
 * vez de só falhar.
 */

import { getMessaging, getToken, isSupported, deleteToken }
  from "https://cdn.jsdelivr.net/npm/firebase@10.12.0/messaging/+esm";
import { doc, setDoc, deleteDoc, serverTimestamp }
  from "https://cdn.jsdelivr.net/npm/firebase@10.12.0/firestore/+esm";

// Chave PÚBLICA — pode ficar no repo, é ela que o navegador manda no registro.
// As aspas não são detalhe: sem elas a linha continua sendo JavaScript válido
// (vira subtração de variáveis) e o arquivo passa em qualquer checagem de
// sintaxe — mas quebra na carga, no navegador, com ReferenceError. O smoke.sh
// confere o formato por causa disso.
const VAPID = 'BEha272cNc9NDDMKzazm53ZOcJ0wXdNqkw3zf9lrkbd5vUTQ-3xugzKXj2-4QvbvmK75YMnCojcx3s7mDubYafQ';

const CHAVE_LOCAL = 'push_token';
const COLECAO = 'adm_push_tokens';

/** O aparelho está na tela de início (ou é um app instalado)? */
export function instalado() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function ehIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Safari, e não Chrome dentro do iPhone. Só o Safari instala lá. */
export function ehSafari() {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium/.test(ua);
}

// ── INSTALAR NA TELA DE INÍCIO ─────────────────────────────────────────────
//
// Android e desktop deixam a página INSTALAR de verdade: o Chrome dispara
// `beforeinstallprompt`, e quem chamar `preventDefault()` fica com o convite na
// mão pra usar quando quiser. É o que transforma "toque no menu, depois em
// adicionar à tela inicial" num botão só.
//
// O iPhone não tem isso. A Apple não expõe nenhuma API de instalação, então lá
// é instrução, e por isso ela precisa ser boa: passo numerado, com o ícone que
// a pessoa vai procurar na tela.
//
// O evento chega UMA vez e cedo, às vezes antes da página montar o cartão. Por
// isso ele é capturado na carga do módulo e guardado aqui.
let convite = null;
let aoMudar = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    convite = e;
    if (aoMudar) aoMudar();
  });
  // Instalou por fora do nosso botão (menu do navegador). O convite morre, e a
  // tela precisa saber pra parar de oferecer.
  window.addEventListener('appinstalled', () => {
    convite = null;
    if (aoMudar) aoMudar();
  });
}

/** Chame com uma função pra redesenhar quando o convite chegar ou morrer. */
export function aoMudarInstalacao(fn) { aoMudar = fn; }

/**
 * Em que passo da instalação este aparelho está.
 *
 *   'instalado'      já está na tela de início
 *   'pode_instalar'  temos o convite do navegador: um botão resolve
 *   'ios_safari'     iPhone no Safari: instrução, que é tudo que a Apple deixa
 *   'ios_outro'      iPhone em Chrome/Firefox: nem instrução adianta, tem que
 *                    abrir no Safari primeiro
 *   'sem_instalacao' navegador que não instala (Safari de Mac, Firefox desktop)
 */
export function passoInstalacao() {
  if (instalado()) return 'instalado';
  if (convite) return 'pode_instalar';
  if (ehIOS()) return ehSafari() ? 'ios_safari' : 'ios_outro';
  return 'sem_instalacao';
}

/**
 * Dispara o convite nativo. Devolve 'aceito' | 'recusado' | 'sem_convite'.
 *
 * O convite é de uso único: depois de mostrado, o navegador não devolve o mesmo
 * evento. Se a pessoa recusar, some o botão até ela recarregar — e é o certo,
 * insistir com quem disse não é o caminho pra ela nunca mais voltar.
 */
export async function instalar() {
  if (!convite) return 'sem_convite';
  const e = convite;
  convite = null;
  e.prompt();
  const escolha = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  return escolha.outcome === 'accepted' ? 'aceito' : 'recusado';
}

/**
 * Por que o push não vai dar certo aqui — ou 'ok' se vai.
 *
 * Devolve caso nomeado em vez de booleano porque cada motivo pede uma frase
 * diferente na tela: "instala primeiro" não é a mesma conversa que "você
 * bloqueou" nem que "falta configurar a chave".
 */
export async function diagnostico() {
  if (!VAPID || VAPID.startsWith('COLE_AQUI')) return 'sem_chave';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return ehIOS() && !instalado() ? 'ios_precisa_instalar' : 'sem_suporte';
  }
  if (ehIOS() && !instalado()) return 'ios_precisa_instalar';
  if (typeof Notification === 'undefined') return 'sem_suporte';
  if (!(await isSupported().catch(() => false))) return 'sem_suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  return 'ok';
}

/** Este aparelho já está registrado? */
export function ativo() {
  // `Notification` não existe em todo navegador (iOS fora da tela de início é o
  // caso real aqui), e ler `.permission` de undefined derrubaria a página
  // inteira — não só o botão.
  if (typeof Notification === 'undefined') return false;
  return !!localStorage.getItem(CHAVE_LOCAL) && Notification.permission === 'granted';
}

/** Garante o service worker registrado e devolve a registration. */
export async function registrarSW() {
  // Escopo relativo: em GitHub Pages o site mora em /terreiro-admin/, e um
  // caminho absoluto registraria fora dele (ou seria recusado).
  const existente = await navigator.serviceWorker.getRegistration('./');
  return existente || navigator.serviceWorker.register('./sw.js', { scope: './' });
}

/**
 * Pede permissão, pega o token do aparelho e grava.
 *
 * `quem` é { papel: 'admin'|'filho', filho_id?, nome?, uid? }.
 * Devolve { ok: true, token } ou { ok: false, motivo } — nunca lança: isto é
 * chamado de um clique de botão, e botão que explode não diz nada ao usuário.
 */
export async function ativar(app, db, quem) {
  const motivo = await diagnostico();
  if (motivo !== 'ok') return { ok: false, motivo };

  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') return { ok: false, motivo: 'recusado' };

    const registration = await registrarSW();
    // O erro do getToken é o único lugar que nomeia a causa real: API não
    // habilitada, VAPID de outro projeto, service worker fora de escopo. Deixar
    // ele cair no catch genérico foi o que fez "não chega push" virar mistério.
    let token;
    try {
      token = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: registration });
    } catch (e) {
      const m = String(e?.message || e);
      if (/fcmregistrations|SERVICE_DISABLED|has not been used/i.test(m)) {
        return { ok: false, motivo: 'api_desligada', detalhe: m.slice(0, 300) };
      }
      if (/applicationServerKey|InvalidAccessError|VAPID/i.test(m)) {
        return { ok: false, motivo: 'vapid_errada', detalhe: m.slice(0, 300) };
      }
      return { ok: false, motivo: 'erro', detalhe: m.slice(0, 300) };
    }
    if (!token) return { ok: false, motivo: 'sem_token' };

    await setDoc(doc(db, COLECAO, token), {
      papel: quem.papel,
      filho_id: quem.filho_id || null,
      nome: quem.nome || null,
      uid: quem.uid || null,
      ua: navigator.userAgent.slice(0, 200),
      criadoEm: serverTimestamp(),
    });

    localStorage.setItem(CHAVE_LOCAL, token);
    return { ok: true, token };
  } catch (e) {
    console.warn('push: ativar falhou', e);
    return { ok: false, motivo: 'erro', detalhe: e?.message || String(e) };
  }
}

/** Desliga neste aparelho: apaga o doc e o token. Os outros continuam. */
export async function desativar(app, db) {
  const token = localStorage.getItem(CHAVE_LOCAL);
  localStorage.removeItem(CHAVE_LOCAL);
  if (!token) return { ok: true };
  try {
    await deleteDoc(doc(db, COLECAO, token));
    await deleteToken(getMessaging(app)).catch(() => {});
    return { ok: true };
  } catch (e) {
    console.warn('push: desativar falhou', e);
    return { ok: false, detalhe: e?.message || String(e) };
  }
}

/** Frase pra tela, por motivo. Uma só, direta, e que diz o que fazer. */
export const EXPLICACAO = {
  sem_chave: 'Falta a chave VAPID em push.js — ver PUSH.md.',
  sem_suporte: 'Este navegador não recebe notificação.',
  ios_precisa_instalar: 'No iPhone: Compartilhar → Adicionar à Tela de Início, e ativar por lá.',
  bloqueado: 'Você bloqueou notificações deste site. Libere nos ajustes do navegador.',
  recusado: 'Sem permissão, sem notificação.',
  sem_token: 'O navegador não devolveu o token. Tente de novo.',
  erro: 'Não consegui registrar.',
  api_desligada: 'Falta habilitar a "Firebase Cloud Messaging API" ou a "FCM Registration API" no Google Cloud do projeto terreiro-pvd (ver PUSH.md §1.2).',
  vapid_errada: 'A chave VAPID em push.js não bate com o projeto do Firebase. Gere de novo em Cloud Messaging → Certificados push da Web.',
};

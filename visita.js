// Conta visita no site do terreiro. Manda o tipo da página pro Worker, que tira
// robô, guarda só a cidade e um código do dia (sem IP) e grava em site_visitas.
//
// Quem é da casa abre uma vez terreirodocandieiro.com.br/?equipe=1 em cada
// aparelho: o aparelho sai da conta pra sempre (link no card do admin).
//
// As páginas chamam window.visita('horario', { servico }) e window.visita('enviou')
// no agendar, pro funil. O resto é automático no carregar.
(() => {
  const URL_VISITA = window.VISITA_URL || 'https://terreiro-email.hunter-soares-c.workers.dev/visita';
  const q = new URLSearchParams(location.search);
  try {
    if (q.get('equipe') === '1') localStorage.setItem('candieiro_equipe', '1');
    if (q.get('equipe') === '0') localStorage.removeItem('candieiro_equipe');
    if (localStorage.getItem('candieiro_equipe')) { window.visita = () => {}; return; }
  } catch {}
  const nome = location.pathname.split('/').pop().replace('.html', '') || 'index';
  const PAGINAS = { index: 'home', agendar: 'agendar', buzios: 'buzios', 'baralho-cigano': 'baralho', visitar: 'visitar', evento: 'evento', vendas: 'vendas' };
  const ref = document.referrer && !document.referrer.includes(location.host) ? new URL(document.referrer).host : '';
  // Origem pra conversão. ?c=nome-do-post sai do gerador de link do admin.
  // Vale 7 dias neste aparelho: viu o story hoje e agendou amanhã, conta pro
  // story. Chegada nova de fora troca a origem; navegação direta não troca.
  const fonteAgora = /Instagram/.test(navigator.userAgent) ? 'Instagram' : q.get('utm_source') || ref.replace(/^(www|m|l|lm)\./, '');
  const campAgora = (q.get('c') || q.get('utm_campaign') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  let origem = {};
  try {
    origem = JSON.parse(localStorage.getItem('candieiro_origem') || '{}');
    if (fonteAgora || campAgora) localStorage.setItem('candieiro_origem', JSON.stringify(origem = { fonte: fonteAgora || 'direto', campanha: campAgora, em: Date.now() }));
    else if (Date.now() - (origem.em || 0) > 7 * 86400000) origem = {};
  } catch {}
  window.origemVisita = { fonte: origem.fonte || 'direto', campanha: origem.campanha || '' };
  window.visita = (tipo, extra = {}) => {
    // text/plain não dispara preflight de CORS; o Worker lê o corpo como JSON igual.
    const corpo = JSON.stringify({ tipo, ref, utm: q.get('utm_source') || '', campanha: window.origemVisita.campanha, ...extra });
    if (!navigator.sendBeacon?.(URL_VISITA, corpo)) fetch(URL_VISITA, { method: 'POST', body: corpo, keepalive: true }).catch(() => {});
  };
  window.visita(PAGINAS[nome] || 'outra', { servico: q.get('s') || '' });
})();

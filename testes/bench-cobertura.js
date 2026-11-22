/* =========================================================================
   MEDIÇÃO DE PROCESSAMENTO — cobertura intradiária
   Mede geração + validação (com a análise por faixa ligada) em 30 dias,
   para 20, 50 e 100 pessoas. Imprime o tempo e os números do resultado.
   Roda no CI depois da suíte do motor; não falha a suíte, apenas registra.
   ========================================================================= */
const E = require('../src/motor/motor.js');

const CARGOS = ['CAIXA', 'BALCONISTA', 'FARMACEUTICO', 'SUBGERENTE', 'BALCONISTA', 'CAIXA'];
const TURNOS = [
  { entrada: '07:00', saida: '15:20', intervalos: [{ ini: '11:00', fim: '12:00' }] },
  { entrada: '09:00', saida: '17:20', intervalos: [{ ini: '13:00', fim: '14:00' }] },
  { entrada: '13:40', saida: '22:00', intervalos: [{ ini: '17:00', fim: '18:00' }] },
];

function equipeDe(n) {
  const eq = [];
  for (let i = 0; i < n; i++) {
    /* Turno e cargo avançam em passos diferentes de propósito. Com ambos em
       passo 3, todo farmacêutico cairia no mesmo turno e a manhã ficaria
       sempre descoberta — mediríamos um cenário quebrado em vez do caso
       típico. O descasamento espalha cada cargo pelos três turnos. */
    const t = TURNOS[(i + Math.floor(i / CARGOS.length)) % TURNOS.length];
    eq.push({
      id: 'p' + i,
      nome: 'PESSOA ' + i,
      cargo: CARGOS[i % CARGOS.length],
      horario: `${t.entrada} AS ${t.saida}`,
      jornada: { entrada: t.entrada, saida: t.saida, intervalos: t.intervalos.map(x => ({ ini: x.ini, fim: x.fim })) },
      ativo: true,
      ausencias: [],
    });
  }
  return eq;
}

/* Faixas em todos os dias da semana, três por dia: é o pior caso realista,
   com demanda declarada o expediente inteiro. */
const faixasDia = [
  { funcao: 'caixa', ini: '07:00', fim: '22:00', obrigatorio: 1, meta: 2 },
  { funcao: 'balcao', ini: '07:00', fim: '22:00', obrigatorio: 1, meta: 3 },
  { funcao: 'farmaceutico', ini: '07:00', fim: '22:00', obrigatorio: 1, meta: 2 },
];
const expediente = {};
const faixas = {};
for (let d = 0; d <= 6; d++) {
  expediente[String(d)] = [{ ini: '07:00', fim: '22:00' }];
  faixas[String(d)] = faixasDia;
}

const base = {
  modelo: '5x2', folgasSemana: 2, cicloDomingo: 3, maxSeq: 6, inicioSemana: 0,
  minCaixa: 2, minBalcao: 3, minFarma: 1, minSubger: 1,
  inicio: '2026-11-01', fim: '2026-11-30',
  expediente, faixas,
};

console.log('\n=== Processamento: cobertura intradiária, 30 dias ===\n');
console.log('pessoas | gerar(ms) | validar(ms) | total(ms) | segmentos | bloqueios | avisos');
console.log('--------|-----------|-------------|-----------|-----------|-----------|-------');

const resultados = [];
[20, 50, 100].forEach(n => {
  const eq = equipeDe(n);
  const P = Object.assign({}, base);

  const t0 = Date.now();
  const res = E.gerarEscala(eq, P);
  const t1 = Date.now();
  const val = E.validar(res, eq);
  const t2 = Date.now();

  const r = val.resumo;
  const seg = val.coberturaIntradiaria ? val.coberturaIntradiaria.resumo.segmentos : 0;
  console.log(
    String(n).padStart(7) + ' | ' +
    String(t1 - t0).padStart(9) + ' | ' +
    String(t2 - t1).padStart(11) + ' | ' +
    String(t2 - t0).padStart(9) + ' | ' +
    String(seg).padStart(9) + ' | ' +
    String(r.coberturaBloqueios).padStart(9) + ' | ' +
    String(r.coberturaAvisos).padStart(6)
  );
  resultados.push({ n, gerar: t1 - t0, validar: t2 - t1, total: t2 - t0, segmentos: seg });
});

console.log('');
const pior = resultados[resultados.length - 1];
if (pior.total > 120000) {
  console.log(`ATENÇÃO: ${pior.n} pessoas levaram ${pior.total}ms — acima de 2 minutos.`);
  process.exit(1);
}
console.log(`Pior caso medido: ${pior.n} pessoas em ${pior.total}ms.\n`);

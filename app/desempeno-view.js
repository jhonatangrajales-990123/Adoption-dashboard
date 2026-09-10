'use client';
// ─────────────────────────────────────────────────────────────────────────────
// VISTA · DESEMPEÑO DEL EQUIPO
//
// La pregunta que responde: ¿hemos mejorado, en tiempos y en volumen?
// El público es dirección (CRO y stakeholders), y su prueba de aceptación es
// dura: entenderlo en menos de 30 segundos, sin que nadie se lo explique.
//
// Por eso arranca con UNA frase calculada y las tarjetas de "antes vs ahora",
// y solo después vienen las gráficas. Un tablero que empieza por las gráficas
// obliga al lector a sacar la conclusión él, y en 30 segundos no le da.
//
// La comparación de cabecera es TRIMESTRE EN CURSO vs EL ANTERIOR EN EL MISMO
// TRAMO DE DÍAS. El detalle de por qué el tramo se iguala —y por qué las tasas
// además se miden a edad fija— está junto al cálculo, más abajo.
//
// Trampa que este archivo evita a propósito: medir "días hasta cerrar" por
// cohorte de solicitud en meses recientes. De los tickets de agosto solo han
// cerrado los rápidos, así que el promedio sale bajísimo y parece una mejora
// espectacular que es puro sesgo de supervivencia. Los meses que todavía no
// maduraron se marcan y quedan fuera de la comparación.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import { fmtInt, monthLabel, teamTotals, currentYM } from '@/lib/analistas-shared';
import { mesDe, MES_MINIMO, median } from '@/lib/metrics';
import { capacidad, cohorteMadura, diasDesdeFinDeMes } from '@/lib/activacion';
import { ChartPanel, GRUPOS, MultiLineChart, Leyenda } from './metric-explorer';


// Un mes cuenta como "cerrable" cuando ya pasaron 45 días desde que terminó:
// es la mediana de ciclo del equipo con holgura. Antes de eso, lo que veas de
// tiempos de cierre son solo los casos rápidos.
const DIAS_MADUREZ = 45;

// Días de vida que se le dan a un ticket antes de juzgar si lo atendimos.
// Con la mediana del equipo en 0–4 días, 15 es holgado: quien no recibió sesión
// en 15 días no es un caso "todavía en trámite", es un caso que se nos quedó.
const MADUREZ_ATENCION = 15;

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// ─── Trimestres, en UTC para que no se corra un día según la zona horaria ────
const diaUTC = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
const ymdDe = (d) => d.toISOString().slice(0, 10);
const sumarDias = (d, n) => new Date(d.getTime() + n * 86400000);
const inicioTrimestre = (d) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
const trimestreAnterior = (ini) => new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() - 3, 1));
const nombreQ = (d) => `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
const fechaCorta = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// ─── Cabecera: la conclusión antes que los datos ─────────────────────────────
function Titular({ c }) {
  const { actual: a, previo: p, largo, arranque } = c;
  if (!a.solicitudes && !p.solicitudes) return null;

  const dVol = a.solicitudes - p.solicitudes;
  const dVolPct = p.solicitudes ? Math.round((dVol / p.solicitudes) * 100) : 0;
  const dCob = (a.pctAtendido != null && p.pctAtendido != null) ? a.pctAtendido - p.pctAtendido : null;
  const dSla = (a.slaMed != null && p.slaMed != null) ? a.slaMed - p.slaMed : null;
  const dCarga = (a.porAnalista != null && p.porAnalista != null) ? a.porAnalista - p.porAnalista : 0;

  return (
    <div className="titular">
      <div className="titular-mes">
        {p.nombre} <span className="titular-flecha">→</span> {a.nombre}
        <span className="pill">{arranque ? 'trimestres cerrados' : `${largo} días de cada uno`}</span>
      </div>
      <p>
        En los <b>primeros {largo} días</b> de {a.nombre} entraron <b>{fmtInt(a.solicitudes)}</b> solicitudes,
        {' '}frente a <b>{fmtInt(p.solicitudes)}</b> en los mismos {largo} días de {p.nombre}
        {dVol !== 0 && <> (<b className={dVol > 0 ? 'txt-good' : 'txt-bad'}>{dVol > 0 ? '+' : ''}{dVolPct}%</b>)</>}.
        {dSla != null && (
          <> La primera sesión llega en <b>{a.slaMed} día{a.slaMed === 1 ? '' : 's'}</b> contra <b>{p.slaMed}</b> antes
            {dSla !== 0 && <> (<b className={dSla < 0 ? 'txt-good' : 'txt-bad'}>{dSla < 0 ? 'más rápido' : 'más lento'}</b>)</>}.
          </>
        )}
      </p>
      {/* La lectura no puede quedarse en volumen y velocidad. Se puede ir más
          rápido y mover más tickets y aun así estar atendiendo a una porción
          menor de los que llegan — que es lo que pasa cuando el volumen crece
          más que el equipo. Decir solo "más volumen sin perder velocidad" sería
          entregar media historia, y la mitad que falta es la mala. */}
      {dCob != null && (
        <p className="titular-sub">
          {dCob < -3 ? (
            <>
              Pero la cobertura cayó: atendemos dentro de sus primeros {MADUREZ_ATENCION} días al
              {' '}<b>{a.pctAtendido}%</b> de lo que entra, contra el <b>{p.pctAtendido}%</b> de {p.nombre}
              {' '}(<b className="txt-bad">{Math.abs(dCob)} puntos menos</b>).
              {' '}
              {/* Aquí hay dos historias muy distintas y confundirlas manda a
                  dirección por el camino equivocado. Si la carga por analista
                  SUBIÓ, es techo de capacidad y la respuesta es más gente. Si
                  BAJÓ —porque entró gente nueva— el problema no es capacidad, y
                  pedir más contrataciones no lo arregla. */}
              {dCarga > 0 ? (
                <>La carga por analista subió de {p.porAnalista} a {a.porAnalista} cuentas al mes con
                  {' '}{a.analistas} analistas activos: <b>el volumen creció más rápido que el equipo</b>.
                  {' '}A quien atendemos le va bien y rápido; el problema son los que no alcanzamos a tomar.</>
              ) : (
                <>Y no es falta de gente: el equipo pasó de <b>{p.analistas}</b> a <b>{a.analistas}</b> analistas activos
                  {' '}y la carga por cabeza <b>bajó</b> de {p.porAnalista} a {a.porAnalista} cuentas al mes.
                  {' '}Con más manos y menos carga cada una, una cobertura que cae apunta al
                  {' '}<b>proceso, al reparto o al arranque de los analistas nuevos</b>, no al tamaño del equipo.</>
              )}
            </>
          ) : dCob > 3 ? (
            <>Y la cobertura subió: atendemos dentro de {MADUREZ_ATENCION} días al <b>{a.pctAtendido}%</b> contra
              {' '}el <b>{p.pctAtendido}%</b> de {p.nombre}, con {a.analistas} analistas y {a.porAnalista} cuentas por cabeza al mes.
              {' '}<b>Más volumen y mejor cobertura a la vez</b>.</>
          ) : (
            <>La cobertura se mantiene: atendemos dentro de {MADUREZ_ATENCION} días al <b>{a.pctAtendido}%</b> de lo que entra,
              {' '}con {a.analistas} analistas y {a.porAnalista} cuentas por cabeza al mes frente a {p.porAnalista} antes.</>
          )}
        </p>
      )}

      {/* Un ticket sin dueño no lo atiende nadie. Si esta pila creció, explica
          por sí sola buena parte de la caída de cobertura — y se arregla
          asignando, que es mucho más barato que contratar. */}
      {a.sinAsignar > 0 && a.pctSinAsignar >= 5 && (
        <div className="titular-nota nota-alerta">
          🚨 <b>{fmtInt(a.sinAsignar)} tickets de {a.nombre} ({a.pctSinAsignar}%) no tienen analista asignado</b>
          {p.sinAsignar >= 0 && <> — en {p.nombre} eran {fmtInt(p.sinAsignar)} ({p.pctSinAsignar}%)</>}.
          {' '}Sin dueño no los atiende nadie, así que entran completos a la cuenta de «no atendidos».
          {' '}Es la parte de la caída que se arregla asignando, no contratando.
        </div>
      )}
      <div className="titular-nota">
        📐 Los dos trimestres se miden con <b>la misma cantidad de días</b> ({largo}) para que la comparación sea pareja.
        {' '}Las tasas se calculan solo sobre tickets que ya cumplieron <b>{MADUREZ_ATENCION} días de vida</b>
        {' '}({fechaCorta(a.ini)}–{fechaCorta(a.finM)} vs {fechaCorta(p.ini)}–{fechaCorta(p.finM)}):
        {' '}sin ese recorte, los tickets recién entrados de {a.nombre} contarían como «no atendidos» solo por ser nuevos.
      </div>
    </div>
  );
}

// ─── Tarjeta de "antes vs ahora" ─────────────────────────────────────────────
function CardComparativa({ label, hint, antes, ahora, fmt = (v) => fmtInt(v), mejorEs = 'mas', sufijo = '' }) {
  if (antes == null || ahora == null) {
    return (
      <div className="cmp-card">
        <div className="cmp-lbl">{label}</div>
        <div className="cmp-vals"><span className="cmp-ahora">—</span></div>
        <div className="cmp-hint">Sin datos suficientes.</div>
      </div>
    );
  }
  const delta = ahora - antes;
  // 'neutro' = la métrica no tiene un lado bueno. Pintarla de verde o rojo
  // sería opinar por el lector sobre algo que depende del contexto.
  const cls = (delta === 0 || mejorEs === 'neutro') ? ''
    : (mejorEs === 'mas' ? delta > 0 : delta < 0) ? 'txt-good' : 'txt-bad';
  return (
    <div className="cmp-card">
      <div className="cmp-lbl">{label}</div>
      <div className="cmp-vals">
        <span className="cmp-antes">{fmt(antes)}{sufijo}</span>
        <span className="cmp-flecha">→</span>
        <span className="cmp-ahora">{fmt(ahora)}{sufijo}</span>
      </div>
      <div className={'cmp-delta ' + cls}>
        {delta === 0 ? 'igual' : `${delta > 0 ? '+' : ''}${fmt(Math.round(delta * 10) / 10)}${sufijo}`}
      </div>
      <div className="cmp-hint">{hint}</div>
    </div>
  );
}

// ─── Barras de volumen mes a mes, con las cohortes inmaduras marcadas ────────
function BarrasVolumen({ meses, datos }) {
  const max = Math.max(...datos.map((d) => d.solicitudes), 1);
  return (
    <>
    {/* Sin esto son barras bicolor sin explicación: el lector ve gris y verde y
        tiene que deducir qué significa cada parte. */}
    <div className="chart-legend" style={{ marginBottom: 10, padding: 0 }}>
      <span className="chart-legend-item">
        <span className="chart-legend-key" style={{ background: 'var(--surface3)', border: '1px solid var(--brd)' }} />
        Solicitudes que llegaron
      </span>
      <span className="chart-legend-item">
        <span className="chart-legend-key" style={{ background: 'var(--g)' }} />
        De esas, las que terminaron completadas
      </span>
    </div>
    <div className="vol-bars">
      {meses.map((m, i) => {
        const d = datos[i];
        const madura = cohorteMadura(m, DIAS_MADUREZ);
        return (
          <div key={m} className="vol-col" title={`${monthLabel(m)}\n${fmtInt(d.solicitudes)} solicitudes\n${fmtInt(d.completados)} completadas\n${fmtInt(d.atendidos)} atendidas`}>
            <div className="vol-num">{fmtInt(d.solicitudes)}</div>
            <div className="vol-track">
              <div className="vol-fill" style={{ height: `${(d.solicitudes / max) * 100}%` }}>
                <div className="vol-fill-ok" style={{ height: `${pct(d.completados, d.solicitudes)}%` }} />
              </div>
            </div>
            <div className={'vol-mes' + (madura ? '' : ' vol-mes-nuevo')}>{monthLabel(m).replace(' 2026', '')}</div>
            {!madura && <div className="vol-tag" title={`Este mes todavía tiene tickets en curso: cerró hace ${diasDesdeFinDeMes(m)} días y el ciclo típico son ~${DIAS_MADUREZ}.`}>⏳</div>}
          </div>
        );
      })}
    </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export function DesempenoView({ d, ctrl, onNavigate }) {
  const { scoped, recordsTodos, paisOpts, segOpts } = d;
  const lente = ctrl.lente;

  // Todos los meses de la ventana, en orden cronológico (aquí sí importa el
  // orden natural: la historia se lee de izquierda a derecha).
  //
  // El MES EN CURSO se queda fuera, y no es un detalle: el 9 de septiembre
  // llevamos 9 días de datos contra los 30 de agosto, así que TODAS las líneas
  // se desploman en el último punto. Quien mira esta vista 30 segundos lee un
  // derrumbe donde solo hay un mes a medio llenar. El mes en curso se ve en
  // Resumen, que es la vista hecha para eso.
  const mesActual = currentYM();
  const todosMeses = useMemo(() => {
    const s = new Set(scoped.map((r) => mesDe(r, lente)).filter((m) => m && m >= MES_MINIMO));
    return [...s].sort();
  }, [scoped, lente]);
  const meses = useMemo(() => todosMeses.filter((m) => m !== mesActual), [todosMeses, mesActual]);
  const hayMesEnCurso = todosMeses.includes(mesActual);

  const porMes = useMemo(() => meses.map((m) => {
    const recs = scoped.filter((r) => mesDe(r, lente) === m);
    const t = teamTotals(recs);
    const cap = capacidad(recs);
    return {
      mes: m, label: monthLabel(m), recs,
      solicitudes: t.asignados, atendidos: t.atendidos, completados: t.completados,
      sla: t.slaMed, slaAvg: t.slaAvg,
      ciclo: t.cicloMed, cicloAvg: t.cicloAvg,
      exito: t.tasa, pctAtendidos: t.pctAtendidos,
      analistas: cap.analistas, porAnalista: cap.promedio,
      madura: cohorteMadura(m, DIAS_MADUREZ),
    };
  }), [meses, scoped, lente]);

  // ── TRIMESTRE EN CURSO vs EL ANTERIOR, EN EL MISMO TRAMO ──────────────────
  //
  // La trampa de un "Q actual vs Q anterior" mal hecho: comparar 70 días
  // corridos contra 91. El trimestre en curso siempre perdería, y no por el
  // equipo. Por eso al trimestre anterior se le recorta el MISMO número de
  // días: si hoy llevamos 70 días de Q3, se compara contra los primeros 70
  // días de Q2, no contra Q2 entero.
  //
  // La segunda trampa es más fina y afecta a las tasas: los tickets de la
  // última semana del trimestre en curso todavía no han tenido tiempo de
  // recibir su sesión, mientras que los de la misma semana del trimestre
  // anterior ya se resolvieron hace meses. Comparar así hunde al Q en curso.
  // La solución es medir a EDAD FIJA: solo entran los tickets que ya cumplieron
  // 15 días de vida, y la pregunta es "¿lo atendimos dentro de sus primeros 15
  // días?". Esa pregunta se responde igual de bien en los dos trimestres.
  const comparativa = useMemo(() => {
    const campo = lente === 'cierre' ? 'fecha_finalizacion' : 'fecha_solicitud';
    const hoy = diaUTC(new Date());
    const iniAct = inicioTrimestre(hoy);
    const diasCorridos = Math.round((hoy - iniAct) / 86400000) + 1;

    // Recién arrancado el trimestre no hay nada que comparar: se comparan los
    // dos trimestres anteriores completos y se dice que es eso.
    const arranque = diasCorridos < MADUREZ_ATENCION + 14;
    const finAct = arranque ? sumarDias(iniAct, -1) : hoy;
    const baseAct = arranque ? trimestreAnterior(iniAct) : iniAct;
    const largo = arranque
      ? Math.round((finAct - baseAct) / 86400000) + 1
      : diasCorridos;
    const baseAnt = trimestreAnterior(baseAct);
    const finAnt = sumarDias(baseAnt, largo - 1);

    const enRango = (a, b) => {
      const A = ymdDe(a), B = ymdDe(b);
      return scoped.filter((r) => { const f = r[campo]; return f && f >= A && f <= B; });
    };

    const bloque = (ini, fin) => {
      const recs = enRango(ini, fin);
      // Ventana recortada para las tasas: todos con al menos 15 días de vida.
      const finM = sumarDias(fin, -MADUREZ_ATENCION);
      const maduros = finM >= ini ? enRango(ini, finM) : [];
      const aTiempo = maduros.filter((r) => r.dias_primera_sesion != null && r.dias_primera_sesion <= MADUREZ_ATENCION).length;
      const dias = maduros.map((r) => r.dias_primera_sesion).filter((v) => v != null);
      const cap = capacidad(recs);
      return {
        nombre: nombreQ(ini), ini, fin, finM,
        solicitudes: recs.length,
        analistas: cap.analistas,
        // Normalizada a 30 días para que se pueda leer como "cuentas al mes" y
        // se pueda comparar con la misma métrica en la pestaña de Activación.
        // Sin normalizar sería "cuentas por 71 días", que no significa nada
        // fuera de esta tarjeta.
        porAnalista: cap.promedio != null ? Math.round((cap.promedio / largo) * 30 * 10) / 10 : null,
        sinAsignar: cap.sinAsignar,
        pctSinAsignar: recs.length ? Math.round((cap.sinAsignar / recs.length) * 100) : 0,
        nMaduros: maduros.length,
        pctAtendido: maduros.length ? Math.round((aTiempo / maduros.length) * 100) : null,
        slaMed: median(dias),
      };
    };

    return {
      arranque, largo,
      actual: bloque(baseAct, finAct),
      previo: bloque(baseAnt, finAnt),
    };
  }, [scoped, lente]);

  const inmaduros = porMes.filter((p) => !p.madura);
  const cap = useMemo(() => capacidad(scoped), [scoped]);

  // Volumen vs tiempo en un solo gráfico NO se puede (son dos unidades y dos
  // escalas: mezclarlas en un eje miente). Van como dos gráficos apilados con
  // los mismos meses, que es la forma honesta de leer la misma historia.
  const serieVolumen = useMemo(() => ([
    { key: 'solicitudes', label: 'Solicitudes recibidas', color: 'var(--chart-muted)', vals: porMes.map((p) => p.solicitudes) },
    { key: 'atendidos', label: 'Atendidas (1ª sesión)', color: 'var(--blue)', vals: porMes.map((p) => p.atendidos) },
    { key: 'completados', label: 'Completadas', color: 'var(--g)', vals: porMes.map((p) => p.completados) },
  ]), [porMes]);

  const serieTiempos = useMemo(() => ([
    { key: 'sla', label: 'Días a la 1ª sesión (mediana)', color: 'var(--a)', vals: porMes.map((p) => p.sla) },
    // El ciclo se corta en los meses inmaduros: dibujarlo ahí sería inventar una mejora
    { key: 'ciclo', label: 'Días hasta cerrar (mediana)', color: 'var(--purple)', vals: porMes.map((p) => (p.madura ? p.ciclo : null)) },
  ]), [porMes]);

  const serieCapacidad = useMemo(() => ([
    { key: 'porAnalista', label: 'Cuentas por analista al mes', color: 'var(--blue)', vals: porMes.map((p) => p.porAnalista) },
  ]), [porMes]);

  if (!porMes.length) {
    return <div className="panel"><div className="panel-bd muted">No hay meses con datos para los filtros actuales.</div></div>;
  }

  return (
    <>
      <Titular c={comparativa} />

      <div className="cmp-row">
        <CardComparativa
          label="Solicitudes recibidas"
          hint={`Todo lo que entró al pipeline en los ${comparativa.largo} días de cada trimestre.`}
          antes={comparativa.previo.solicitudes} ahora={comparativa.actual.solicitudes} mejorEs="mas" />
        {/* Va pegada al volumen a propósito: es su contrapeso. Un volumen que
            sube con la cobertura cayendo no es crecimiento, es acumulación. */}
        <CardComparativa
          label={`Atendidas en ≤${MADUREZ_ATENCION} días`}
          hint={`De los tickets que ya cumplieron ${MADUREZ_ATENCION} días, a cuántos les dimos primera sesión dentro de ese plazo. Es el contrapeso del volumen.`}
          antes={comparativa.previo.pctAtendido} ahora={comparativa.actual.pctAtendido} mejorEs="mas" sufijo="%"
          fmt={(v) => String(v)} />
        <CardComparativa
          label="Días a la 1ª sesión"
          hint="Mediana, sobre los mismos tickets maduros. Cuánto espera el cliente desde que pide hasta que lo atendemos."
          antes={comparativa.previo.slaMed} ahora={comparativa.actual.slaMed} mejorEs="menos" sufijo="d"
          fmt={(v) => String(v)} />
        {/* Ni subir ni bajar es "bueno" por sí solo: más carga puede ser
            productividad o puede ser saturación, y menos carga puede ser
            holgura o gente nueva que aún no arranca. Va sin color y con el
            número de analistas al lado, que es lo que le da sentido. */}
        <CardComparativa
          label="Cuentas por analista al mes"
          hint={`Carga por cabeza, normalizada a 30 días. Analistas activos: ${comparativa.previo.analistas} en ${comparativa.previo.nombre} → ${comparativa.actual.analistas} en ${comparativa.actual.nombre}.`}
          antes={comparativa.previo.porAnalista} ahora={comparativa.actual.porAnalista} mejorEs="neutro"
          fmt={(v) => String(v)} />
      </div>

      {/* Los tiempos de cierre NO caben en esta comparación y decirlo es parte
          del trabajo: en el trimestre en curso apenas ha cerrado la primera
          tanda, y siempre cierran primero los casos fáciles. Poner ese número
          aquí mostraría una mejora de varios días que es puro espejismo. */}
      <div className="explorer-nota" style={{ marginTop: -4, borderRadius: 'var(--rad)', border: '1px solid var(--brd)' }}>
        ⏱️ <b>Los días hasta cerrar y el % completado no se comparan a esta altura del trimestre.</b>
        {' '}De {comparativa.actual.nombre} solo han cerrado los casos rápidos, así que su promedio saldría
        {' '}artificialmente bueno. Esos dos se leen abajo, mes a mes, con los meses inmaduros marcados.
      </div>

      <div className="seccion-t">Mes a mes, desde enero</div>

      {/* Las dos advertencias de calendario van juntas y aquí abajo, no arriba:
          las dos hablan de las gráficas que siguen, y separadas sumaban tres
          cajas de texto seguidas antes de que el lector viera un solo dato. */}
      {(hayMesEnCurso || inmaduros.length > 0) && (
        <div className="explorer-nota nota-warn" style={{ marginTop: -4, borderRadius: 'var(--rad)', border: '1px solid var(--abrd)' }}>
          {hayMesEnCurso && (
            <>📅 <b>{monthLabel(mesActual)} no aparece:</b> va en curso, y un mes a medio llenar hunde el último punto
              {' '}de todas las líneas. Míralo en <b>Resumen</b>. </>
          )}
          {inmaduros.length > 0 && (
            <>⏳ <b>{inmaduros.map((p) => p.label).join(' y ')}</b> {inmaduros.length === 1 ? 'sigue' : 'siguen'} con tickets abiertos,
              {' '}así que {inmaduros.length === 1 ? 'queda' : 'quedan'} fuera de la línea de «días hasta cerrar»
              {' '}—de un mes reciente solo han cerrado los casos rápidos—. El volumen sí se muestra completo.</>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-hd">
          <div>
            <div className="stitle">Volumen de gestión, mes a mes</div>
            <div className="ssub">La barra completa son las solicitudes que llegaron; la parte verde, las que terminaron completadas.</div>
          </div>
        </div>
        <div className="panel-bd"><BarrasVolumen meses={meses} datos={porMes} /></div>
      </div>

      <div className="chart-card">
        <div className="chart-card-hd">
          <div>
            <div className="stitle">¿Estamos moviendo más trabajo?</div>
            <div className="ssub">Las tres líneas comparten unidad (tickets), así que la distancia entre ellas se lee directo: lo que llega, lo que atendemos y lo que cerramos bien.</div>
          </div>
        </div>
        <Leyenda series={serieVolumen} />
        <div className="chart-card-bd"><MultiLineChart months={meses} series={serieVolumen} unidad="conteo" alto={240} /></div>
      </div>

      <div className="chart-card">
        <div className="chart-card-hd">
          <div>
            <div className="stitle">¿Lo estamos haciendo más rápido?</div>
            <div className="ssub">
              Medianas, no promedios: un caso extremo no debe mover la lectura. La línea de cierre se corta en los meses que aún no maduran.
            </div>
          </div>
        </div>
        <Leyenda series={serieTiempos} />
        <div className="chart-card-bd"><MultiLineChart months={meses} series={serieTiempos} unidad="dias" alto={240} /></div>
      </div>

      <div className="chart-card">
        <div className="chart-card-hd">
          <div>
            <div className="stitle">¿Cuánto carga cada analista?</div>
            <div className="ssub">
              Solicitudes del mes ÷ analistas activos ese mes. Léela junto a la gráfica de arriba:
              si esta sube y los tiempos no empeoran, el proceso escaló. Si suben las dos, llegamos al techo.
            </div>
          </div>
        </div>
        <Leyenda series={serieCapacidad} />
        <div className="chart-card-bd"><MultiLineChart months={meses} series={serieCapacidad} unidad="conteo" alto={200} /></div>
        <div className="explorer-nota">
          Hoy hay <b>{cap.analistas} analistas</b> con tickets en la selección · carga promedio <b>{cap.promedio}</b> · el que más lleva: <b>{fmtInt(cap.max)}</b> · el que menos: <b>{fmtInt(cap.min)}</b>.
          {cap.sinAsignar > 0 && <> Hay <b>{fmtInt(cap.sinAsignar)}</b> tickets sin analista asignado, que no entran en el promedio.</>}
        </div>
      </div>

      <div className="seccion-t">Profundizar por tema</div>
      <div className="seccion-sub">
        Cada gráfica se puede filtrar y dividir por su cuenta. Al mover el filtro de arriba todas vuelven a alinearse.
      </div>
      {GRUPOS.map((g) => (
        <ChartPanel key={g.id} grupo={g} records={recordsTodos} lente={lente}
          paisOpts={paisOpts} segOpts={segOpts}
          globalPais={ctrl.pais} globalSeg={ctrl.seg}
          conBase={g.id === 'mrr' || g.id === 'csat'} />
      ))}

      <div className="panel">
        <div className="panel-hd"><div><div className="stitle">¿Quién hizo qué?</div><div className="ssub">El desglose persona a persona vive en su propia vista.</div></div></div>
        <div className="panel-bd">
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('equipo')}>👥 Ver el detalle por analista →</button>
        </div>
      </div>
    </>
  );
}

/**
 * Servidor del app "Maquinaria y combustible" · Rural Bioenergía / Ypoti (Google Apps Script) — versión 1.2
 *
 * Es un proyecto SEPARADO del "Registro de manejo": otro proyecto de Apps Script, otra planilla y otra carpeta de Drive.
 * No comparte código, contraseñas ni datos con el app de los capataces. Sigue el estándar de los apps Ypoti
 * (Registro de manejo, Orden de compra, Itaverá): código personal al abrir, copia en la nube de lo que se escribe,
 * actualización automática, mapa de pastos y lectura de fotos con IA.
 *
 * Este archivo NO tiene ninguna clave: puede estar en GitHub. Las claves quedan en Configuración del proyecto ›
 * Propiedades del script: CLAVE_MAESTRA (código maestro de 6 números, se crea solo), SECRETO (firma de tokens y QR,
 * se crea solo) y, si se quiere usar la IA, ANTHROPIC_API_KEY (y opcional ANTHROPIC_MODEL).
 *
 * Qué hace:
 *   1. Ingreso con código personal de 6 números (único por persona, sin lista de nombres). El código se guarda solo como
 *      HMAC. Quien no tiene código lo pide desde el app ("No tengo código: pedir uno"): queda pendiente y el gerente de
 *      esa estancia lo aprueba o rechaza. Límite de intentos por teléfono y en total. El servidor devuelve un token
 *      firmado: con ese token el teléfono trabaja sin señal y manda lo que se registró cuando vuelve la conexión.
 *   1b. Copia en la nube ('nube'): los borradores de cada persona (hoja 'borradores') y sus partes abiertos vuelven en
 *      cualquier teléfono donde entre con su código. Nada de lo escrito se pierde.
 *   1c. 'leer_foto': la IA (Claude) lee el horómetro o el totalizador en la foto; si lo escrito no coincide, alerta.
 *   2. Entrega a cada teléfono los catálogos que le corresponden según su papel (máquinas, proyectos, asignaciones,
 *      servicios, pastos, tanques, prestadores, vales, artículos del almacén, planes de mantenimiento, solicitudes…).
 *   3. Recibe los eventos de campo (parte diario del operador con sus tramos y cargas, despachos de combustible, lecturas
 *      de la bomba, descargas de combustible, movimientos de almacén, solicitudes, mantenimientos y fallas), sin duplicar
 *      nada si el teléfono reintenta, y guarda las fotos en Drive.
 *   4. Es la aba del gerente: alta y edición de catálogos, asignaciones operador × máquina × proyecto, aprobación de
 *      solicitudes (compra, salida, ajuste de inventario), revisión de despachos y alertas, vales de combustible para
 *      prestadores (QR con token aleatorio; el teléfono del encargado guarda solo el hash SHA-256) y tableros.
 *   5. Recalcula (cada 30 minutos con un disparador, y cuando el gerente abre el tablero si hay datos nuevos) las hojas
 *      derivadas: 'rateio' (horas máquina, horas operador, litros y costos por tramo → proyecto, servicio, pasto y centro
 *      de costo), 'conciliacion' (cada tanque por día: totalizador de la bomba contra despachos, saltos del totalizador,
 *      stock teórico contra régla), 'costos_maquina' (costo de la hora máquina por mes) y las 'alertas' antirrobo.
 *
 * Instalación (primera vez):
 *   a) Cree un proyecto nuevo en script.google.com (NO use el del Registro de manejo), pegue este archivo y guarde.
 *   b) Elija la función "probarConfiguracion" > Ejecutar y acepte los permisos (Drive, Sheets, Gmail). Crea la carpeta
 *      y la planilla de la base de datos con las hojas y los catálogos iniciales, y escribe en el registro de ejecución
 *      la URL de la planilla.
 *   c) Ejecute también "instalarDisparadores" (recalcula cada 30 minutos).
 *   d) Implementar > Nueva implementación > "Aplicación web" (Ejecutar como: Yo · Acceso: Cualquier persona).
 *      Copie la URL /exec y póngala en config.json (o en DEFAULT_ENDPOINT dentro de index.html).
 *   e) En el registro de ejecución de "probarConfiguracion" aparece el CÓDIGO MAESTRO (6 números): guárdelo en un lugar
 *      seguro. Con él se entra como Administración para cargar a los gerentes.
 * Actualización: pegue el archivo nuevo, guarde, ejecute "probarConfiguracion" (agrega columnas y hojas nuevas sin
 *   tocar los datos) y luego Implementar > Administrar implementaciones > lápiz > Versión "Nueva versión" > Implementar.
 */
const VERSION = '1.2.0';
const CONFIG = {
  FOLDER_ID: '',          // vacío = se crea sola en "Mi unidad" la carpeta CARPETA_NOMBRE (o se usa la que ya existe)
  CARPETA_NOMBRE: 'Maquinaria y combustible Ypoti (base de datos)',
  SHEET_ID: '',           // vacío = la planilla se crea sola dentro de la carpeta la primera vez
  SHEET_NAME: 'Maquinaria y combustible (base de datos)',
  // El código maestro (6 números, entra como "Administración") NO va en el código: queda en Propiedades del script › CLAVE_MAESTRA.
  // probarConfiguracion lo crea solo la primera vez y lo muestra en el registro de ejecución.
  MAX_FALLOS: 8,          // código incorrecto: 8 intentos en 15 minutos desde un teléfono lo bloquean 15 minutos
  MAX_FALLOS_TOTAL: 40,   // y 40 en total (todos los teléfonos) bloquean todos los ingresos 15 minutos (para que no se pueda adivinar un código)
  ZONA: 'America/Asuncion',
  EMPRESA: 'Rural Bioenergía S.A. · Ypoti',
  MAIL_COPIA: 'lucasmoller@ypoti.com', // recibe copia de los avisos de solicitudes y fallas (vacío = sin copia)
  ESTANCIA_ALMACEN: 'Ypoti',           // el almacén (depósito de repuestos) existe solo en esta estancia
  MODULO_ALMACEN: false,               // false = el módulo de almacén queda oculto en el app (se retoma en una versión posterior)
  ESTANCIAS_INICIALES: ['Ypoti', 'Ybypora', 'Cafetalera', 'La Esperanza', 'Santa Clara', 'Lusipar', 'Oro Verde', 'Bella Vista', 'Cerro Memby']
};

/* ===================== Esquema de la base de datos (una hoja por tabla) ===================== */
// Si una hoja ya existe con menos columnas, las nuevas se agregan al final automáticamente.
const CAB = {
  // ---- catálogos ----
  usuarios: ['id', 'nombre', 'documento', 'telefono', 'correo', 'roles', 'estancias', 'prestador_id', 'costo_hora', 'pin_hash', 'pin_version', 'activo', 'notas', 'creado_en', 'creado_por', 'actualizado_en', 'estado', 'pedido_en', 'pedido_dispositivo', 'decidido_por'],
  estancias: ['nombre', 'codigo_senacsa', 'tiene_almacen', 'activo', 'orden'],
  maquinas: ['id', 'codigo', 'nombre', 'tipo', 'marca', 'modelo', 'anio', 'chapa_serie', 'estancia', 'propietario', 'prestador_id', 'unidad', 'capacidad_tanque_l', 'consumo_ref', 'valor_compra', 'valor_residual', 'vida_util_h', 'lectura_actual', 'lectura_fecha', 'bloqueada', 'motivo_bloqueo', 'activo', 'notas', 'creado_en', 'actualizado_en', 'ult_despacho_fecha', 'ult_despacho_hora', 'ult_despacho_litros', 'ult_despacho_lectura'],
  proyectos: ['id', 'codigo', 'nombre', 'estancia', 'descripcion', 'centro_costo', 'servicio_id', 'pastos', 'responsable_id', 'fecha_inicio', 'fecha_fin', 'estado', 'presupuesto_horas', 'presupuesto_litros', 'presupuesto_gs', 'meta_avance', 'unidad_avance', 'notas', 'creado_en', 'creado_por', 'actualizado_en'],
  asignaciones: ['id', 'proyecto_id', 'operador_id', 'maquina_id', 'servicio_id', 'pasto_id', 'desde', 'hasta', 'horas_previstas', 'activo', 'notas', 'creado_en', 'actualizado_en'],
  servicios: ['id', 'nombre', 'unidad_avance', 'centro_costo', 'activo', 'orden'],
  pastos: ['id', 'estancia', 'nombre', 'tipo', 'superficie_ha', 'activo', 'notas'],
  tanques: ['id', 'estancia', 'nombre', 'tipo', 'capacidad_l', 'tiene_totalizador', 'aforo', 'encargados', 'totalizador_actual', 'totalizador_ts', 'stock_teorico', 'activo', 'notas'],
  prestadores: ['id', 'nombre', 'ruc', 'contacto', 'telefono', 'correo', 'activo', 'notas', 'creado_en'],
  vales: ['id', 'codigo', 'prestador_id', 'prestador', 'tipo', 'litros', 'precio_litro', 'total_gs', 'pagado', 'recibo', 'fecha', 'vence', 'estancias', 'estancia_emisora', 'token', 'token_hash', 'control_hash', 'litros_usados', 'saldo', 'estado', 'notas', 'creado_por', 'creado_en', 'anulado_por', 'anulado_en', 'motivo_anulacion'],
  articulos: ['id', 'codigo', 'codigo_barras', 'categoria', 'tipo', 'medida', 'material', 'marca', 'nro_parte', 'descripcion', 'unidad', 'ubicacion', 'stock_minimo', 'cantidad_reposicion', 'stock', 'costo_promedio', 'estancia', 'estado', 'fusionado_en', 'maquinas', 'notas', 'creado_por', 'creado_en', 'actualizado_en'],
  planes_mant: ['id', 'maquina_id', 'tarea', 'intervalo_h', 'intervalo_dias', 'ultima_lectura', 'ultima_fecha', 'articulos_sugeridos', 'activo', 'notas'],
  parametros: ['clave', 'valor', 'descripcion'],
  // ---- eventos de campo ----
  partes: ['id', 'version', 'estado', 'fecha', 'estancia', 'operador_id', 'operador', 'maquina_id', 'maquina', 'unidad', 'lectura_inicio', 'lectura_fin', 'uso', 'hora_inicio', 'hora_fin', 'horas_reloj', 'descanso_min', 'horas_operador', 'litros_declarados', 'cantidad_tramos', 'falla', 'falla_desc', 'observaciones', 'avisos', 'url_fotos', 'cargado_por', 'dispositivo', 'app_version', 'creado_en', 'cerrado_en', 'recibido_en', 'actualizado_en', 'tramo_actual', 'tramos_json', 'datos_json'],
  tramos: ['parte_id', 'nro', 'version', 'fecha', 'estancia', 'operador_id', 'operador', 'maquina_id', 'maquina', 'proyecto_id', 'proyecto', 'servicio_id', 'servicio', 'pasto_id', 'lugar', 'centro_costo', 'lectura_desde', 'lectura_hasta', 'uso', 'hora_desde', 'hora_hasta', 'horas_reloj', 'avance', 'unidad_avance', 'abierto'],
  cargas_operador: ['parte_id', 'nro', 'version', 'fecha', 'hora', 'estancia', 'operador_id', 'maquina_id', 'maquina', 'lectura', 'litros', 'lleno', 'tanque_id', 'lugar', 'despacho_id', 'confirmada'],
  // Cada vez que quien recibe combustible lee el QR del comprobante del encargado (confirmación de los dos lados)
  confirmaciones: ['id', 'despacho_id', 'pedido_id', 'fecha', 'hora', 'estancia', 'tanque_id', 'tanque', 'encargado_id', 'encargado', 'receptor_id', 'receptor', 'tipo_receptor', 'destino_ref', 'litros_comprobante', 'litros_receptor', 'conforme', 'motivo', 'lleno', 'lectura', 'parte_id', 'firma', 'estado', 'avisos', 'dispositivo', 'app_version', 'creado_en', 'recibido_en'],
  despachos: ['id', 'fecha', 'hora', 'ts', 'estancia', 'tanque_id', 'tanque', 'encargado_id', 'encargado', 'destino', 'maquina_id', 'maquina', 'operador_id', 'operador', 'prestador_id', 'prestador', 'vale_id', 'vale_codigo', 'tanque_destino_id', 'receptor', 'chapa', 'lectura', 'totalizador_antes', 'totalizador_despues', 'litros', 'precio_litro', 'total_gs', 'validacion', 'parte_id', 'proyecto_id', 'estado', 'avisos', 'revisado_por', 'revisado_en', 'comentario_revision', 'url_foto', 'observaciones', 'dispositivo', 'app_version', 'creado_en', 'recibido_en', 'pedido_id', 'receptor_id', 'firma_pedido', 'confirmacion', 'confirmado_por', 'confirmado_en', 'litros_receptor', 'motivo_sin_qr'],
  lecturas_bomba: ['id', 'fecha', 'hora', 'ts', 'estancia', 'tanque_id', 'tanque', 'tipo', 'totalizador', 'regla_cm', 'litros_medidos', 'encargado_id', 'encargado', 'estado', 'avisos', 'url_foto', 'observaciones', 'creado_en', 'recibido_en'],
  descargas: ['id', 'fecha', 'hora', 'ts', 'estancia', 'tanque_id', 'tanque', 'origen', 'proveedor', 'tanque_origen_id', 'documento', 'litros_documento', 'medicion_antes', 'medicion_despues', 'litros_medidos', 'litros', 'precio_litro', 'total_gs', 'chapa', 'chofer', 'encargado_id', 'encargado', 'despacho_id', 'estado', 'avisos', 'url_foto', 'observaciones', 'creado_en', 'recibido_en'],
  movimientos: ['id', 'evento_id', 'fecha', 'hora', 'ts', 'estancia', 'tipo', 'subtipo', 'articulo_id', 'codigo', 'descripcion', 'cantidad', 'unidad', 'costo_unitario', 'total', 'stock_resultante', 'destino_tipo', 'destino_id', 'destino', 'mantenimiento_id', 'solicitud_id', 'documento', 'proveedor', 'marca', 'entregado_a', 'responsable_id', 'responsable', 'estado', 'url_foto', 'observaciones', 'creado_en', 'recibido_en'],
  solicitudes: ['id', 'codigo', 'tipo', 'estado', 'estancia', 'solicitante_id', 'solicitante', 'destino_tipo', 'destino_id', 'destino', 'motivo', 'urgencia', 'items_json', 'resumen', 'creado_en', 'recibido_en', 'decidido_por', 'decidido_en', 'comentario', 'atendido_en', 'atendido_por'],
  mantenimientos: ['id', 'fecha', 'ts', 'estancia', 'maquina_id', 'maquina', 'lectura', 'tipo', 'tareas', 'tareas_desc', 'descripcion', 'taller', 'proveedor', 'costo_repuestos_ext', 'costo_mano_obra', 'costo_servicios', 'costo_total_ext', 'horas_parada', 'falla_id', 'responsable_id', 'responsable', 'estado', 'url_fotos', 'observaciones', 'creado_en', 'recibido_en'],
  fallas: ['id', 'fecha', 'hora', 'estancia', 'maquina_id', 'maquina', 'operador_id', 'operador', 'parte_id', 'descripcion', 'gravedad', 'url_foto', 'estado', 'mantenimiento_id', 'revisado_por', 'revisado_en', 'comentario', 'creado_en', 'recibido_en'],
  alertas: ['id', 'clave', 'fecha', 'tipo', 'gravedad', 'estancia', 'ref_tipo', 'ref_id', 'titulo', 'detalle', 'estado', 'revisado_por', 'revisado_en', 'comentario', 'creado_en'],
  fotos: ['ref_tipo', 'ref_id', 'tipo_foto', 'url', 'creado_en'],
  // Copia en la nube de lo que cada persona está escribiendo (formularios sin terminar, QR de carga mostrados): vuelve sola en otro teléfono
  borradores: ['usuario_id', 'usuario', 'clave', 'pantalla', 'titulo', 'json', 'actualizado_en', 'dispositivo', 'borrado'],
  log: ['fecha', 'usuario_id', 'usuario', 'accion', 'entidad', 'ref_id', 'detalle', 'app_version'],
  // ---- hojas derivadas (las reescribe recalcular) ----
  rateio: ['mes', 'fecha', 'estancia', 'origen', 'proyecto_id', 'proyecto', 'centro_costo', 'servicio', 'lugar', 'maquina_id', 'maquina', 'operador_id', 'operador', 'uso_maquina', 'horas_maquina', 'horas_operador', 'l_h_mes', 'litros', 'costo_litro', 'costo_combustible', 'costo_hora_maquina', 'costo_maquina', 'costo_hora_operador', 'costo_operador', 'costo_almacen', 'costo_total', 'avance', 'unidad_avance', 'parte_id', 'tramo'],
  conciliacion: ['fecha', 'estancia', 'tanque_id', 'tanque', 'apertura', 'cierre', 'bomba_l', 'despachos_l', 'cantidad_despachos', 'diferencia_bomba_l', 'saltos_l', 'descargas_l', 'stock_teorico', 'medido_l', 'diferencia_stock_l', 'estado'],
  costos_maquina: ['mes', 'maquina_id', 'maquina', 'estancia', 'unidad', 'horas', 'uso', 'litros', 'l_h', 'l_100km', 'costo_litro', 'costo_combustible', 'costo_repuestos', 'costo_mantenimiento', 'depreciacion', 'costo_total', 'costo_hora', 'costo_hora_sin_combustible']
};
const DERIVADAS = { rateio: 1, conciliacion: 1, costos_maquina: 1 };
const COLS_FECHA = { fecha: 1, vence: 1, desde: 1, hasta: 1, fecha_inicio: 1, fecha_fin: 1, ultima_fecha: 1, lectura_fecha: 1 };
const COLS_HORA = { hora: 1, hora_inicio: 1, hora_fin: 1, hora_desde: 1, hora_hasta: 1 };
const ROLES = ['operador', 'combustible', 'almacen', 'mecanico', 'gerente', 'prestador', 'admin'];

const PARAMETROS_INICIALES = [
  ['moneda', 'Gs.', 'Moneda de los costos y precios'],
  ['precio_venta_litro', '0', 'Precio por litro de diésel para vender a prestadores (precarga el vale)'],
  ['costo_litro_ref', '0', 'Costo por litro si en el mes no hubo descargas con precio (se usa para el costo del combustible)'],
  ['tolerancia_bomba_l', '2', 'Litros de diferencia aceptados entre lecturas del totalizador y despachos'],
  ['tolerancia_stock_pct', '1', '% de la capacidad del tanque aceptado entre stock teórico y medición con regla'],
  ['tolerancia_descarga_pct', '0.5', '% aceptado entre litros de la factura y litros medidos en la descarga'],
  ['tolerancia_consumo_pct', '30', '% por encima del consumo de referencia de la máquina que genera alerta'],
  ['tolerancia_lectura', '0.5', 'Horas de horómetro de salto entre partes de la misma máquina que se aceptan sin alerta'],
  ['tolerancia_lectura_km', '5', 'Km de odómetro de salto entre partes de la misma máquina (camiones, camionetas) que se aceptan sin alerta'],
  ['descanso_min', '60', 'Minutos de descanso que el parte propone por defecto'],
  ['exigir_asignacion', 'si', 'si = despacho a máquina propia sin asignación activa a un proyecto queda "por revisar"'],
  ['foto_horometro', 'no', 'si = el parte exige foto del horómetro al empezar y al terminar'],
  ['foto_despacho', 'no', 'si = el despacho exige foto del totalizador / display'],
  ['horas_confirmacion', '24', 'Horas que puede quedar una carga sin que el receptor lea el comprobante del encargado antes de generar alerta'],
  ['avisos_correo', 'si', 'si = el servidor manda correo al gerente por cada solicitud nueva y por fallas que paran la máquina']
];
const SERVICIOS_INICIALES = [
  ['Rastreada', 'ha', 'Pasturas'], ['Siembra', 'ha', 'Pasturas'], ['Fumigación / pulverización', 'ha', 'Pasturas'], ['Fertilización / encalado', 'ha', 'Pasturas'],
  ['Desmalezado / rozado', 'ha', 'Pasturas'], ['Destronque / limpieza de monte', 'ha', 'Infraestructura'], ['Arreglo de caminos', 'km', 'Infraestructura'],
  ['Tajamar (limpieza / construcción)', 'ninguna', 'Infraestructura'], ['Alambrado', 'km', 'Infraestructura'], ['Construcción / obras', 'ninguna', 'Infraestructura'],
  ['Carga y distribución de ración', 'viajes', 'Confinamiento'], ['Limpieza de corrales', 'ninguna', 'Confinamiento'], ['Ensilaje / cosecha de forraje', 't', 'Confinamiento'],
  ['Transporte / fletes', 'viajes', 'Logística'], ['Traslado de la máquina', 'ninguna', 'Logística'], ['Mantenimiento / taller', 'ninguna', 'Mantenimiento'], ['Otros', 'ninguna', 'General']
];

/* ===================== Entrada: doPost / doGet ===================== */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ ok: false, error: 'pedido inválido (JSON)' }); }
  const tipo = String(body.tipo || '');
  const ESCRIBEN = { enviar: 1, guardar: 1, vale_nuevo: 1, vale_anular: 1, decidir: 1, revisar: 1, anular: 1, fusionar_articulo: 1, recalcular: 1, cambiar_codigo: 1, tablero: 1, decidir_codigo: 1, nube: 1 };
  const lock = LockService.getScriptLock();
  let conLock = false;
  try {
    if (tipo === 'ping') return json_({ ok: true, mensaje: 'servidor listo (v' + VERSION + ')', version: VERSION, srv: VERSION });
    if (tipo === 'lista_usuarios') return json_(listaUsuarios_());
    if (tipo === 'login') return json_(login_(body));
    if (tipo === 'pedir_codigo') { lock.waitLock(30000); conLock = true; const rp = pedirCodigo_(body); flushLog_(); return json_(rp); }
    const s = sesion_(body.token);
    if (!s.ok) return json_(s);
    const u = s.usuario;
    if (ESCRIBEN[tipo]) { lock.waitLock(30000); conLock = true; }
    let r;
    switch (tipo) {
      case 'catalogos': r = catalogos_(u, body); break;
      case 'enviar': r = enviar_(u, body); break;
      case 'guardar': r = guardar_(u, body); break;
      case 'vale_nuevo': r = valeNuevo_(u, body); break;
      case 'vale_anular': r = valeAnular_(u, body); break;
      case 'validar_vale': r = validarVale_(u, body); break;
      case 'decidir': r = decidir_(u, body); break;
      case 'revisar': r = revisar_(u, body); break;
      case 'anular': r = anular_(u, body); break;
      case 'fusionar_articulo': r = fusionarArticulo_(u, body); break;
      case 'tablero': r = tablero_(u, body); break;
      case 'consulta': r = consulta_(u, body); break;
      case 'recalcular': exigir_(esGerente_(u), 'solo el gerente o la administración pueden recalcular'); recalcular_(); r = { ok: true, mensaje: 'recalculado', recalculado_en: ahoraIso_() }; break;
      case 'cambiar_codigo': r = cambiarCodigo_(u, body); break;
      case 'nube': r = nube_(u, body); break;
      case 'leer_foto': r = leerFoto_(u, body); break;
      case 'decidir_codigo': r = decidirCodigo_(u, body); break;
      default: r = { ok: false, error: 'pedido desconocido: ' + tipo };
    }
    flushLog_();
    if (r && typeof r === 'object') { r.srv = VERSION; if (r.ok && ESCRIBEN[tipo] && tipo !== 'nube' && tipo !== 'tablero') marcarCambio_(); }
    return json_(r);
  } catch (err) {
    try { flushLog_(); } catch (x) {}
    return json_({ ok: false, error: String((err && err.message) || err), rechazo: !!(err && err.rechazo) });
  } finally {
    if (conLock) { try { lock.releaseLock(); } catch (x) {} }
  }
}

function doGet(e) {
  return json_({ ok: true, mensaje: 'Servidor Maquinaria y combustible v' + VERSION + ' listo (use POST desde el app)' });
}

/* ===================== Planilla, carpeta y tablas ===================== */
let SS_ = null, TZ_ = null, TABLAS_ = {}, LOG_ = [], CARPETAS_ = {}, HOJAS_ = {}, COLAS_ = {}; // cachés de cada ejecución  // se reinician en cada pedido (cada ejecución de Apps Script)
function props_() { return PropertiesService.getScriptProperties(); }
function carpeta_() {
  if (CARPETAS_.raiz) return CARPETAS_.raiz;
  if (CONFIG.FOLDER_ID) return (CARPETAS_.raiz = DriveApp.getFolderById(CONFIG.FOLDER_ID));
  const p = props_(); const id = p.getProperty('FOLDER_ID');
  if (id) { try { return (CARPETAS_.raiz = DriveApp.getFolderById(id)); } catch (e) {} }
  const it = DriveApp.getFoldersByName(CONFIG.CARPETA_NOMBRE);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.CARPETA_NOMBRE);
  p.setProperty('FOLDER_ID', f.getId());
  return (CARPETAS_.raiz = f);
}
function subcarpeta_(padre, nombre) { const k = padre.getId() + '/' + nombre; if (CARPETAS_[k]) return CARPETAS_[k]; const it = padre.getFoldersByName(nombre); return (CARPETAS_[k] = it.hasNext() ? it.next() : padre.createFolder(nombre)); }
function planilla_() {
  if (SS_) return SS_;
  if (CONFIG.SHEET_ID) { SS_ = SpreadsheetApp.openById(CONFIG.SHEET_ID); }
  else {
    const p = props_(); let id = p.getProperty('SHEET_ID');
    if (id) { try { SS_ = SpreadsheetApp.openById(id); } catch (e) { SS_ = null; } }
    if (!SS_) {
      const folder = carpeta_(); const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (it.hasNext() && !SS_) { const f = it.next(); if (f.getName() === CONFIG.SHEET_NAME) SS_ = SpreadsheetApp.openById(f.getId()); }
      if (!SS_) {
        SS_ = SpreadsheetApp.create(CONFIG.SHEET_NAME);
        try { DriveApp.getFileById(SS_.getId()).moveTo(folder); } catch (e) { Logger.log('AVISO: no se pudo mover la planilla a la carpeta: ' + e); }
        try { SS_.setSpreadsheetTimeZone(CONFIG.ZONA); } catch (e) {}
      }
      p.setProperty('SHEET_ID', SS_.getId());
    }
  }
  return SS_;
}
function tz_() { if (TZ_) return TZ_; try { TZ_ = planilla_().getSpreadsheetTimeZone() || CONFIG.ZONA; } catch (e) { TZ_ = CONFIG.ZONA; } return TZ_; }
function hoja_(nombre) {
  if (HOJAS_[nombre]) return HOJAS_[nombre];
  const ss = planilla_(); let h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre); h.getRange(1, 1, 1, CAB[nombre].length).setValues([CAB[nombre]]); h.setFrozenRows(1);
    try { h.getRange(1, 1, 1, CAB[nombre].length).setFontWeight('bold'); } catch (e) {}
    const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja1'); if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (e) {} }
  }
  return (HOJAS_[nombre] = h);
}
// Lee la fila 1 y agrega al final las columnas que falten (así una planilla vieja sigue sirviendo).
function cabecera_(h, esperada) {
  let cab = h.getLastColumn() > 0 ? h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String) : [];
  while (cab.length && cab[cab.length - 1] === '') cab.pop();
  const faltan = esperada.filter(k => cab.indexOf(k) < 0);
  if (faltan.length) { h.getRange(1, cab.length + 1, 1, faltan.length).setValues([faltan]); cab = cab.concat(faltan); }
  return cab;
}
let FMT_ = {};  // memo por ejecución: las fechas se repiten mucho (mismo día en muchas filas)
function valorDe_(x) {
  if (x instanceof Date) {
    const k = x.getTime(); if (FMT_[k] !== undefined) return FMT_[k];
    let r;
    if (x.getFullYear() < 1901) r = Utilities.formatDate(x, tz_(), 'HH:mm');
    else { const s = Utilities.formatDate(x, tz_(), "yyyy-MM-dd'T'HH:mm:ss"); r = s.slice(11) === '00:00:00' ? s.slice(0, 10) : s; }
    return (FMT_[k] = r);
  }
  return x;
}
function celda_(col, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'si' : 'no';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (s === '') return '';
  if (COLS_FECHA[col] && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // las fechas quedan como fecha de la planilla
  // texto que la planilla convertiría (números con cero adelante, fechas, horas, fórmulas): se guarda como texto
  if (COLS_HORA[col] || /^[=+\-@]/.test(s) || /^\d+([.,]\d+)?$/.test(s) || /^\d{1,4}[\/\-.]\d{1,2}([\/\-.]\d{1,4})?$/.test(s) || /^\d{1,2}:\d{2}/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s)) return "'" + s;
  return s;
}
function T_(nombre) {
  if (TABLAS_[nombre]) return TABLAS_[nombre];
  const h = hoja_(nombre); const cab = cabecera_(h, CAB[nombre]); const n = h.getLastRow();
  const vals = n > 1 ? h.getRange(2, 1, n - 1, cab.length).getValues() : [];
  const filas = [];
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i]; let vacia = true; const o = {};
    for (let j = 0; j < cab.length; j++) { const x = valorDe_(r[j]); o[cab[j]] = x; if (x !== '' && x !== null) vacia = false; }
    if (vacia) continue;
    Object.defineProperty(o, '_n', { value: i + 2, writable: true, enumerable: false });
    filas.push(o);
  }
  return (TABLAS_[nombre] = { nombre: nombre, h: h, cab: cab, filas: filas });
}
function filas_(nombre) { return T_(nombre).filas; }
// Cabecera sin leer las filas (para escribir en hojas grandes sin cargarlas enteras)
let CABS_ = {};
function cab_(nombre) { if (TABLAS_[nombre]) return TABLAS_[nombre].cab; if (!CABS_[nombre]) CABS_[nombre] = cabecera_(hoja_(nombre), CAB[nombre]); return CABS_[nombre]; }
// Últimas n filas de una hoja (las hojas de eventos crecen siempre hacia abajo: lo reciente está al final)
function cola_(nombre, n) {
  if (TABLAS_[nombre]) return TABLAS_[nombre].filas.slice(-n);
  if (COLAS_[nombre] && COLAS_[nombre].n >= n) return COLAS_[nombre].filas.slice(-n);
  const h = hoja_(nombre); const cab = cab_(nombre); const last = h.getLastRow(); if (last < 2) return [];
  const ini = Math.max(2, last - n + 1); const vals = h.getRange(ini, 1, last - ini + 1, cab.length).getValues(); const out = [];
  vals.forEach((r, i) => { const o = {}; let vacia = true; cab.forEach((k, j) => { const x = valorDe_(r[j]); o[k] = x; if (x !== '' && x !== null) vacia = false; }); if (vacia) return; Object.defineProperty(o, '_n', { value: ini + i, writable: true, enumerable: false }); out.push(o); });
  COLAS_[nombre] = { n: n, filas: out };
  return out.slice();
}
// Busca por id primero en las últimas filas; si no está y hace falta, en toda la hoja
function buscarId_(nombre, id, n, completo) { const s = String(id); const c = cola_(nombre, n || 4000); for (let i = c.length - 1; i >= 0; i--) if (String(c[i].id) === s) return c[i]; return completo ? porId_(nombre, id) : null; }
function borrarDondeCola_(nombre, pred, n) {
  const h = hoja_(nombre); const nros = cola_(nombre, n || 4000).filter(pred).map(f => f._n).sort((a, b) => b - a);
  let i = 0; while (i < nros.length) { let j = i; while (j + 1 < nros.length && nros[j + 1] === nros[j] - 1) j++; h.deleteRows(nros[j], j - i + 1); i = j + 1; }
  if (nros.length) { delete TABLAS_[nombre]; delete COLAS_[nombre]; } return nros.length;
}
function porId_(nombre, id, col) { const k = col || 'id'; if (id === '' || id === null || id === undefined) return null; const s = String(id); const f = T_(nombre).filas; for (let i = 0; i < f.length; i++) if (String(f[i][k]) === s) return f[i]; return null; }
function filaValores_(t, o) { return t.cab.map(k => celda_(k, o[k])); }
function agregar_(nombre, objs) {
  if (!objs || !objs.length) return [];
  const h = hoja_(nombre); const cab = cab_(nombre); const t = { cab: cab }; const ini = Math.max(h.getLastRow(), 1) + 1;
  h.getRange(ini, 1, objs.length, cab.length).setValues(objs.map(o => filaValores_(t, o)));
  objs.forEach((o, i) => { const c = {}; cab.forEach(k => { c[k] = (o[k] === undefined || o[k] === null) ? '' : (typeof o[k] === 'boolean' ? (o[k] ? 'si' : 'no') : o[k]); }); Object.defineProperty(c, '_n', { value: ini + i, writable: true, enumerable: false }); if (TABLAS_[nombre]) TABLAS_[nombre].filas.push(c); if (COLAS_[nombre]) COLAS_[nombre].filas.push(c); objs[i] = c; });
  return objs;
}
function actualizar_(nombre, fila, cambios) {
  const cab = cab_(nombre); Object.keys(cambios).forEach(k => { fila[k] = (typeof cambios[k] === 'boolean') ? (cambios[k] ? 'si' : 'no') : cambios[k]; });
  hoja_(nombre).getRange(fila._n, 1, 1, cab.length).setValues([filaValores_({ cab: cab }, fila)]);
  return fila;
}
function borrarDonde_(nombre, pred) {
  const t = T_(nombre); const nros = t.filas.filter(pred).map(f => f._n).sort((a, b) => b - a);
  // agrupa filas consecutivas para borrar en bloques
  let i = 0; while (i < nros.length) { let j = i; while (j + 1 < nros.length && nros[j + 1] === nros[j] - 1) j++; t.h.deleteRows(nros[j], j - i + 1); i = j + 1; }
  if (nros.length) { delete TABLAS_[nombre]; delete COLAS_[nombre]; }
  return nros.length;
}
function reemplazarTodo_(nombre, objs) {
  const h = hoja_(nombre); const cab = cabecera_(h, CAB[nombre]);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, Math.max(h.getLastColumn(), cab.length)).clearContent();
  if (objs.length) { const t = { cab: cab }; h.getRange(2, 1, objs.length, cab.length).setValues(objs.map(o => filaValores_(t, o))); }
  delete TABLAS_[nombre]; delete COLAS_[nombre];
}

/* ===================== Utilidades ===================== */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function rechazo_(msg) { const e = new Error(msg); e.rechazo = true; return e; }
function exigir_(cond, msg) { if (!cond) throw rechazo_(msg); }
let AHORA_ = null;
function ahoraIso_() { const t = Math.floor(Date.now() / 1000); if (!AHORA_ || AHORA_.t !== t) AHORA_ = { t: t, s: Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm:ss") }; return AHORA_.s; }
function hoy_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function num_(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
function n0_(v) { const n = num_(v); return n === null ? 0 : n; }
function r_(n, d) { const f = Math.pow(10, d === undefined ? 2 : d); return Math.round(n * f) / f; }
function si_(v) { const s = String(v === undefined || v === null ? '' : v).toLowerCase().trim(); return s === 'si' || s === 'sí' || s === 'true' || s === '1' || s === 'yes'; }
function lista_(v) { return String(v === undefined || v === null ? '' : v).split(/[|,;]/).map(x => x.trim()).filter(Boolean); }
function txt_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 500); }
function fecha_(v) { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function hora_(v) { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
function minutos_(h) { const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function horasEntre_(h1, h2) { const a = minutos_(h1), b = minutos_(h2); if (a === null || b === null) return null; let d = b - a; if (d < 0) d += 1440; return r_(d / 60, 2); }
function ts_(fecha, hora) { return (fecha || '') + 'T' + (hora || '00:00'); }
function mes_(f) { return String(f || '').slice(0, 7); }
function nuevoId_(pref) { return pref + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function hex_(bytes) { return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function idValido_(id) { return /^[A-Za-z0-9_.:-]{6,80}$/.test(String(id || '')); }
function siguienteCodigo_(nombre, col, pref, dig) {
  let max = 0; const re = new RegExp('^' + pref + '(\\d+)$');
  filas_(nombre).forEach(f => { const m = re.exec(String(f[col] || '')); if (m) max = Math.max(max, Number(m[1])); });
  return pref + ('0000000' + (max + 1)).slice(-dig);
}
function log_(u, accion, entidad, refId, detalle, appv) { LOG_.push({ fecha: ahoraIso_(), usuario_id: u ? u.id : '', usuario: u ? u.nombre : '', accion: accion, entidad: entidad || '', ref_id: refId || '', detalle: typeof detalle === 'string' ? detalle.slice(0, 1000) : JSON.stringify(detalle || '').slice(0, 1000), app_version: appv || '' }); }
function flushLog_() { if (LOG_.length) { const l = LOG_; LOG_ = []; agregar_('log', l); } }
function parametros_() { const o = {}; PARAMETROS_INICIALES.forEach(p => o[p[0]] = p[1]); filas_('parametros').forEach(f => { if (f.clave) o[String(f.clave)] = String(f.valor); }); return o; }
function param_(k) { return parametros_()[k]; }
function paramNum_(k, def) { const n = num_(param_(k)); return n === null ? def : n; }
function nombreUsuario_(id) { if (id === '__admin') return 'Administración'; const u = porId_('usuarios', id); return u ? String(u.nombre) : ''; }
function nombreMaquina_(m) { return m ? (String(m.codigo || '') + (m.nombre ? ' · ' + m.nombre : '')) : ''; }

/* ===================== Permisos ===================== */
function tiene_(u, rol) { return !!u && (u.admin || u.roles.indexOf(rol) >= 0); }
function puedeEst_(u, est) { return !!u && (u.admin || u.estancias.indexOf('*') >= 0 || u.estancias.indexOf(String(est || '')) >= 0); }
function esGerente_(u) { return !!u && (u.admin || u.roles.indexOf('gerente') >= 0); }
function gerenteDe_(u, est) { return !!u && (u.admin || (u.roles.indexOf('gerente') >= 0 && puedeEst_(u, est))); }
function estanciasDe_(u) { const todas = filas_('estancias').filter(e => si_(e.activo)).map(e => String(e.nombre)); return (u.admin || u.estancias.indexOf('*') >= 0) ? todas : todas.filter(e => u.estancias.indexOf(e) >= 0); }

/* ===================== Código personal, token y login ===================== */
// Con 4 números hay 10.000 combinaciones: el servidor cuenta los intentos fallidos por persona y bloquea 15 minutos.
// El código nunca se guarda en el teléfono ni en la planilla: la planilla guarda un HMAC con un secreto del proyecto.
function secreto_() { const p = props_(); let s = p.getProperty('SECRETO'); if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRETO', s); } return s; }
function hmac_(s) { return Utilities.computeHmacSha256Signature(s, secreto_()); }
// Código personal de 6 números: identifica a la persona (no hay lista de usuarios en el app). Se guarda solo su HMAC (columna pin_hash).
function hashCodigo_(c) { return hex_(hmac_('codigo|' + String(c))); }
const CODIGOS_FACILES_ = /^(\d)\1{5}$|^(012345|123456|234567|345678|456789|987654|876543|765432|654321|543210)$/;
// ---- Firma de cada persona para los QR de combustible ----
// La clave de firma solo la conocen el servidor y el teléfono de esa persona (la recibe al entrar con su código).
// Así nadie puede fabricar el QR de otro: ni el encargado el del operador, ni el operador el comprobante del encargado.
function firma_(id, v) { return hex_(hmac_('firma|' + id + '|' + v)); }
function versionFirma_(id) { if (id === '__admin') return versionMaestra_(); const f = porId_('usuarios', id); return f ? String(f.pin_version || '1') : ''; }
function macQR_(clave, msg) { return hex_(Utilities.computeHmacSha256Signature(String(msg), String(clave))).slice(0, 16); }
// Pedido de carga (lo muestra quien recibe):   YPM1|P|pedido|persona|versión|máquina|horómetro|minuto|firma
// Pedido con vale (prestador):                  YPM1|PV|pedido|persona|versión|token del vale|minuto|firma
// Comprobante (lo muestra el encargado):        YPM1|R|pedido|despacho|encargado|versión|litros|tanque|destino|minuto|firma
function leerQRFirmado_(txt) {
  const s = String(txt || '').trim(); const p = s.split('|'); if (p[0] !== 'YPM1' || p.length < 4) return null;
  const mac = p[p.length - 1]; const msg = s.slice(0, s.length - mac.length - 1);
  if (p[1] === 'P' && p.length === 9) return { tipo: 'P', pid: p[2], uid: p[3], kv: p[4], maquina_id: p[5], lectura: num_(p[6]), tmin: Number(p[7]), mac: mac, msg: msg };
  if (p[1] === 'PV' && p.length === 8) return { tipo: 'PV', pid: p[2], uid: p[3], kv: p[4], token: p[5], tmin: Number(p[6]), mac: mac, msg: msg };
  if (p[1] === 'R' && p.length === 11) return { tipo: 'R', pid: p[2] === '-' ? '' : p[2], did: p[3], eid: p[4], kv: p[5], litros: num_(p[6]), tanque_id: p[7], ref: p[8], tmin: Number(p[9]), mac: mac, msg: msg };
  return null;
}
function firmaValida_(q, uid) {
  if (!q || !uid || !q.kv || !q.mac) return false;
  if (uid === '__admin') { if (String(q.kv) !== versionMaestra_()) return false; }
  else { const act = Number(versionFirma_(uid)); const kv = Number(q.kv); if (!(kv >= 1 && kv <= act)) return false; }
  return macQR_(firma_(uid, q.kv), q.msg) === String(q.mac).toLowerCase();
}
function claveMaestra_() { return String(props_().getProperty('CLAVE_MAESTRA') || ''); }
function versionMaestra_() { return sha256_('maestra|' + claveMaestra_()).slice(0, 10); }
function cache_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }
function bloqueado_(k) { const c = cache_(); return !!c && Number(c.get('fallos_' + k) || 0) >= (CONFIG.MAX_FALLOS || 8); }
function registrarFallo_(k) { const c = cache_(); if (!c) return; const n = Number(c.get('fallos_' + k) || 0) + 1; c.put('fallos_' + k, String(n), 900); }
function limpiarFallos_(k) { const c = cache_(); if (c) try { c.remove('fallos_' + k); } catch (e) {} }
function token_(id, v) {
  const p = Utilities.base64EncodeWebSafe(JSON.stringify({ u: id, v: String(v), t: Date.now() })).replace(/=+$/, '');
  return p + '.' + Utilities.base64EncodeWebSafe(hmac_(p)).replace(/=+$/, '');
}
function usuarioAdmin_() { return { id: '__admin', nombre: 'Administración', roles: ROLES.slice(), estancias: ['*'], admin: true, prestador_id: '' }; }
function usuarioDe_(f) { return { id: String(f.id), nombre: String(f.nombre), roles: lista_(f.roles), estancias: lista_(f.estancias), admin: lista_(f.roles).indexOf('admin') >= 0, prestador_id: String(f.prestador_id || ''), correo: String(f.correo || '') }; }
function sesion_(tok) {
  const t = String(tok || ''); const i = t.indexOf('.');
  if (i < 10) return { ok: false, error: 'sesión inválida: entre de nuevo con su código', sesion_invalida: true };
  const p = t.slice(0, i), firma = t.slice(i + 1);
  if (Utilities.base64EncodeWebSafe(hmac_(p)).replace(/=+$/, '') !== firma) return { ok: false, error: 'sesión inválida: entre de nuevo con su código', sesion_invalida: true };
  let d = null; try { d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p + '==='.slice((p.length + 3) % 4))).getDataAsString()); } catch (e) { d = null; }
  if (!d || !d.u) return { ok: false, error: 'sesión inválida', sesion_invalida: true };
  if (d.u === '__admin') { if (String(d.v) !== versionMaestra_()) return { ok: false, error: 'la clave maestra cambió: entre de nuevo', sesion_invalida: true }; return { ok: true, usuario: usuarioAdmin_() }; }
  const f = porId_('usuarios', d.u);
  if (!f || !si_(f.activo)) return { ok: false, error: 'usuario inactivo o inexistente: hable con su gerente', sesion_invalida: true };
  if (String(d.v) !== String(f.pin_version || '1')) return { ok: false, error: 'su código cambió: entre de nuevo con el código nuevo', sesion_invalida: true };
  if (f.estado && String(f.estado) !== 'aprobado') return { ok: false, error: 'su acceso está ' + f.estado + ': hable con su gerente', sesion_invalida: true };
  return { ok: true, usuario: usuarioDe_(f) };
}
// Para "pedir mi código": solo la lista de estancias (el app ya no muestra la lista de personas).
function listaUsuarios_() {
  return { ok: true, estancias: filas_('estancias').filter(e => si_(e.activo)).sort((a, b) => n0_(a.orden) - n0_(b.orden)).map(e => String(e.nombre)), version: VERSION, srv: VERSION };
}
function fallos_(k) { const c = cache_(); return c ? Number(c.get('fallos_' + k) || 0) : 0; }
// Ingreso con el código personal de 6 números (o el código maestro de Propiedades del script = Administración)
function login_(b) {
  const c = String(b.codigo || '').trim(); const disp = txt_(b.dispositivo, 60) || 'sin-id';
  if (bloqueado_('d_' + disp)) return { ok: false, bloqueado: true, error: 'Demasiados intentos con código incorrecto: espere 15 minutos.' };
  if (fallos_('todos') >= (CONFIG.MAX_FALLOS_TOTAL || 40)) return { ok: false, bloqueado: true, error: 'Demasiados intentos con código incorrecto en el sistema: espere 15 minutos.' };
  if (!/^\d{6}$/.test(c)) return { ok: false, error: 'El código tiene 6 números.' };
  const fallo = () => { registrarFallo_('d_' + disp); registrarFallo_('todos'); return { ok: false, error: 'Código incorrecto.' }; };
  const m = claveMaestra_();
  if (m && c === m) { limpiarFallos_('d_' + disp); return { ok: true, token: token_('__admin', versionMaestra_()), usuario: usuarioAdmin_(), firma: firma_('__admin', versionMaestra_()), firma_v: versionMaestra_(), srv: VERSION }; }
  const h = hashCodigo_(c); const f = filas_('usuarios').find(x => String(x.pin_hash) === h);
  if (!f) return fallo();
  const est = String(f.estado || (si_(f.activo) ? 'aprobado' : 'bloqueado'));
  if (est === 'pendiente') return { ok: false, pendiente: true, error: 'Su código todavía no fue aprobado: avise a su gerente.' };
  if (est !== 'aprobado' || !si_(f.activo)) return { ok: false, error: est === 'rechazado' ? 'Su pedido de código fue rechazado: hable con su gerente.' : 'Código bloqueado: hable con su gerente.' };
  limpiarFallos_('d_' + disp);
  return { ok: true, token: token_(f.id, f.pin_version || '1'), usuario: usuarioDe_(f), firma: firma_(f.id, String(f.pin_version || '1')), firma_v: String(f.pin_version || '1'), srv: VERSION };
}
// "No tengo código: pedir uno": nombre, estancias, qué hace y el código que quiere. Queda pendiente hasta que el gerente lo apruebe.
function pedirCodigo_(b) {
  const disp = txt_(b.dispositivo, 60) || 'sin-id';
  if (bloqueado_('p_' + disp)) return { ok: false, error: 'Demasiados pedidos desde este teléfono: espere 15 minutos.' };
  try {
    const nombre = normTxt_(txt_(b.nombre, 120)); const c = String(b.codigo || '').trim();
    exigir_(nombre.length >= 5 && /\s/.test(nombre), 'escriba nombre y apellido');
    exigir_(/^\d{6}$/.test(c), 'el código tiene 6 números'); exigir_(!CODIGOS_FACILES_.test(c), 'elija un código menos fácil (no 111111 ni 123456)');
    const todas = filas_('estancias').filter(e => si_(e.activo)).map(e => String(e.nombre));
    const ests = (Array.isArray(b.estancias) ? b.estancias : lista_(b.estancias)).map(String).filter(e => todas.indexOf(e) >= 0); exigir_(ests.length, 'marque al menos una estancia');
    const roles = (Array.isArray(b.roles) ? b.roles : lista_(b.roles)).map(String).filter(r => ['operador', 'combustible', 'mecanico', 'prestador', 'gerente'].indexOf(r) >= 0); exigir_(roles.length, 'marque qué hace');
    const h = hashCodigo_(c); registrarFallo_('p_' + disp);
    exigir_(c !== claveMaestra_() && !filas_('usuarios').some(x => String(x.pin_hash) === h), 'ese código ya está en uso: elija otro');
    const ya = filas_('usuarios').find(x => normTxt_(x.nombre) === nombre && String(x.estado) === 'pendiente');
    const fila = { nombre: nombre, roles: roles.join('|'), estancias: ests.join('|'), telefono: txt_(b.telefono, 40), pin_hash: h, pin_version: 1, activo: 'no', estado: 'pendiente', pedido_en: ahoraIso_(), pedido_dispositivo: disp, notas: txt_(b.notas, 300), actualizado_en: ahoraIso_() };
    if (ya) actualizar_('usuarios', ya, fila); else agregar_('usuarios', [Object.assign({ id: nuevoId_('u_'), creado_en: ahoraIso_(), creado_por: 'pedido desde el app' }, fila)]);
    avisar_(ests[0], 'Pedido de código · ' + nombre, nombre + ' pidió un código para el app (' + roles.join(', ') + ' · ' + ests.join(', ') + ').\nApruébelo en el app: Personas › Pedidos de código (o en la hoja usuarios: estado = aprobado, activo = si).');
    log_({ id: '', nombre: nombre }, 'pidió código', 'usuario', '', roles.join(',') + ' · ' + ests.join(','));
    return { ok: true, mensaje: 'Pedido enviado. Cuando su gerente lo apruebe, entre con su código.', srv: VERSION };
  } catch (e) { return { ok: false, error: String(e.message || e), srv: VERSION }; }
}
// El gerente aprueba (con los papeles definitivos) o rechaza un pedido de código
function decidirCodigo_(u, b) {
  const f = porId_('usuarios', b.id); exigir_(f && String(f.estado) === 'pendiente', 'ese pedido ya no está pendiente');
  exigir_(lista_(f.estancias).some(e => gerenteDe_(u, e)), 'solo el gerente de esas estancias decide este pedido');
  const ok = b.decision === 'aprobado'; let roles = lista_(b.roles !== undefined ? b.roles : f.roles).filter(r => ROLES.indexOf(r) >= 0 && r !== 'admin');
  if (roles.indexOf('gerente') >= 0 && !u.admin) roles = roles.filter(r => r !== 'gerente');
  if (ok) exigir_(roles.length, 'elija al menos un papel');
  if (ok && roles.indexOf('prestador') >= 0) exigir_(porId_('prestadores', b.prestador_id || f.prestador_id), 'elija la empresa del prestador');
  const c = { estado: ok ? 'aprobado' : 'rechazado', activo: ok ? 'si' : 'no', decidido_por: u.nombre, actualizado_en: ahoraIso_() };
  if (ok) { c.roles = roles.join('|'); if (b.prestador_id) c.prestador_id = txt_(b.prestador_id, 40); if (num_(b.costo_hora) !== null) c.costo_hora = num_(b.costo_hora); }
  actualizar_('usuarios', f, c); log_(u, 'código ' + c.estado, 'usuario', f.id, f.nombre);
  return { ok: true, estado: c.estado };
}
function cambiarCodigo_(u, b) {
  exigir_(!u.admin, 'el código maestro se cambia en Propiedades del script (CLAVE_MAESTRA)');
  const f = porId_('usuarios', u.id); const nuevo = String(b.nuevo || '');
  exigir_(/^\d{6}$/.test(nuevo), 'el código nuevo debe tener 6 números'); exigir_(!CODIGOS_FACILES_.test(nuevo), 'elija un código menos fácil');
  if (bloqueado_('u_' + u.id)) return { ok: false, error: 'Demasiados intentos: espere 15 minutos.' };
  if (hashCodigo_(String(b.actual || '')) !== String(f.pin_hash)) { registrarFallo_('u_' + u.id); return { ok: false, error: 'El código actual no es correcto.' }; }
  const h = hashCodigo_(nuevo); exigir_(nuevo !== claveMaestra_() && !filas_('usuarios').some(x => String(x.pin_hash) === h && x.id !== f.id), 'ese código ya está en uso: elija otro');
  const v = n0_(f.pin_version) + 1;
  actualizar_('usuarios', f, { pin_hash: h, pin_version: v, actualizado_en: ahoraIso_() });
  log_(u, 'cambió su código', 'usuario', u.id, '');
  return { ok: true, token: token_(u.id, v), firma: firma_(u.id, String(v)), firma_v: String(v), mensaje: 'Código cambiado' };
}

/* ===================== Catálogos para el teléfono (según el papel) ===================== */
function pub_(u) { return { id: u.id, nombre: u.nombre, roles: u.roles, estancias: u.estancias, admin: !!u.admin, prestador_id: u.prestador_id || '' }; }
function sinPrivados_(o, quitar) { const c = {}; Object.keys(o).forEach(k => { if (!quitar || quitar.indexOf(k) < 0) c[k] = o[k]; }); return c; }
function catalogos_(u, b) {
  const G = esGerente_(u), C = tiene_(u, 'combustible'), A = tiene_(u, 'almacen'), M = tiene_(u, 'mecanico'), P = tiene_(u, 'prestador') && !u.admin;
  const ve = e => puedeEst_(u, e);
  const hoy = hoy_();
  const out = { ok: true, ts: ahoraIso_(), hoy: hoy, version: VERSION, usuario: pub_(u), parametros: parametros_(), estancia_almacen: CONFIG.ESTANCIA_ALMACEN, modulo_almacen: !!CONFIG.MODULO_ALMACEN };
  out.firma_v = versionFirma_(u.id); out.firma = firma_(u.id, out.firma_v); // para teléfonos que entraron antes de la versión 1.1
  out.estancias = filas_('estancias').filter(e => si_(e.activo)).sort((a, b) => n0_(a.orden) - n0_(b.orden)).map(e => ({ nombre: String(e.nombre), tiene_almacen: si_(e.tiene_almacen), codigo_senacsa: String(e.codigo_senacsa || '') }));
  out.usuarios = filas_('usuarios').filter(f => si_(f.activo) || G).map(f => {
    const o = { id: String(f.id), nombre: String(f.nombre), roles: lista_(f.roles), estancias: lista_(f.estancias), prestador_id: String(f.prestador_id || ''), activo: si_(f.activo) };
    if (G) { o.costo_hora = num_(f.costo_hora); o.documento = f.documento; o.telefono = f.telefono; o.correo = f.correo; o.notas = f.notas; o.tiene_pin = !!f.pin_hash; o.estado = String(f.estado || (si_(f.activo) ? 'aprobado' : 'bloqueado')); o.pedido_en = f.pedido_en || ''; }
    return o; });
  out.maquinas = filas_('maquinas').filter(m => si_(m.activo) || G).map(m => {
    const o = sinPrivados_(m, G ? null : ['valor_compra', 'valor_residual', 'vida_util_h', 'notas']);
    o.activo = si_(m.activo); o.bloqueada = si_(m.bloqueada); return o; });
  out.servicios = filas_('servicios').filter(s => si_(s.activo) || G).sort((a, b) => n0_(a.orden) - n0_(b.orden) || String(a.nombre).localeCompare(String(b.nombre))).map(s => Object.assign({}, s, { activo: si_(s.activo) }));
  out.pastos = filas_('pastos').filter(p => (si_(p.activo) || G) && (ve(p.estancia) || C)).map(p => Object.assign({}, p, { activo: si_(p.activo) }));
  const proys = filas_('proyectos').filter(p => ve(p.estancia));
  out.proyectos = proys.filter(p => G || ['planificado', 'en_curso', 'pausado'].indexOf(String(p.estado)) >= 0).map(p => Object.assign({}, p));
  const idsP = {}; out.proyectos.forEach(p => idsP[p.id] = 1);
  out.asignaciones = filas_('asignaciones').filter(a => idsP[a.proyecto_id] && (si_(a.activo) || G)).map(a => Object.assign({}, a, { activo: si_(a.activo) }));
  out.tanques = filas_('tanques').filter(t => si_(t.activo) || G).map(t => Object.assign({}, t, { activo: si_(t.activo), tiene_totalizador: si_(t.tiene_totalizador), encargados: lista_(t.encargados) }));
  out.prestadores = filas_('prestadores').filter(p => si_(p.activo) || G).map(p => Object.assign({}, p, { activo: si_(p.activo) }));
  // Vales: el encargado recibe solo el hash del token (no puede fabricar un QR); el gerente y el propio prestador reciben el token.
  if (G || C || P) {
    out.vales = filas_('vales').filter(v => G || (C && String(v.estado) === 'activo') || (P && String(v.prestador_id) === u.prestador_id)).map(v => {
      const o = sinPrivados_(v, (G || P) ? ['control_hash'] : ['token']);
      o.saldo = r_(n0_(v.litros) - n0_(v.litros_usados), 2); return o; });
    if (P) out.vales_despachos = cola_('despachos', 6000).filter(d => String(d.prestador_id) === u.prestador_id && String(d.estado) !== 'anulado').slice(-200).map(d => ({ id: d.id, fecha: d.fecha, hora: d.hora, vale_codigo: d.vale_codigo, vale_id: d.vale_id, litros: num_(d.litros), estancia: d.estancia, tanque: d.tanque, receptor: d.receptor, chapa: d.chapa, maquina: d.maquina, confirmacion: d.confirmacion, confirmado_por: d.confirmado_por }));
  }
  // Almacén: todos ven el catálogo (para pedir repuestos); stock y costo solo el almacenero, el mecánico y el gerente
  const verStock = G || A || M;
  const arts = !CONFIG.MODULO_ALMACEN ? [] : filas_('articulos').filter(a => ['activo', 'por_revisar'].indexOf(String(a.estado)) >= 0 || (G && String(a.estado) === 'inactivo'));
  const campos = verStock ? ['id', 'codigo', 'codigo_barras', 'categoria', 'tipo', 'medida', 'material', 'marca', 'nro_parte', 'descripcion', 'unidad', 'ubicacion', 'stock_minimo', 'cantidad_reposicion', 'stock', 'costo_promedio', 'estado', 'creado_por'] : ['id', 'codigo', 'codigo_barras', 'categoria', 'descripcion', 'unidad', 'estado', 'ubicacion'];
  out.articulos = arts.map(a => { const o = {}; campos.forEach(k => { if (a[k] !== '' && a[k] !== undefined) o[k] = a[k]; }); return o; });
  out.fusiones = {}; filas_('articulos').forEach(a => { if (String(a.estado) === 'fusionado' && a.fusionado_en) out.fusiones[a.id] = String(a.fusionado_en); });
  if (G || M) out.planes = filas_('planes_mant').filter(p => si_(p.activo)).map(p => Object.assign({}, p, { activo: true }));
  // Solicitudes: el gerente ve las de sus estancias; el almacenero, las del almacén; los demás, las propias
  const lim = new Date(Date.now() - 60 * 86400000); const limS = Utilities.formatDate(lim, tz_(), 'yyyy-MM-dd');
  out.solicitudes = filas_('solicitudes').filter(s => {
    const reciente = String(s.creado_en || '').slice(0, 10) >= limS || ['pendiente', 'aprobada', 'parcial'].indexOf(String(s.estado)) >= 0;
    if (!reciente) return false;
    if (G && ve(s.estancia)) return true;
    if (A && ve(s.estancia)) return true;
    return String(s.solicitante_id) === u.id;
  }).map(s => { const o = Object.assign({}, s); try { o.items = JSON.parse(String(s.items_json || '[]')); } catch (e) { o.items = []; } delete o.items_json; return o; });
  if (G || M) out.fallas = filas_('fallas').filter(f => ve(f.estancia) && ['abierta', 'en_reparacion'].indexOf(String(f.estado)) >= 0).map(f => Object.assign({}, f));
  // Estado de cada tanque para el encargado: último totalizador, stock teórico y si el día ya se abrió / cerró
  if (G || C) {
    const lect = cola_('lecturas_bomba', 2000).filter(l => String(l.estado) !== 'anulado');
    const ultDesp = {}; filas_('maquinas').forEach(m => { if (m.ult_despacho_fecha) ultDesp[m.id] = { ts: ts_(m.ult_despacho_fecha, m.ult_despacho_hora), fecha: m.ult_despacho_fecha, hora: m.ult_despacho_hora, litros: num_(m.ult_despacho_litros), lectura: num_(m.ult_despacho_lectura) }; });
    out.maquina_ultimo_despacho = ultDesp;
    const lim3 = Utilities.formatDate(new Date(Date.now() - 3 * 86400000), tz_(), 'yyyy-MM-dd');
    out.despachos_recientes = cola_('despachos', 1500).filter(d => String(d.fecha) >= lim3 && ve(d.estancia)).map(d => ({ id: d.id, fecha: d.fecha, hora: d.hora, tanque_id: d.tanque_id, destino: d.destino, maquina_id: d.maquina_id, vale_id: d.vale_id, pedido_id: d.pedido_id, encargado_id: d.encargado_id, operador_id: d.operador_id, maquina: d.maquina, operador: d.operador, prestador: d.prestador, vale_codigo: d.vale_codigo, receptor: d.receptor, litros: num_(d.litros), totalizador_antes: num_(d.totalizador_antes), totalizador_despues: num_(d.totalizador_despues), estado: d.estado, avisos: d.avisos, encargado: d.encargado, confirmacion: d.confirmacion, confirmado_por: d.confirmado_por, litros_receptor: num_(d.litros_receptor) }));
    out.lecturas_recientes = lect.filter(l => String(l.fecha) >= lim3 && ve(l.estancia) && String(l.estado) !== 'anulado').map(l => ({ id: l.id, fecha: l.fecha, hora: l.hora, tanque_id: l.tanque_id, tipo: l.tipo, totalizador: num_(l.totalizador), litros_medidos: num_(l.litros_medidos), encargado: l.encargado }));
    out.tanques_estado = {};
    out.tanques.forEach(t => {
      const ls = lect.filter(l => String(l.tanque_id) === String(t.id)).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      const ult = ls.length ? ls[ls.length - 1] : null; const med = ls.filter(l => num_(l.litros_medidos) !== null); const um = med.length ? med[med.length - 1] : null;
      out.tanques_estado[t.id] = { totalizador: num_(t.totalizador_actual), totalizador_ts: t.totalizador_ts, stock_teorico: num_(t.stock_teorico),
        abierto_hoy: ls.some(l => String(l.fecha) === hoy && l.tipo === 'apertura'), cerrado_hoy: ls.some(l => String(l.fecha) === hoy && l.tipo === 'cierre'),
        ultima_lectura: ult ? { fecha: ult.fecha, hora: ult.hora, tipo: ult.tipo, totalizador: num_(ult.totalizador) } : null,
        ultima_medicion: um ? { fecha: um.fecha, hora: um.hora, litros: num_(um.litros_medidos) } : null };
    });
  }
  if (G) {
    out.partes_abiertos = cola_('partes', 1500).filter(p => String(p.estado) === 'abierto' && ve(p.estancia) && String(p.fecha) >= Utilities.formatDate(new Date(Date.now() - 2 * 86400000), tz_(), 'yyyy-MM-dd')).map(p => ({ id: p.id, fecha: p.fecha, operador: p.operador, operador_id: p.operador_id, maquina: p.maquina, maquina_id: p.maquina_id, hora_inicio: p.hora_inicio, lectura_inicio: num_(p.lectura_inicio), estancia: p.estancia, actualizado_en: p.actualizado_en }));
    const abiertosRaw = {}; cola_('partes', 1500).forEach(p => { abiertosRaw[p.id] = p; });
    out.partes_abiertos.forEach(p => { try { p.tramo = JSON.parse(String(abiertosRaw[p.id].tramo_actual || 'null')); } catch (e) { p.tramo = null; } });
    const rev = cola_('despachos', 5000).filter(d => String(d.estado) === 'por_revisar' && ve(d.estancia));
    out.despachos_revisar_total = rev.length;
    out.despachos_revisar = rev.slice(-150).map(d => sinPrivados_(d, ['ts', 'dispositivo', 'app_version', 'creado_en', 'recibido_en', 'revisado_por', 'revisado_en', 'comentario_revision']));
    out.alertas = filas_('alertas').filter(a => String(a.estado) === 'abierta' && (ve(a.estancia) || !a.estancia)).slice(-300).map(a => Object.assign({}, a));
    out.recalculado_en = props_().getProperty('ULTIMO_RECALCULO') || '';
  }
  if (tiene_(u, 'operador')) {
    const lim45 = Utilities.formatDate(new Date(Date.now() - 45 * 86400000), tz_(), 'yyyy-MM-dd');
    out.mis_partes = cola_('partes', 4000).filter(p => String(p.operador_id) === u.id && String(p.fecha) >= lim45).map(p => ({ id: p.id, version: num_(p.version), estado: p.estado, fecha: p.fecha, maquina_id: p.maquina_id, maquina: p.maquina, lectura_inicio: num_(p.lectura_inicio), lectura_fin: num_(p.lectura_fin), uso: num_(p.uso), hora_inicio: p.hora_inicio, hora_fin: p.hora_fin, horas_operador: num_(p.horas_operador), litros_declarados: num_(p.litros_declarados), cantidad_tramos: num_(p.cantidad_tramos) }));
  }
  const sinTs = Object.assign({}, out); delete sinTs.ts; delete sinTs.hoy; const hash = sha256_(JSON.stringify(sinTs)).slice(0, 20); out.hash = hash;
  if (b && b.hash && b.hash === hash) return { ok: true, sin_cambios: true, hash: hash, ts: out.ts, hoy: out.hoy };
  return out;
}

/* ===================== IA: leer el horómetro o el totalizador en una foto (API de Claude) =====================
   La clave va SOLO en el servidor: Configuración del proyecto › Propiedades del script › ANTHROPIC_API_KEY
   (opcional ANTHROPIC_MODEL; por defecto claude-haiku-4-5, igual que el Registro de manejo). Sin la clave el app funciona igual. */
const IA_PROMPT = {
  horometro: 'La foto muestra el horómetro (contador de horas) o el odómetro (km) de una máquina agrícola, un camión o una camioneta. Puede ser digital o de rodillos; en los de rodillos el último dígito suele ser décimas (a veces de otro color o con fondo distinto).',
  totalizador: 'La foto muestra el totalizador de una bomba de combustible (el contador acumulado de litros que nunca vuelve a cero), no el visor de la carga actual ni el precio. Puede ser digital o de rodillos; el último dígito suele ser décimas.'
};
function leerFoto_(u, b) {
  const key = props_().getProperty('ANTHROPIC_API_KEY'); if (!key) return { ok: false, error: 'la IA no está configurada en el servidor' };
  const clase = IA_PROMPT[b.clase] ? String(b.clase) : 'horometro'; const du = String(b.imagen || ''); const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(du);
  exigir_(m && m[2].length < 7000000, 'foto inválida o demasiado grande');
  const instr = IA_PROMPT[clase] + ' La foto puede estar girada (de costado, cabeza abajo o espejada). Lea solo el número que marca el contador. Si no se lee con seguridad, no invente: use null. Responda SOLO con JSON, sin texto alrededor: {"valor": número con punto decimal o null, "texto": "los dígitos tal como se ven", "confianza": "alta" | "media" | "baja"}';
  const cuerpo = { model: props_().getProperty('ANTHROPIC_MODEL') || 'claude-haiku-4-5', max_tokens: 200, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: instr }] }] };
  let res; try { res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(cuerpo), muteHttpExceptions: true }); } catch (e) { return { ok: false, error: 'sin conexión con la IA' }; }
  if (res.getResponseCode() !== 200) return { ok: false, error: 'la IA respondió ' + res.getResponseCode() };
  let txt = ''; try { txt = (JSON.parse(res.getContentText()).content || []).map(c => c.text || '').join(''); } catch (e) {}
  const j = /\{[\s\S]*\}/.exec(txt); let o = null; try { o = j ? JSON.parse(j[0]) : null; } catch (e) { o = null; }
  if (!o) return { ok: true, valor: null, texto: '', confianza: 'baja' };
  const v = num_(o.valor); return { ok: true, valor: v !== null && v >= 0 ? v : null, texto: txt_(o.texto, 60), confianza: ['alta', 'media', 'baja'].indexOf(o.confianza) >= 0 ? o.confianza : 'media', clase: clase };
}
// Lo que leyó la IA contra lo que se escribió: si no coincide, aviso y alerta para el gerente
function controlIA_(ia, quien, refTipo, refId, est, fecha, que) {
  const av = []; if (!ia || typeof ia !== 'object') return av;
  Object.keys(ia).forEach(k => { const x = ia[k] || {}; const a = num_(x.ia), e = num_(x.escrito); if (a === null || e === null) return; if (Math.abs(a - e) <= Math.max(0.15, Math.abs(a) * 0.001)) return;
    av.push('la IA leyó ' + a + ' en la foto y se escribió ' + e);
    alerta_('ia|' + refId + '|' + k, 'lectura_distinta_ia', 'media', est, refTipo, refId, que + ' distinto de la foto', quien + ' escribió ' + e + ' y la IA leyó ' + a + ' en la foto (' + fechaTxt_(fecha) + '). Mire la foto del registro.', fecha); });
  return av;
}

/* ===================== Copia en la nube (cada minuto, con el app abierto) ===================== */
// Sube los borradores del teléfono, borra los que se terminaron y devuelve lo de esta persona que cambió en otro teléfono:
// borradores y partes abiertos (para seguir la jornada en un teléfono nuevo). cat_v avisa si hay que bajar los catálogos.
function marcarCambio_() { try { props_().setProperty('CAT_V', String(Date.now())); } catch (e) {} }
function nube_(u, b) {
  const ahora = new Date().toISOString(); const disp = txt_(b.dispositivo, 60); // marcas en ISO UTC, iguales a las del teléfono
  const mios = filas_('borradores').filter(x => String(x.usuario_id) === u.id);
  (b.subir || []).slice(0, 40).forEach(x => {
    const clave = txt_(x.clave, 120); if (!clave) return; const json = String(x.json || ''); exigir_(json.length < 45000, 'borrador demasiado grande: ' + clave);
    const prev = mios.find(y => String(y.clave) === clave); const marca = txt_(x.actualizado_en, 40) || ahora;
    if (prev && String(prev.actualizado_en) > marca && String(prev.borrado) !== 'si') return; // hay una copia más nueva (de otro teléfono)
    const fila = { usuario_id: u.id, usuario: u.nombre, clave: clave, pantalla: txt_(x.pantalla, 40), titulo: txt_(x.titulo, 200), json: json, actualizado_en: marca, dispositivo: disp, borrado: 'no' };
    if (prev) actualizar_('borradores', prev, fila); else mios.push(agregar_('borradores', [fila])[0]);
  });
  (b.borrar || []).slice(0, 60).forEach(c => { const prev = mios.find(y => String(y.clave) === String(c)); if (prev) actualizar_('borradores', prev, { json: '', borrado: 'si', actualizado_en: ahora, dispositivo: disp }); });
  const desde = txt_(b.desde, 40);
  const borradores = mios.filter(x => !desde || String(x.actualizado_en) > desde).map(x => ({ clave: String(x.clave), pantalla: String(x.pantalla || ''), titulo: String(x.titulo || ''), json: String(x.borrado) === 'si' ? '' : String(x.json || ''), actualizado_en: String(x.actualizado_en), borrado: String(x.borrado) === 'si', dispositivo: String(x.dispositivo || '') }));
  const lim = Utilities.formatDate(new Date(Date.now() - 3 * 86400000), tz_(), 'yyyy-MM-dd');
  const partes = !tiene_(u, 'operador') && !esGerente_(u) ? [] : cola_('partes', 1500).filter(p => String(p.estado) === 'abierto' && String(p.fecha) >= lim && (String(p.operador_id) === u.id || String(p.cargado_por) === u.nombre) && p.datos_json)
    .map(p => { let d = null; try { d = JSON.parse(String(p.datos_json)); } catch (e) {} return d ? { id: String(p.id), version: n0_(p.version), datos: d, actualizado_en: String(p.actualizado_en || '') } : null; }).filter(Boolean);
  return { ok: true, ts: ahora, borradores: borradores, partes_abiertos: partes, cat_v: props_().getProperty('CAT_V') || '' };
}

/* ===================== Eventos de campo (vienen en cola desde los teléfonos) ===================== */
// Cada evento trae un id (uuid del teléfono). Si llega dos veces (reintento sin señal) no se duplica.
// Los errores de validación o permiso (rechazo) no se reintentan: el teléfono los muestra para corregir.
function enviar_(u, b) {
  const evs = (b.eventos || []).slice(0, 25); const res = [];
  evs.forEach(ev => {
    try { res.push(Object.assign({ id: ev && ev.id, ok: true }, procesarEvento_(u, ev, b) || {})); }
    catch (e) { res.push({ id: ev && ev.id, ok: false, error: String((e && e.message) || e), rechazo: !!(e && e.rechazo) }); }
  });
  if (evs.length) props_().setProperty('SUCIO', '1');
  return { ok: true, resultados: res, ts: ahoraIso_() };
}
function procesarEvento_(u, ev, b) {
  exigir_(ev && idValido_(ev.id), 'evento sin id válido');
  ev.datos = ev.datos || {}; ev.app_version = txt_(b && b.app_version, 20); ev.dispositivo = txt_(b && b.dispositivo, 60);
  switch (String(ev.tipo)) {
    case 'parte': return evParte_(u, ev);
    case 'despacho': return evDespacho_(u, ev);
    case 'confirmacion': return evConfirmacion_(u, ev);
    case 'lectura': return evLectura_(u, ev);
    case 'descarga': return evDescarga_(u, ev);
    case 'movimiento': return evMovimiento_(u, ev);
    case 'solicitud': return evSolicitud_(u, ev);
    case 'articulo': return evArticulo_(u, ev);
    case 'mantenimiento': return evMantenimiento_(u, ev);
    case 'falla': return evFalla_(u, ev);
    default: throw rechazo_('tipo de evento desconocido: ' + ev.tipo);
  }
}
let CLAVES_ALERTA_ = null;
const fechaTxt_ = s => String(s || '').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
function alerta_(clave, tipo, gravedad, estancia, refTipo, refId, titulo, detalle, fecha) {
  const cl = String(clave);
  if (!CLAVES_ALERTA_) { CLAVES_ALERTA_ = {}; filas_('alertas').forEach(a => CLAVES_ALERTA_[String(a.clave)] = 1); }
  if (CLAVES_ALERTA_[cl]) return null; CLAVES_ALERTA_[cl] = 1;
  return agregar_('alertas', [{ id: nuevoId_('al_'), clave: cl, fecha: fecha || hoy_(), tipo: tipo, gravedad: gravedad, estancia: estancia || '', ref_tipo: refTipo || '', ref_id: refId || '', titulo: fechaTxt_(titulo), detalle: fechaTxt_(detalle || ''), estado: 'abierta', creado_en: ahoraIso_() }])[0];
}
function guardarFotos_(ev, refTipo, refId, estancia, fecha) {
  const fotos = ev.fotos || {}; const out = {}; const claves = Object.keys(fotos).slice(0, 12);
  if (!claves.length) return out;
  let carp = null;
  claves.forEach(k => {
    const du = fotos[k]; if (typeof du !== 'string' || du.indexOf('base64,') < 0) return;
    try {
      if (!carp) carp = subcarpeta_(subcarpeta_(subcarpeta_(carpeta_(), 'fotos'), String(estancia || 'sin_estancia')), mes_(fecha) || 'sin_fecha');
      const mime = (du.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg'; const ext = mime.indexOf('png') >= 0 ? 'png' : 'jpg';
      const f = carp.createFile(Utilities.newBlob(Utilities.base64Decode(du.split('base64,')[1]), mime, refTipo + '_' + fecha + '_' + String(refId).slice(0, 8) + '_' + k + '.' + ext));
      out[k] = f.getUrl(); agregar_('fotos', [{ ref_tipo: refTipo, ref_id: refId, tipo_foto: k, url: f.getUrl(), creado_en: ahoraIso_() }]);
    } catch (e) { Logger.log('foto ' + k + ': ' + e); }
  });
  return out;
}
function urlsFotos_(prev, nuevas) { let o = {}; try { o = prev ? JSON.parse(String(prev)) : {}; } catch (e) { o = {}; } Object.keys(nuevas || {}).forEach(k => o[k] = nuevas[k]); return Object.keys(o).length ? JSON.stringify(o) : ''; }
function avisar_(estancia, asunto, cuerpo) {
  if (!si_(param_('avisos_correo'))) return;
  const dest = filas_('usuarios').filter(f => si_(f.activo) && f.correo && lista_(f.roles).indexOf('gerente') >= 0 && (lista_(f.estancias).indexOf('*') >= 0 || lista_(f.estancias).indexOf(String(estancia)) >= 0)).map(f => String(f.correo));
  if (CONFIG.MAIL_COPIA) dest.push(CONFIG.MAIL_COPIA);
  const unicos = dest.filter((x, i) => x && dest.indexOf(x) === i); if (!unicos.length) return;
  try { MailApp.sendEmail({ to: unicos.join(','), subject: '[Maquinaria · ' + estancia + '] ' + asunto, body: cuerpo + '\n\n— ' + CONFIG.EMPRESA + ' · app Maquinaria y combustible', name: 'Maquinaria y combustible · Ypoti' }); } catch (e) { Logger.log('correo: ' + e); }
}
function proyectoActivo_(id) { const p = porId_('proyectos', id); return !!p && ['planificado', 'en_curso'].indexOf(String(p.estado)) >= 0; }
function asignacionActiva_(maquinaId, fecha) {
  return filas_('asignaciones').some(a => String(a.maquina_id) === String(maquinaId) && si_(a.activo) && (!a.desde || String(a.desde) <= fecha) && (!a.hasta || String(a.hasta) >= fecha) && proyectoActivo_(a.proyecto_id));
}
function subirLectura_(m, lectura, fecha) {
  const l = num_(lectura); if (l === null || !m) return;
  if (num_(m.lectura_actual) === null || l > n0_(m.lectura_actual)) actualizar_('maquinas', m, { lectura_actual: l, lectura_fecha: fecha });
}

// ---- Parte diario del operador (se manda abierto durante el día y cerrado al terminar; cada cambio sube la versión) ----
function evParte_(u, ev) {
  const d = ev.datos; const id = String(ev.id); const version = Math.max(1, Math.floor(n0_(ev.version) || 1));
  const est = txt_(d.estancia, 80); exigir_(est, 'falta la estancia');
  const opId = String(d.operador_id || u.id);
  exigir_(opId === u.id ? (tiene_(u, 'operador') || esGerente_(u)) : gerenteDe_(u, est), 'no puede cargar partes de otra persona');
  const m = porId_('maquinas', d.maquina_id); exigir_(m, 'máquina inexistente');
  const prev = buscarId_('partes', id, 3000, version > 1);
  if (prev && String(prev.estado) === 'anulado') throw rechazo_('este parte fue anulado por el gerente');
  if (prev && n0_(prev.version) >= version) return { duplicado: true, version: n0_(prev.version) };
  const fecha = fecha_(d.fecha); exigir_(fecha, 'fecha inválida');
  if (d.estado === 'descartado') { // el operador descarta un parte que abrió por error (solo mientras sigue abierto)
    if (!prev) return { descartado: true };
    exigir_(String(prev.estado) === 'abierto' || gerenteDe_(u, est), 'el parte ya está cerrado: pida al gerente que lo anule');
    actualizar_('partes', prev, { estado: 'anulado', version: version, observaciones: ('descartado por ' + u.nombre + (d.motivo ? ': ' + txt_(d.motivo, 300) : '') + (prev.observaciones ? ' · ' + prev.observaciones : '')).slice(0, 2000), actualizado_en: ahoraIso_() });
    if (String(prev.estado) === 'cerrado') { borrarDondeCola_('tramos', t => String(t.parte_id) === id, 6000); borrarDondeCola_('cargas_operador', c => String(c.parte_id) === id, 3000); }
    log_(u, 'parte descartado', 'parte', id, txt_(d.motivo, 300), ev.app_version); return { version: version, estado: 'anulado' };
  }
  const estado = d.estado === 'cerrado' ? 'cerrado' : 'abierto';
  const tol = tolLectura_(m);
  const li = num_(d.lectura_inicio); exigir_(li !== null && li >= 0, 'falta la lectura inicial del ' + (m.unidad === 'km' ? 'odómetro' : 'horómetro'));
  const lf = estado === 'cerrado' ? num_(d.lectura_fin) : null; const hi = hora_(d.hora_inicio); const hf = estado === 'cerrado' ? hora_(d.hora_fin) : '';
  if (estado === 'cerrado') { exigir_(lf !== null && hf, 'falta la lectura o la hora final'); exigir_(lf >= li, 'la lectura final es menor que la inicial'); }
  const avisos = [];
  const opNombre = nombreUsuario_(opId) || txt_(d.operador, 120);
  const tin = (d.tramos || []).slice(0, 60);
  const tramos = tin.map((t, i) => {
    const ultimo = i === tin.length - 1;
    const ld = num_(t.lectura_desde), hd = hora_(t.hora_desde);
    let lh = num_(t.lectura_hasta), hh = hora_(t.hora_hasta);
    if (ultimo && estado === 'cerrado') { if (lh === null) lh = lf; if (!hh) hh = hf; }
    const p = porId_('proyectos', t.proyecto_id); const s = porId_('servicios', t.servicio_id); const pa = porId_('pastos', t.pasto_id);
    return { parte_id: id, nro: i + 1, version: version, fecha: fecha, estancia: est, operador_id: opId, operador: opNombre, maquina_id: m.id, maquina: nombreMaquina_(m),
      proyecto_id: p ? p.id : '', proyecto: p ? (p.codigo + ' · ' + p.nombre) : txt_(t.proyecto, 120), servicio_id: s ? s.id : '', servicio: s ? s.nombre : txt_(t.servicio, 120),
      pasto_id: pa ? pa.id : '', lugar: pa ? pa.nombre : txt_(t.lugar, 120), centro_costo: (p && p.centro_costo) ? p.centro_costo : (s ? s.centro_costo : ''),
      lectura_desde: ld, lectura_hasta: lh, uso: (ld !== null && lh !== null) ? r_(lh - ld, 2) : '', hora_desde: hd, hora_hasta: hh, horas_reloj: (hd && hh) ? horasEntre_(hd, hh) : '',
      avance: num_(t.avance), unidad_avance: s ? s.unidad_avance : txt_(t.unidad_avance, 20), abierto: (ultimo && estado === 'abierto') ? 'si' : 'no' };
  });
  for (let i = 1; i < tramos.length; i++) { const a = tramos[i - 1], b = tramos[i]; if (a.lectura_hasta !== null && b.lectura_desde !== null && Math.abs(n0_(b.lectura_desde) - n0_(a.lectura_hasta)) > tol) avisos.push('el tramo ' + b.nro + ' empieza en ' + b.lectura_desde + ' y el anterior terminó en ' + a.lectura_hasta); if (n0_(b.lectura_desde) < n0_(a.lectura_desde) - tol) avisos.push('el horómetro retrocede en el tramo ' + b.nro); }
  const horasReloj = (hi && hf) ? horasEntre_(hi, hf) : null; const desc = Math.max(0, n0_(d.descanso_min));
  const horasOp = horasReloj !== null ? r_(Math.max(0, horasReloj - desc / 60), 2) : null; const uso = lf !== null ? r_(lf - li, 2) : null;
  if (!prev) {
    const la = num_(m.lectura_actual);
    if (la !== null && li < la - tol && (!m.lectura_fecha || fecha >= String(m.lectura_fecha))) { avisos.push('la lectura inicial (' + li + ') es menor que la última registrada de la máquina (' + la + ')'); alerta_('retrocede|' + id, 'lectura_retrocede', 'alta', est, 'parte', id, 'Lectura que retrocede · ' + nombreMaquina_(m), opNombre + ' empezó el parte del ' + fecha + ' con ' + li + ' y la máquina ya tenía ' + la + '.', fecha); }
  }
  if (estado === 'cerrado' && m.unidad !== 'km' && uso !== null && horasReloj !== null && uso > horasReloj + 1) { avisos.push('el horómetro avanzó ' + uso + ' h y la jornada fue de ' + horasReloj + ' h'); alerta_('horometro|' + id, 'horometro_incoherente', 'media', est, 'parte', id, 'Horómetro más rápido que el reloj · ' + nombreMaquina_(m), 'Parte de ' + opNombre + ' del ' + fecha + ': ' + uso + ' h de horómetro en ' + horasReloj + ' h de jornada.', fecha); }
  if (horasReloj !== null && horasReloj > 14) avisos.push('jornada de ' + horasReloj + ' h');
  controlIA_(d.ia, opNombre, 'parte', id, est, fecha, 'Horómetro inicial · ' + nombreMaquina_(m)).forEach(a => avisos.push('inicio: ' + a));
  if (estado === 'cerrado') controlIA_(d.ia_fin, opNombre, 'parte', id + '-fin', est, fecha, 'Horómetro final · ' + nombreMaquina_(m)).forEach(a => avisos.push('fin: ' + a));
  const cargas = (d.cargas || []).slice(0, 20).map((c, i) => ({ parte_id: id, nro: i + 1, version: version, fecha: fecha, hora: hora_(c.hora), estancia: est, operador_id: opId, maquina_id: m.id, maquina: nombreMaquina_(m), lectura: num_(c.lectura), litros: num_(c.litros), lleno: si_(c.lleno) ? 'si' : 'no', tanque_id: txt_(c.tanque_id, 40), lugar: txt_(c.lugar, 120), despacho_id: txt_(c.despacho_id, 80), confirmada: c.despacho_id ? (c.conforme === false ? 'no_conforme' : 'si') : '' }));
  const litrosDecl = r_(cargas.reduce((s, c) => s + n0_(c.litros), 0), 2);
  const fotos = guardarFotos_(ev, 'parte', id, est, fecha);
  const falla = d.falla && txt_(d.falla.descripcion) ? d.falla : null;
  const fila = { id: id, version: version, estado: estado, fecha: fecha, estancia: est, operador_id: opId, operador: opNombre, maquina_id: m.id, maquina: nombreMaquina_(m), unidad: m.unidad || 'h',
    lectura_inicio: li, lectura_fin: lf, uso: uso, hora_inicio: hi, hora_fin: hf, horas_reloj: horasReloj, descanso_min: desc, horas_operador: horasOp, litros_declarados: litrosDecl, cantidad_tramos: tramos.length,
    falla: falla ? 'si' : 'no', falla_desc: falla ? txt_(falla.descripcion, 1000) : '', observaciones: txt_(d.observaciones, 2000), avisos: avisos.join(' · '), url_fotos: urlsFotos_(prev && prev.url_fotos, fotos),
    tramo_actual: tramos.length ? JSON.stringify({ servicio: tramos[tramos.length - 1].servicio, lugar: tramos[tramos.length - 1].lugar, proyecto: tramos[tramos.length - 1].proyecto, hora_desde: tramos[tramos.length - 1].hora_desde, lat: num_(tin[tin.length - 1].lat), lon: num_(tin[tin.length - 1].lon) }) : '',
    tramos_json: JSON.stringify(tin), datos_json: JSON.stringify(Object.assign({}, d, { estado: estado })).slice(0, 45000), cargado_por: opId === u.id ? '' : u.nombre, dispositivo: ev.dispositivo, app_version: ev.app_version, creado_en: txt_(ev.creado_en, 40), cerrado_en: estado === 'cerrado' ? txt_(d.cerrado_en || ev.creado_en, 40) : '', recibido_en: prev ? prev.recibido_en : new Date(), actualizado_en: ahoraIso_() };
  if (prev) actualizar_('partes', prev, fila); else agregar_('partes', [fila]);
  // Mientras el parte está abierto los tramos viajan en la fila del parte (tramos_json); al cerrarlo se escriben en 'tramos' y 'cargas_operador'.
  if (prev && String(prev.estado) === 'cerrado') { borrarDondeCola_('tramos', t => String(t.parte_id) === id, 6000); borrarDondeCola_('cargas_operador', c => String(c.parte_id) === id, 3000); }
  if (estado === 'cerrado') { agregar_('tramos', tramos); agregar_('cargas_operador', cargas); }
  subirLectura_(m, lf !== null ? lf : (tramos.length ? Math.max.apply(null, tramos.map(t => n0_(t.lectura_desde)).concat([li])) : li), fecha);
  if (falla && !buscarId_('fallas', id + '-f')) {
    agregar_('fallas', [{ id: id + '-f', fecha: fecha, hora: hora_(falla.hora) || hf || hi, estancia: est, maquina_id: m.id, maquina: nombreMaquina_(m), operador_id: opId, operador: opNombre, parte_id: id, descripcion: txt_(falla.descripcion, 1000), gravedad: falla.gravedad === 'parada' ? 'parada' : 'puede_trabajar', url_foto: fotos.falla || '', estado: 'abierta', creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() }]);
    if (falla.gravedad === 'parada') avisar_(est, 'Falla: máquina parada · ' + nombreMaquina_(m), opNombre + ' informó el ' + fecha + ':\n' + txt_(falla.descripcion, 1000));
  }
  log_(u, prev ? 'parte actualizado (v' + version + ', ' + estado + ')' : 'parte recibido (' + estado + ')', 'parte', id, nombreMaquina_(m) + ' · ' + opNombre + ' · ' + fecha, ev.app_version);
  return { version: version, estado: estado, avisos: avisos, urls: fotos };
}

// ---- Despacho de combustible (encargado del tanque) ----
function evDespacho_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  if (buscarId_('despachos', id)) return { duplicado: true };
  const t = porId_('tanques', d.tanque_id); exigir_(t, 'tanque inexistente');
  exigir_((tiene_(u, 'combustible') && puedeEst_(u, t.estancia)) || gerenteDe_(u, t.estancia), 'no tiene permiso para despachar en ' + t.estancia);
  const fecha = fecha_(d.fecha), hora = hora_(d.hora); exigir_(fecha && hora, 'fecha u hora inválida');
  const destino = ['maquina', 'vale', 'transferencia', 'otro'].indexOf(d.destino) >= 0 ? d.destino : 'otro';
  const conTot = si_(t.tiene_totalizador);
  const ta = num_(d.totalizador_antes), td = num_(d.totalizador_despues);
  let litros = num_(d.litros);
  if (conTot && ta !== null && td !== null) { exigir_(td >= ta, 'el totalizador después es menor que el de antes'); litros = r_(td - ta, 2); }
  exigir_(litros !== null && litros > 0 && litros < 60000, 'litros inválidos');
  const tol = paramNum_('tolerancia_bomba_l', 2);
  const avisos = []; let estado = 'ok';
  const row = { id: id, fecha: fecha, hora: hora, ts: ts_(fecha, hora), estancia: t.estancia, tanque_id: t.id, tanque: t.nombre, encargado_id: u.id, encargado: u.nombre, destino: destino,
    receptor: txt_(d.receptor, 120), chapa: txt_(d.chapa, 40), lectura: num_(d.lectura), totalizador_antes: ta, totalizador_despues: td, litros: litros, validacion: txt_(d.validacion, 20) || 'manual',
    parte_id: txt_(d.parte_id, 80), proyecto_id: txt_(d.proyecto_id, 40), observaciones: txt_(d.observaciones, 1000), dispositivo: ev.dispositivo, app_version: ev.app_version, creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_(),
    motivo_sin_qr: txt_(d.motivo_sin_qr, 300), confirmacion: (destino === 'maquina' || destino === 'vale') ? 'pendiente' : 'no_aplica' };
  // QR del receptor: el "pedido de carga" que mostró el operador o el prestador, firmado por su teléfono
  let ped = null;
  if (d.pedido) { ped = leerQRFirmado_(d.pedido); if (!ped || (ped.tipo !== 'P' && ped.tipo !== 'PV')) { avisos.push('el QR del receptor no se pudo interpretar'); ped = null; } }
  if (ped) {
    row.pedido_id = txt_(ped.pid, 40); row.receptor_id = txt_(ped.uid, 40); row.receptor = row.receptor || nombreUsuario_(ped.uid);
    const okF = firmaValida_(ped, ped.uid); row.firma_pedido = okF ? 'ok' : 'invalida';
    if (!okF) { estado = 'por_revisar'; avisos.push('el QR del receptor no tiene una firma válida'); alerta_('firma_ped|' + id, 'firma_invalida', 'alta', t.estancia, 'despacho', id, 'QR de carga con firma inválida · ' + t.nombre, 'El despacho de ' + litros + ' L (' + fecha + ' ' + hora + ', ' + u.nombre + ') se hizo con un QR que no salió del app de ' + (nombreUsuario_(ped.uid) || 'la persona indicada') + '.', fecha); }
    if (String(ped.uid) === String(u.id)) { estado = 'por_revisar'; avisos.push('el encargado leyó su propio QR de carga'); }
    const otro = row.pedido_id ? cola_('despachos', 4000).find(x => String(x.pedido_id) === row.pedido_id && String(x.estado) !== 'anulado') : null;
    if (otro) { estado = 'por_revisar'; avisos.push('ese QR de carga ya se usó en el despacho del ' + otro.fecha + ' ' + otro.hora); alerta_('ped_rep|' + id, 'pedido_repetido', 'alta', t.estancia, 'despacho', id, 'QR de carga usado dos veces · ' + t.nombre, 'El QR de carga de ' + row.receptor + ' ya se había usado el ' + otro.fecha + ' ' + otro.hora + ' (' + otro.litros + ' L) y se volvió a usar para ' + litros + ' L (' + fecha + ' ' + hora + ', ' + u.nombre + ').', fecha); }
    const tc = Date.parse(String(ev.creado_en || '')); if (tc && ped.tmin > 0 && Math.abs(tc - ped.tmin * 60000) > 12 * 3600000) avisos.push('el QR de carga se generó ' + r_(Math.abs(tc - ped.tmin * 60000) / 3600000, 0) + ' h antes del despacho');
  }
  if (destino === 'maquina') {
    const m = porId_('maquinas', d.maquina_id); exigir_(m, 'máquina inexistente');
    row.maquina_id = m.id; row.maquina = nombreMaquina_(m); row.operador_id = txt_(d.operador_id, 40) || (ped && ped.tipo === 'P' ? txt_(ped.uid, 40) : ''); row.operador = nombreUsuario_(row.operador_id) || txt_(d.operador, 120);
    if (ped && ped.tipo !== 'P') { estado = 'por_revisar'; avisos.push('se leyó un QR de vale para una máquina propia'); }
    if (ped && ped.tipo === 'P' && String(ped.maquina_id) !== String(m.id)) { estado = 'por_revisar'; avisos.push('el QR del operador es de otra máquina (' + (nombreMaquina_(porId_('maquinas', ped.maquina_id)) || ped.maquina_id) + ')'); }
    if (si_(m.bloqueada)) { estado = 'por_revisar'; avisos.push('máquina bloqueada para combustible' + (m.motivo_bloqueo ? ' (' + m.motivo_bloqueo + ')' : '')); }
    if (String(m.propietario) === 'prestador') { estado = 'por_revisar'; avisos.push('máquina de prestador cargada sin vale'); }
    else if (si_(param_('exigir_asignacion')) && !asignacionActiva_(m.id, fecha)) { estado = 'por_revisar'; avisos.push('la máquina no tiene asignación activa a un proyecto'); }
    const cap = n0_(m.capacidad_tanque_l);
    if (cap > 0 && litros > cap * 1.05) { avisos.push('cargó ' + litros + ' L y el tanque de la máquina es de ' + cap + ' L'); alerta_('mayor_tanque|' + id, 'despacho_mayor_tanque', 'alta', t.estancia, 'despacho', id, 'Despacho mayor que el tanque · ' + nombreMaquina_(m), litros + ' L en una máquina con tanque de ' + cap + ' L (' + t.nombre + ', ' + fecha + ' ' + hora + ', ' + u.nombre + ').', fecha); }
    const la = num_(m.lectura_actual), lec = num_(d.lectura); const tolL = paramNum_('tolerancia_lectura', 0.5);
    if (lec !== null && la !== null && lec < la - tolL && (!m.lectura_fecha || fecha >= String(m.lectura_fecha))) avisos.push('la lectura (' + lec + ') es menor que la última de la máquina (' + la + ')');
    subirLectura_(m, lec, fecha);
    if (ts_(fecha, hora) >= ts_(m.ult_despacho_fecha, m.ult_despacho_hora)) actualizar_('maquinas', m, { ult_despacho_fecha: fecha, ult_despacho_hora: hora, ult_despacho_litros: litros, ult_despacho_lectura: lec });
  } else if (destino === 'vale') {
    const v = porId_('vales', d.vale_id); exigir_(v, 'vale inexistente');
    row.vale_id = v.id; row.vale_codigo = v.codigo; row.prestador_id = v.prestador_id; row.prestador = v.prestador; row.maquina = txt_(d.maquina, 120);
    if (ped) {
      if (ped.tipo !== 'PV' || sha256_(String(ped.token)) !== String(v.token_hash)) { estado = 'por_revisar'; avisos.push('el QR del prestador no corresponde al vale ' + v.codigo); }
      const ru = porId_('usuarios', ped.uid); if (!ru || String(ru.prestador_id) !== String(v.prestador_id)) { estado = 'por_revisar'; avisos.push((row.receptor || 'quien mostró el QR') + ' no figura como persona de ' + v.prestador); }
    }
    row.precio_litro = num_(v.precio_litro); row.total_gs = row.precio_litro !== null ? r_(litros * row.precio_litro, 0) : '';
    const saldo = r_(n0_(v.litros) - n0_(v.litros_usados), 2);
    if (String(v.estado) === 'anulado') { estado = 'por_revisar'; avisos.push('vale anulado'); alerta_('vale_anulado|' + id, 'vale_invalido', 'alta', t.estancia, 'despacho', id, 'Despacho con vale anulado · ' + v.codigo, litros + ' L a ' + v.prestador + ' (' + t.nombre + ', ' + fecha + ').', fecha); }
    if (v.vence && fecha > fecha_(v.vence)) { estado = 'por_revisar'; avisos.push('vale vencido el ' + fecha_(v.vence)); }
    const ests = lista_(v.estancias); if (ests.length && ests.indexOf('*') < 0 && ests.indexOf(String(t.estancia)) < 0) { estado = 'por_revisar'; avisos.push('vale no habilitado en ' + t.estancia); }
    if (litros > saldo + 0.01) { estado = 'por_revisar'; avisos.push('supera el saldo del vale en ' + r_(litros - saldo, 1) + ' L'); alerta_('sobregiro|' + id, 'vale_sobregiro', 'alta', t.estancia, 'despacho', id, 'Vale sobregirado · ' + v.codigo + ' · ' + v.prestador, 'Saldo ' + saldo + ' L y se despacharon ' + litros + ' L (' + t.nombre + ', ' + fecha + ' ' + hora + ').', fecha); }
    const usados = r_(n0_(v.litros_usados) + litros, 2); const nuevoSaldo = r_(n0_(v.litros) - usados, 2);
    actualizar_('vales', v, { litros_usados: usados, saldo: nuevoSaldo, estado: String(v.estado) === 'anulado' ? 'anulado' : (nuevoSaldo <= 0.01 ? 'agotado' : 'activo') });
  } else if (destino === 'transferencia') {
    const t2 = porId_('tanques', d.tanque_destino_id); exigir_(t2 && String(t2.id) !== String(t.id), 'tanque de destino inválido');
    row.tanque_destino_id = t2.id; row.receptor = row.receptor || t2.nombre;
    if (!buscarId_('descargas', id + '-t')) { agregar_('descargas', [{ id: id + '-t', fecha: fecha, hora: hora, ts: ts_(fecha, hora), estancia: t2.estancia, tanque_id: t2.id, tanque: t2.nombre, origen: 'tanque', tanque_origen_id: t.id, proveedor: 'Transferencia desde ' + t.nombre, litros_documento: litros, litros: litros, encargado_id: u.id, encargado: u.nombre, despacho_id: id, estado: 'ok', observaciones: 'automática por transferencia', creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() }]); actualizar_('tanques', t2, { stock_teorico: r_(n0_(t2.stock_teorico) + litros, 2) }); }
  } else {
    exigir_(row.receptor || row.observaciones, 'para "otro destino" escriba quién recibe o para qué es el combustible');
  }
  if (conTot && ta !== null) {
    const prevT = num_(t.totalizador_actual);
    if (prevT !== null && String(row.ts) >= String(t.totalizador_ts || '') && ta - prevT > tol) {
      avisos.push('el totalizador ya marcaba ' + r_(ta - prevT, 1) + ' L más que la última lectura (' + prevT + '): litros que salieron sin registro');
      alerta_('salto|' + id, 'salto_totalizador', 'alta', t.estancia, 'despacho', id, 'Litros sin registrar en la bomba · ' + t.nombre, 'Antes de este despacho el totalizador marcaba ' + ta + ' y el último registro era ' + prevT + ': ' + r_(ta - prevT, 1) + ' L salieron sin despacho registrado (' + fecha + ' ' + hora + ', ' + u.nombre + ').', fecha);
    }
  }
  const cambiosT = { stock_teorico: r_(n0_(t.stock_teorico) - litros, 2) };
  if (conTot && td !== null && String(row.ts) >= String(t.totalizador_ts || '')) { cambiosT.totalizador_actual = td; cambiosT.totalizador_ts = row.ts; }
  actualizar_('tanques', t, cambiosT);
  if (si_(param_('foto_despacho')) && !(ev.fotos && Object.keys(ev.fotos).length)) avisos.push('sin foto del totalizador');
  const fotos = guardarFotos_(ev, 'despacho', id, t.estancia, fecha); row.url_foto = fotos.totalizador || fotos.display || Object.keys(fotos).map(k => fotos[k])[0] || '';
  controlIA_(d.ia, u.nombre, 'despacho', id, t.estancia, fecha, 'Totalizador').forEach(a => avisos.push(a));
  row.estado = estado; row.avisos = avisos.join(' · ');
  const fila = agregar_('despachos', [row])[0];
  // Si el receptor ya leyó el comprobante (y su teléfono mandó la confirmación antes que el del encargado), se aplica ahora
  if (fila.confirmacion === 'pendiente') cola_('confirmaciones', 3000).filter(c => String(c.despacho_id) === id && String(c.estado) === 'esperando_despacho').forEach(c => aplicarConfirmacion_(fila, c));
  if (fila.estado === 'por_revisar') log_(u, 'despacho por revisar', 'despacho', id, fila.avisos, ev.app_version);
  return { estado: fila.estado, avisos: String(fila.avisos || '').split(' · ').filter(Boolean), litros: litros, confirmacion: fila.confirmacion };
}

// ---- Confirmación de quien recibe: leyó con su teléfono el QR del comprobante que mostró el encargado ----
function evConfirmacion_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  if (buscarId_('confirmaciones', id)) return { duplicado: true };
  exigir_(tiene_(u, 'operador') || tiene_(u, 'prestador') || esGerente_(u), 'solo el operador o el prestador confirman una carga');
  const q = leerQRFirmado_(d.comprobante); exigir_(q && q.tipo === 'R', 'el QR leído no es un comprobante de despacho');
  const t = porId_('tanques', q.tanque_id); const conforme = !(d.conforme === false || d.conforme === 'no');
  const fecha = fecha_(d.fecha) || hoy_(), hora = hora_(d.hora) || ahoraIso_().slice(11, 16);
  const row = { id: id, despacho_id: txt_(q.did, 80), pedido_id: txt_(q.pid, 40), fecha: fecha, hora: hora, estancia: t ? t.estancia : txt_(d.estancia, 80), tanque_id: txt_(q.tanque_id, 40), tanque: t ? t.nombre : '', encargado_id: txt_(q.eid, 40), encargado: nombreUsuario_(q.eid),
    receptor_id: u.id, receptor: u.nombre, tipo_receptor: (tiene_(u, 'prestador') && !u.admin) ? 'prestador' : 'operador', destino_ref: txt_(q.ref, 80), litros_comprobante: q.litros, litros_receptor: conforme ? q.litros : num_(d.litros_receptor),
    conforme: conforme ? 'si' : 'no', motivo: txt_(d.motivo, 500), lleno: d.lleno === true ? 'si' : (d.lleno === false ? 'no' : ''), lectura: num_(d.lectura), parte_id: txt_(d.parte_id, 80), firma: 'ok', estado: 'esperando_despacho', avisos: '',
    dispositivo: ev.dispositivo, app_version: ev.app_version, creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() };
  if (!firmaValida_(q, q.eid)) {
    row.firma = 'invalida'; row.estado = 'firma_invalida'; agregar_('confirmaciones', [row]);
    alerta_('firma_comp|' + id, 'firma_invalida', 'alta', row.estancia, 'confirmacion', id, 'Comprobante de carga con firma inválida', u.nombre + ' leyó un comprobante de ' + q.litros + ' L que no salió del app del encargado (' + (row.encargado || q.eid) + ').', fecha);
    return { estado: 'firma_invalida', avisos: ['El comprobante no tiene una firma válida: se avisó al gerente.'] };
  }
  const c = agregar_('confirmaciones', [row])[0];
  const desp = buscarId_('despachos', q.did, 6000, true);
  if (!desp) return { estado: 'esperando_despacho' };
  const r = aplicarConfirmacion_(desp, c);
  return { estado: c.estado, confirmacion: r, avisos: String(c.avisos || '').split(' · ').filter(Boolean) };
}
function aplicarConfirmacion_(desp, c) {
  if (String(desp.estado) === 'anulado') { actualizar_('confirmaciones', c, { estado: 'despacho_anulado' }); return 'anulado'; }
  const av = [];
  if (String(c.receptor_id) === String(desp.encargado_id)) av.push('el encargado no puede confirmar su propio despacho');
  if (desp.destino === 'vale') { const v = porId_('vales', desp.vale_id); const ru = porId_('usuarios', c.receptor_id); if (v && (!ru || String(ru.prestador_id) !== String(v.prestador_id))) av.push(c.receptor + ' no figura como persona de ' + v.prestador); }
  else if (desp.destino === 'maquina' && desp.operador_id && String(desp.operador_id) !== String(c.receptor_id)) av.push('confirmó ' + c.receptor + ' y el despacho figura para ' + desp.operador);
  if (Math.abs(n0_(c.litros_comprobante) - n0_(desp.litros)) > 0.05) av.push('el comprobante dice ' + c.litros_comprobante + ' L y el despacho ' + desp.litros + ' L');
  const ok = String(c.conforme) === 'si' && !av.length;
  const cambios = { confirmacion: ok ? 'confirmado' : 'no_conforme', confirmado_por: c.receptor, confirmado_en: ahoraIso_(), litros_receptor: num_(c.litros_receptor) };
  if (!desp.receptor_id) cambios.receptor_id = c.receptor_id;
  if (!desp.parte_id && c.parte_id) cambios.parte_id = c.parte_id;
  if (desp.destino === 'maquina' && !desp.operador_id) { cambios.operador_id = c.receptor_id; cambios.operador = c.receptor; }
  if (ok) resolverAlerta_('sinconf|' + desp.id, 'confirmado por ' + c.receptor);
  else {
    const det = String(c.conforme) === 'si' ? av.join(' · ') : (c.receptor + ' no está conforme: dice que recibió ' + (num_(c.litros_receptor) !== null ? c.litros_receptor + ' L' : 'otra cantidad') + ' y el encargado registró ' + desp.litros + ' L' + (c.motivo ? ' (' + c.motivo + ')' : '') + (av.length ? ' · ' + av.join(' · ') : ''));
    if (String(desp.estado) !== 'rechazado') cambios.estado = 'por_revisar';
    cambios.avisos = [desp.avisos, det].filter(Boolean).join(' · ').slice(0, 1500);
    alerta_('no_conforme|' + desp.id, 'despacho_no_conforme', 'alta', desp.estancia, 'despacho', desp.id, 'Carga no confirmada por quien recibió · ' + (String(desp.maquina || '').split(' · ')[0] || desp.prestador || ''), det + ' (' + desp.tanque + ', ' + desp.fecha + ' ' + desp.hora + ', encargado ' + desp.encargado + ').', desp.fecha);
    avisar_(desp.estancia, 'Carga de combustible NO confirmada · ' + (desp.maquina || desp.prestador || ''), det + '\n' + desp.tanque + ' · ' + fechaTxt_(desp.fecha) + ' ' + desp.hora + ' · encargado ' + desp.encargado);
  }
  actualizar_('despachos', desp, cambios);
  actualizar_('confirmaciones', c, { estado: ok ? 'confirmada' : 'no_conforme', avisos: av.join(' · ') });
  return cambios.confirmacion;
}
function resolverAlerta_(clave, com) { cola_('alertas', 3000).filter(x => String(x.clave) === clave && String(x.estado) === 'abierta').forEach(a => actualizar_('alertas', a, { estado: 'resuelta', revisado_por: 'automático', revisado_en: ahoraIso_(), comentario: com })); }

// ---- Lectura de la bomba: apertura / cierre del día / control (totalizador y régla) ----
function litrosAforo_(t, cm) {
  const pts = String(t.aforo || '').split(/[;\n]/).map(x => x.split(':').map(Number)).filter(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2 || cm === null) return null;
  if (cm <= pts[0][0]) return pts[0][1]; if (cm >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) if (cm <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return r_(a[1] + (b[1] - a[1]) * (cm - a[0]) / (b[0] - a[0]), 0); }
  return null;
}
function evLectura_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  if (buscarId_('lecturas_bomba', id)) return { duplicado: true };
  const t = porId_('tanques', d.tanque_id); exigir_(t, 'tanque inexistente');
  exigir_((tiene_(u, 'combustible') && puedeEst_(u, t.estancia)) || gerenteDe_(u, t.estancia), 'no tiene permiso en ' + t.estancia);
  const fecha = fecha_(d.fecha), hora = hora_(d.hora); exigir_(fecha && hora, 'fecha u hora inválida');
  const tipo = ['apertura', 'cierre', 'control'].indexOf(d.tipo) >= 0 ? d.tipo : 'control';
  const tot = num_(d.totalizador); const cm = num_(d.regla_cm); let med = num_(d.litros_medidos);
  if (med === null && cm !== null) med = litrosAforo_(t, cm);
  exigir_(tot !== null || med !== null, 'falta el totalizador o la medición');
  const avisos = []; const tol = paramNum_('tolerancia_bomba_l', 2); const ts = ts_(fecha, hora);
  if (si_(t.tiene_totalizador) && tot !== null) {
    const prevT = num_(t.totalizador_actual);
    if (prevT !== null && ts >= String(t.totalizador_ts || '')) {
      if (tot - prevT > tol) { avisos.push('el totalizador marca ' + r_(tot - prevT, 1) + ' L más que el último registro (' + prevT + ')'); alerta_('salto|' + id, 'salto_totalizador', 'alta', t.estancia, 'lectura', id, 'Litros sin registrar en la bomba · ' + t.nombre, 'En la ' + tipo + ' del ' + fecha + ' ' + hora + ' el totalizador marca ' + tot + ' y el último registro era ' + prevT + ': ' + r_(tot - prevT, 1) + ' L salieron sin despacho registrado.', fecha); }
      else if (prevT - tot > tol) avisos.push('el totalizador (' + tot + ') es menor que el último registro (' + prevT + ')');
    }
    if (ts >= String(t.totalizador_ts || '')) actualizar_('tanques', t, { totalizador_actual: tot, totalizador_ts: ts });
  }
  if (med !== null) {
    const hayEntradas = filas_('descargas').some(x => String(x.tanque_id) === String(t.id) && String(x.estado) !== 'anulado');
    const st = num_(t.stock_teorico); const tolS = Math.max(tol, n0_(t.capacidad_l) * paramNum_('tolerancia_stock_pct', 1) / 100);
    if (!hayEntradas) avisos.push('el tanque no tiene stock inicial registrado: use "Recibir combustible › Stock inicial"');
    else if (st !== null && Math.abs(med - st) > tolS) { avisos.push('la régla mide ' + med + ' L y el stock teórico es ' + st + ' L (' + (med > st ? '+' : '') + r_(med - st, 0) + ' L)'); if (med < st) alerta_('stock|' + id, 'diferencia_stock', 'media', t.estancia, 'lectura', id, 'Falta combustible en el tanque · ' + t.nombre, 'Medición ' + med + ' L contra stock teórico ' + st + ' L (' + r_(st - med, 0) + ' L de menos) el ' + fecha + ' ' + hora + '.', fecha); }
  }
  controlIA_(d.ia, u.nombre, 'lectura', id, t.estancia, fecha, 'Totalizador (' + tipo + ')').forEach(a => avisos.push(a));
  const fotos = guardarFotos_(ev, 'lectura', id, t.estancia, fecha);
  agregar_('lecturas_bomba', [{ id: id, fecha: fecha, hora: hora, ts: ts, estancia: t.estancia, tanque_id: t.id, tanque: t.nombre, tipo: tipo, totalizador: tot, regla_cm: cm, litros_medidos: med, encargado_id: u.id, encargado: u.nombre, estado: 'ok', avisos: avisos.join(' · '), url_foto: Object.keys(fotos).map(k => fotos[k])[0] || '', observaciones: txt_(d.observaciones, 1000), creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() }]);
  return { avisos: avisos, litros_medidos: med };
}

// ---- Descarga: entrada de combustible al tanque (camión cisterna, stock inicial) ----
function evDescarga_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  if (buscarId_('descargas', id)) return { duplicado: true };
  const t = porId_('tanques', d.tanque_id); exigir_(t, 'tanque inexistente');
  exigir_((tiene_(u, 'combustible') && puedeEst_(u, t.estancia)) || gerenteDe_(u, t.estancia), 'no tiene permiso en ' + t.estancia);
  const fecha = fecha_(d.fecha), hora = hora_(d.hora); exigir_(fecha && hora, 'fecha u hora inválida');
  const origen = ['proveedor', 'stock_inicial', 'ajuste'].indexOf(d.origen) >= 0 ? d.origen : 'proveedor';
  if (origen === 'ajuste') exigir_(gerenteDe_(u, t.estancia), 'solo el gerente puede registrar un ajuste de stock');
  const ld = num_(d.litros_documento); const ma = num_(d.medicion_antes), mdp = num_(d.medicion_despues);
  const lm = (ma !== null && mdp !== null) ? r_(mdp - ma, 2) : null;
  const litros = lm !== null ? lm : ld; exigir_(litros !== null && (litros > 0 || origen === 'ajuste'), 'faltan los litros');
  const avisos = [];
  if (origen === 'proveedor' && ld !== null && lm !== null && ld > 0) {
    const dif = r_(lm - ld, 1); const pct = Math.abs(dif) / ld * 100;
    if (pct > paramNum_('tolerancia_descarga_pct', 0.5)) { avisos.push('la factura dice ' + ld + ' L y se midieron ' + lm + ' L (' + (dif > 0 ? '+' : '') + dif + ' L)'); if (dif < 0) alerta_('descarga|' + id, 'faltante_descarga', 'alta', t.estancia, 'descarga', id, 'Faltante en la descarga · ' + t.nombre, 'Documento ' + (d.documento || '—') + ' de ' + (d.proveedor || '—') + ': ' + ld + ' L facturados y ' + lm + ' L medidos (' + dif + ' L) el ' + fecha + '.', fecha); }
  }
  const precio = num_(d.precio_litro);
  const fotos = guardarFotos_(ev, 'descarga', id, t.estancia, fecha);
  agregar_('descargas', [{ id: id, fecha: fecha, hora: hora, ts: ts_(fecha, hora), estancia: t.estancia, tanque_id: t.id, tanque: t.nombre, origen: origen, proveedor: txt_(d.proveedor, 120), documento: txt_(d.documento, 60), litros_documento: ld, medicion_antes: ma, medicion_despues: mdp, litros_medidos: lm, litros: litros, precio_litro: precio, total_gs: precio !== null ? r_(precio * (ld !== null ? ld : litros), 0) : '', chapa: txt_(d.chapa, 40), chofer: txt_(d.chofer, 120), encargado_id: u.id, encargado: u.nombre, estado: 'ok', avisos: avisos.join(' · '), url_foto: Object.keys(fotos).map(k => fotos[k])[0] || '', observaciones: txt_(d.observaciones, 1000), creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() }]);
  actualizar_('tanques', t, { stock_teorico: r_(n0_(t.stock_teorico) + litros, 2) });
  return { avisos: avisos, litros: litros };
}

/* ===================== Almacén (solo Ypoti) ===================== */
// Un solo catálogo de artículos: la descripción se arma con campos fijos (tipo, medida, material, marca, nro de parte),
// así "parafuso 1/2" no aparece escrito de cinco maneras. Entradas y salidas eligen siempre del catálogo.
function normTxt_(s) { return String(s === undefined || s === null ? '' : s).toUpperCase().replace(/[″”“]/g, '"').replace(/[’′]/g, "'").replace(/\s*[×]\s*/g, ' X ').replace(/\s+/g, ' ').trim(); }
function clave_(s) { return normTxt_(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9/".,]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function descArticulo_(a) { return [a.tipo, a.medida, a.material, a.marca, a.nro_parte ? 'P/N ' + a.nro_parte : ''].map(normTxt_).filter(Boolean).join(' '); }
function articuloResuelto_(id) { let a = porId_('articulos', id); let n = 0; while (a && String(a.estado) === 'fusionado' && a.fusionado_en && n++ < 6) a = porId_('articulos', a.fusionado_en); return a; }
function nombreDestino_(tipo, id, texto) {
  if (tipo === 'maquina') { const m = porId_('maquinas', id); return m ? nombreMaquina_(m) : txt_(texto, 120); }
  if (tipo === 'proyecto') { const p = porId_('proyectos', id); return p ? p.codigo + ' · ' + p.nombre : txt_(texto, 120); }
  return txt_(texto, 120);
}
function itemsDe_(s) { try { return JSON.parse(String(s.items_json || '[]')); } catch (e) { return []; } }
function actualizarAtencion_(sol, u) {
  const items = itemsDe_(sol); if (!items.length) return;
  const mov = {}; filas_('movimientos').forEach(m => { if (String(m.solicitud_id) === String(sol.id) && String(m.estado) !== 'anulado') mov[m.articulo_id] = (mov[m.articulo_id] || 0) + Math.abs(n0_(m.cantidad)); });
  const completa = items.every(it => (mov[it.articulo_id] || 0) >= n0_(it.cantidad_aprobada !== undefined && it.cantidad_aprobada !== null ? it.cantidad_aprobada : it.cantidad) - 1e-6);
  const alguna = Object.keys(mov).length > 0;
  actualizar_('solicitudes', sol, { estado: completa ? 'atendida' : (alguna ? 'parcial' : sol.estado), atendido_en: ahoraIso_(), atendido_por: u.nombre });
}
function evMovimiento_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  if (cola_('movimientos', 6000).some(m => String(m.evento_id) === id)) return { duplicado: true };
  const est = CONFIG.ESTANCIA_ALMACEN;
  exigir_((tiene_(u, 'almacen') && puedeEst_(u, est)) || gerenteDe_(u, est), 'no tiene permiso en el almacén');
  const tipo = d.tipo === 'salida' ? 'salida' : 'entrada';
  const subtipo = tipo === 'entrada' ? (d.subtipo === 'devolucion' ? 'devolucion' : 'compra') : 'consumo';
  const fecha = fecha_(d.fecha) || hoy_(), hora = hora_(d.hora) || '00:00';
  let sol = null;
  if (d.solicitud_id) { sol = porId_('solicitudes', d.solicitud_id); exigir_(sol, 'la solicitud vinculada no existe en el servidor'); }
  if (tipo === 'salida') {
    exigir_(sol || gerenteDe_(u, est), 'toda salida necesita una solicitud aprobada por el gerente');
    if (sol) exigir_(['aprobada', 'parcial'].indexOf(String(sol.estado)) >= 0, 'la solicitud ' + sol.codigo + ' está ' + sol.estado);
  }
  const dTipo = txt_(d.destino_tipo || (sol && sol.destino_tipo), 20), dId = txt_(d.destino_id || (sol && sol.destino_id), 40);
  const dNom = nombreDestino_(dTipo, dId, d.destino || (sol && sol.destino));
  const lineas = (d.lineas || []).slice(0, 100); exigir_(lineas.length, 'el movimiento no tiene artículos');
  const avisos = []; const filas = [];
  lineas.forEach((l, i) => {
    const a = articuloResuelto_(l.articulo_id); exigir_(a, 'artículo inexistente (' + (l.descripcion || l.articulo_id) + ')');
    const q = num_(l.cantidad); exigir_(q !== null && q > 0, 'cantidad inválida para ' + a.descripcion);
    const st = n0_(a.stock), avg = n0_(a.costo_promedio);
    let costo, nuevoSt, nuevoAvg = avg;
    if (tipo === 'entrada') { const c = num_(l.costo_unitario); costo = c !== null ? c : avg; nuevoSt = r_(st + q, 4); nuevoAvg = (st > 0 && nuevoSt > 0) ? r_((st * avg + q * costo) / nuevoSt, 2) : costo; }
    else { costo = avg; nuevoSt = r_(st - q, 4); if (nuevoSt < -1e-6) { avisos.push('stock negativo de ' + a.descripcion + ' (' + nuevoSt + ' ' + a.unidad + ')'); alerta_('negativo|' + id + '|' + a.id, 'stock_negativo', 'media', est, 'articulo', a.id, 'Stock negativo · ' + a.codigo + ' ' + a.descripcion, 'Después de la salida del ' + fecha + ' el sistema queda con ' + nuevoSt + ' ' + a.unidad + '. Haga un conteo del artículo.', fecha); } }
    actualizar_('articulos', a, { stock: nuevoSt, costo_promedio: nuevoAvg, actualizado_en: ahoraIso_() });
    filas.push({ id: id + '-' + (i + 1), evento_id: id, fecha: fecha, hora: hora, ts: ts_(fecha, hora), estancia: est, tipo: tipo, subtipo: subtipo, articulo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, cantidad: tipo === 'entrada' ? q : -q, unidad: a.unidad,
      costo_unitario: costo, total: r_(q * costo, 0), stock_resultante: nuevoSt, destino_tipo: tipo === 'salida' ? dTipo : '', destino_id: tipo === 'salida' ? dId : '', destino: tipo === 'salida' ? dNom : '', mantenimiento_id: txt_(d.mantenimiento_id, 80),
      solicitud_id: sol ? sol.id : '', documento: txt_(d.documento, 60), proveedor: txt_(d.proveedor, 120), marca: normTxt_(l.marca).slice(0, 60), entregado_a: txt_(d.entregado_a, 120), responsable_id: u.id, responsable: u.nombre, estado: 'ok', observaciones: txt_(d.observaciones || l.nota, 500), creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() });
  });
  const fotos = guardarFotos_(ev, 'movimiento', id, est, fecha); const uf = Object.keys(fotos).map(k => fotos[k])[0] || ''; filas.forEach(f => f.url_foto = uf);
  agregar_('movimientos', filas);
  if (sol) actualizarAtencion_(sol, u);
  log_(u, tipo + ' de almacén', 'movimiento', id, filas.length + ' artículo(s)' + (sol ? ' · ' + sol.codigo : ''), ev.app_version);
  return { avisos: avisos, lineas: filas.map(f => ({ articulo_id: f.articulo_id, stock: f.stock_resultante })), solicitud_estado: sol ? sol.estado : '' };
}
function aplicarAjuste_(sol, u) {
  const items = itemsDe_(sol); const est = sol.estancia || CONFIG.ESTANCIA_ALMACEN; const fecha = hoy_(); const hora = Utilities.formatDate(new Date(), tz_(), 'HH:mm'); const filas = [];
  items.forEach((it, i) => {
    const a = articuloResuelto_(it.articulo_id); if (!a) return; const contado = num_(it.contado); if (contado === null) return;
    const dif = r_(contado - n0_(a.stock), 4); if (Math.abs(dif) < 1e-6) return;
    filas.push({ id: sol.id + '-aj' + (i + 1), evento_id: sol.id + '-aj', fecha: fecha, hora: hora, ts: ts_(fecha, hora), estancia: est, tipo: 'ajuste', subtipo: dif > 0 ? 'conteo_mas' : 'conteo_menos', articulo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, cantidad: dif, unidad: a.unidad, costo_unitario: n0_(a.costo_promedio), total: r_(dif * n0_(a.costo_promedio), 0), stock_resultante: contado, solicitud_id: sol.id, responsable_id: u.id, responsable: u.nombre, estado: 'ok', observaciones: 'ajuste por conteo ' + (sol.codigo || ''), creado_en: ahoraIso_(), recibido_en: ahoraIso_() });
    actualizar_('articulos', a, { stock: contado, actualizado_en: ahoraIso_() });
  });
  agregar_('movimientos', filas);
  return filas.length;
}
function evSolicitud_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  const ya = buscarId_('solicitudes', id); if (ya) return { duplicado: true, codigo: ya.codigo, estado: ya.estado };
  const tipo = ['compra', 'salida', 'ajuste'].indexOf(d.tipo) >= 0 ? d.tipo : ''; exigir_(tipo, 'tipo de solicitud inválido');
  const est = CONFIG.ESTANCIA_ALMACEN;
  if (tipo !== 'salida') exigir_((tiene_(u, 'almacen') && puedeEst_(u, est)) || gerenteDe_(u, est), 'solo el almacén o el gerente pueden pedir compras o ajustes');
  const items = (d.items || []).slice(0, 120).map(it => {
    const a = articuloResuelto_(it.articulo_id); exigir_(a, 'artículo inexistente: ' + (it.descripcion || it.articulo_id));
    const o = { articulo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, unidad: a.unidad, nota: txt_(it.nota, 200) };
    if (tipo === 'ajuste') { o.contado = num_(it.contado); exigir_(o.contado !== null && o.contado >= 0, 'conteo inválido para ' + a.descripcion); o.sistema = n0_(a.stock); o.diferencia = r_(o.contado - o.sistema, 4); o.cantidad = Math.abs(o.diferencia); }
    else { o.cantidad = num_(it.cantidad); exigir_(o.cantidad !== null && o.cantidad > 0, 'cantidad inválida para ' + a.descripcion); }
    return o; });
  exigir_(items.length, 'la solicitud no tiene artículos');
  const dTipo = txt_(d.destino_tipo, 20), dId = txt_(d.destino_id, 40);
  const codigo = siguienteCodigo_('solicitudes', 'codigo', 'SOL-', 5);
  const auto = gerenteDe_(u, est);
  const resumen = items.slice(0, 6).map(it => (tipo === 'ajuste' ? it.descripcion + ' (' + (it.diferencia > 0 ? '+' : '') + it.diferencia + ')' : it.descripcion + ' × ' + it.cantidad + ' ' + it.unidad)).join('; ') + (items.length > 6 ? '; … (' + items.length + ' artículos)' : '');
  const s = agregar_('solicitudes', [{ id: id, codigo: codigo, tipo: tipo, estado: auto ? 'aprobada' : 'pendiente', estancia: est, solicitante_id: u.id, solicitante: u.nombre, destino_tipo: dTipo, destino_id: dId, destino: nombreDestino_(dTipo, dId, d.destino), motivo: txt_(d.motivo, 1000), urgencia: d.urgencia === 'urgente' ? 'urgente' : 'normal', items_json: JSON.stringify(items), resumen: resumen.slice(0, 1000), creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_(), decidido_por: auto ? u.nombre : '', decidido_en: auto ? ahoraIso_() : '', comentario: auto ? 'creada por el gerente' : '' }])[0];
  if (auto && tipo === 'ajuste') { aplicarAjuste_(s, u); actualizar_('solicitudes', s, { estado: 'atendida', atendido_en: ahoraIso_(), atendido_por: u.nombre }); }
  if (!auto) avisar_(est, 'Solicitud de ' + tipo + ' ' + codigo + (s.urgencia === 'urgente' ? ' (URGENTE)' : ''), u.nombre + ' pide aprobar:\n' + resumen + (s.destino ? '\nDestino: ' + s.destino : '') + (s.motivo ? '\nMotivo: ' + s.motivo : '') + '\n\nAbra el app › Por aprobar.');
  log_(u, 'solicitud ' + tipo, 'solicitud', id, codigo + ' · ' + resumen, ev.app_version);
  return { codigo: codigo, estado: s.estado };
}
function evArticulo_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  const prev = porId_('articulos', id); if (prev) return { duplicado: true, codigo: prev.codigo, estado: prev.estado, fusionado_en: prev.fusionado_en || '' };
  const est = CONFIG.ESTANCIA_ALMACEN;
  exigir_((tiene_(u, 'almacen') && puedeEst_(u, est)) || gerenteDe_(u, est), 'solo el almacén o el gerente pueden crear artículos');
  const a = { tipo: normTxt_(d.tipo).slice(0, 80), medida: normTxt_(d.medida).slice(0, 60), material: normTxt_(d.material).slice(0, 60), marca: normTxt_(d.marca).slice(0, 60), nro_parte: normTxt_(d.nro_parte).slice(0, 60) };
  exigir_(a.tipo, 'falta el tipo de artículo');
  const desc = descArticulo_(a); const unidad = txt_(d.unidad, 20) || 'un'; const barras = txt_(d.codigo_barras, 60);
  const vivos = filas_('articulos').filter(x => ['activo', 'por_revisar'].indexOf(String(x.estado)) >= 0);
  let igual = vivos.find(x => clave_(x.descripcion) === clave_(desc) && String(x.unidad) === unidad);
  if (!igual && barras) igual = vivos.find(x => lista_(x.codigo_barras).indexOf(barras) >= 0);
  const row = Object.assign(a, { id: id, codigo_barras: barras, categoria: txt_(d.categoria, 60), descripcion: desc, unidad: unidad, ubicacion: normTxt_(d.ubicacion).slice(0, 60), stock_minimo: num_(d.stock_minimo), cantidad_reposicion: num_(d.cantidad_reposicion), stock: 0, costo_promedio: 0, estancia: est, maquinas: txt_(d.maquinas, 300), notas: txt_(d.notas, 500), creado_por: u.nombre, creado_en: ahoraIso_(), actualizado_en: ahoraIso_() });
  if (igual) { row.estado = 'fusionado'; row.fusionado_en = igual.id; row.codigo = igual.codigo; row.descripcion = igual.descripcion; }
  else { row.estado = gerenteDe_(u, est) ? 'activo' : 'por_revisar'; row.codigo = siguienteCodigo_('articulos', 'codigo', 'ALM-', 5); }
  agregar_('articulos', [row]);
  log_(u, igual ? 'artículo repetido (usa ' + igual.codigo + ')' : 'artículo nuevo', 'articulo', id, row.codigo + ' ' + row.descripcion, ev.app_version);
  return { codigo: row.codigo, estado: row.estado, fusionado_en: row.fusionado_en || '', descripcion: row.descripcion };
}

/* ===================== Mantenimiento y fallas ===================== */
function evMantenimiento_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  if (buscarId_('mantenimientos', id)) return { duplicado: true };
  const m = porId_('maquinas', d.maquina_id); exigir_(m, 'máquina inexistente');
  exigir_(tiene_(u, 'mecanico') || gerenteDe_(u, m.estancia), 'solo el mecánico o el gerente registran mantenimientos');
  const fecha = fecha_(d.fecha) || hoy_(); const lec = num_(d.lectura);
  const tareas = lista_(d.tareas).filter(t => { const p = porId_('planes_mant', t); return p && String(p.maquina_id) === String(m.id); });
  tareas.forEach(t => { const p = porId_('planes_mant', t); actualizar_('planes_mant', p, { ultima_lectura: lec !== null ? lec : p.ultima_lectura, ultima_fecha: fecha }); });
  const c1 = n0_(d.costo_repuestos_ext), c2 = n0_(d.costo_mano_obra), c3 = n0_(d.costo_servicios);
  const fotos = guardarFotos_(ev, 'mantenimiento', id, m.estancia, fecha);
  const estado = d.estado === 'abierto' ? 'abierto' : 'cerrado';
  agregar_('mantenimientos', [{ id: id, fecha: fecha, ts: ts_(fecha, hora_(d.hora) || '12:00'), estancia: m.estancia, maquina_id: m.id, maquina: nombreMaquina_(m), lectura: lec, tipo: d.tipo === 'correctivo' ? 'correctivo' : 'preventivo', tareas: tareas.join('|'), tareas_desc: tareas.map(t => porId_('planes_mant', t).tarea).join('; '), descripcion: txt_(d.descripcion, 2000), taller: d.taller === 'externo' ? 'externo' : 'propio', proveedor: txt_(d.proveedor, 120), costo_repuestos_ext: c1, costo_mano_obra: c2, costo_servicios: c3, costo_total_ext: c1 + c2 + c3, horas_parada: num_(d.horas_parada), falla_id: txt_(d.falla_id, 80), responsable_id: u.id, responsable: u.nombre, estado: estado, url_fotos: urlsFotos_('', fotos), observaciones: txt_(d.observaciones, 1000), creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() }]);
  if (d.falla_id) { const f = porId_('fallas', d.falla_id); if (f) actualizar_('fallas', f, { estado: estado === 'cerrado' ? 'resuelta' : 'en_reparacion', mantenimiento_id: id, revisado_por: u.nombre, revisado_en: ahoraIso_() }); }
  subirLectura_(m, lec, fecha);
  log_(u, 'mantenimiento ' + (d.tipo || ''), 'mantenimiento', id, nombreMaquina_(m), ev.app_version);
  return { tareas: tareas.length };
}
function evFalla_(u, ev) {
  const d = ev.datos; const id = String(ev.id);
  if (buscarId_('fallas', id)) return { duplicado: true };
  const m = porId_('maquinas', d.maquina_id); exigir_(m, 'máquina inexistente');
  const fecha = fecha_(d.fecha) || hoy_(); const est = txt_(d.estancia, 80) || m.estancia;
  const fotos = guardarFotos_(ev, 'falla', id, est, fecha);
  const grav = d.gravedad === 'parada' ? 'parada' : 'puede_trabajar';
  agregar_('fallas', [{ id: id, fecha: fecha, hora: hora_(d.hora), estancia: est, maquina_id: m.id, maquina: nombreMaquina_(m), operador_id: u.id, operador: u.nombre, parte_id: txt_(d.parte_id, 80), descripcion: txt_(d.descripcion, 1000), gravedad: grav, url_foto: Object.keys(fotos).map(k => fotos[k])[0] || '', estado: 'abierta', creado_en: txt_(ev.creado_en, 40), recibido_en: ahoraIso_() }]);
  avisar_(est, 'Falla ' + (grav === 'parada' ? '(máquina PARADA) ' : '') + '· ' + nombreMaquina_(m), u.nombre + ' informó el ' + fecha + ':\n' + txt_(d.descripcion, 1000));
  return {};
}

/* ===================== Aba del gerente: alta y edición de catálogos ===================== */
const ENTIDADES = {
  usuario: { hoja: 'usuarios', pref: 'u_', campos: ['nombre', 'documento', 'telefono', 'correo', 'roles', 'estancias', 'prestador_id', 'costo_hora', 'activo', 'notas'] },
  maquina: { hoja: 'maquinas', pref: 'm_', campos: ['codigo', 'nombre', 'tipo', 'marca', 'modelo', 'anio', 'chapa_serie', 'estancia', 'propietario', 'prestador_id', 'unidad', 'capacidad_tanque_l', 'consumo_ref', 'valor_compra', 'valor_residual', 'vida_util_h', 'lectura_actual', 'bloqueada', 'motivo_bloqueo', 'activo', 'notas'] },
  proyecto: { hoja: 'proyectos', pref: 'p_', campos: ['nombre', 'estancia', 'descripcion', 'centro_costo', 'servicio_id', 'pastos', 'responsable_id', 'fecha_inicio', 'fecha_fin', 'estado', 'presupuesto_horas', 'presupuesto_litros', 'presupuesto_gs', 'meta_avance', 'unidad_avance', 'notas'] },
  asignacion: { hoja: 'asignaciones', pref: 'as_', campos: ['proyecto_id', 'operador_id', 'maquina_id', 'servicio_id', 'pasto_id', 'desde', 'hasta', 'horas_previstas', 'activo', 'notas'] },
  servicio: { hoja: 'servicios', pref: 's_', campos: ['nombre', 'unidad_avance', 'centro_costo', 'activo', 'orden'] },
  pasto: { hoja: 'pastos', pref: 'pa_', campos: ['estancia', 'nombre', 'tipo', 'superficie_ha', 'activo', 'notas'] },
  tanque: { hoja: 'tanques', pref: 't_', campos: ['estancia', 'nombre', 'tipo', 'capacidad_l', 'tiene_totalizador', 'aforo', 'encargados', 'activo', 'notas'] },
  prestador: { hoja: 'prestadores', pref: 'pr_', campos: ['nombre', 'ruc', 'contacto', 'telefono', 'correo', 'activo', 'notas'] },
  articulo: { hoja: 'articulos', pref: 'a_', campos: ['codigo_barras', 'categoria', 'tipo', 'medida', 'material', 'marca', 'nro_parte', 'unidad', 'ubicacion', 'stock_minimo', 'cantidad_reposicion', 'estado', 'maquinas', 'notas'] },
  plan: { hoja: 'planes_mant', pref: 'pl_', campos: ['maquina_id', 'tarea', 'intervalo_h', 'intervalo_dias', 'ultima_lectura', 'ultima_fecha', 'articulos_sugeridos', 'activo', 'notas'] },
  parametro: { hoja: 'parametros', campos: ['clave', 'valor', 'descripcion'] },
  estancia: { hoja: 'estancias', campos: ['nombre', 'codigo_senacsa', 'tiene_almacen', 'activo', 'orden'] }
};
const NUMERICOS = { costo_hora: 1, capacidad_tanque_l: 1, consumo_ref: 1, valor_compra: 1, valor_residual: 1, vida_util_h: 1, lectura_actual: 1, presupuesto_horas: 1, presupuesto_litros: 1, presupuesto_gs: 1, meta_avance: 1, horas_previstas: 1, orden: 1, superficie_ha: 1, capacidad_l: 1, stock_minimo: 1, cantidad_reposicion: 1, intervalo_h: 1, intervalo_dias: 1, ultima_lectura: 1, anio: 1 };
const SINO = { activo: 1, bloqueada: 1, tiene_totalizador: 1, tiene_almacen: 1 };
function guardar_(u, b) {
  if (Array.isArray(b.lista)) { const out = []; b.lista.slice(0, 300).forEach(x => out.push(guardarUno_(u, b.entidad, x))); return { ok: true, entidad: b.entidad, lista: out }; }
  return { ok: true, entidad: b.entidad, datos: guardarUno_(u, b.entidad, b.datos || {}) };
}
function guardarUno_(u, entidad, d) {
  const E = ENTIDADES[entidad]; exigir_(E, 'entidad desconocida: ' + entidad);
  exigir_(esGerente_(u) || (entidad === 'plan' && tiene_(u, 'mecanico')), 'solo el gerente puede modificar los catálogos');
  if (entidad === 'parametro') { exigir_(u.admin, 'los parámetros los cambia la administración'); const k = txt_(d.clave, 60); exigir_(k, 'falta la clave'); const f = porId_('parametros', k, 'clave'); const v = { clave: k, valor: txt_(d.valor, 200), descripcion: txt_(d.descripcion || (f && f.descripcion), 300) }; if (f) actualizar_('parametros', f, v); else agregar_('parametros', [v]); log_(u, 'parámetro', 'parametro', k, v.valor); return v; }
  if (entidad === 'estancia') { exigir_(u.admin, 'las estancias las cambia la administración'); const nom = txt_(d.nombre, 80); exigir_(nom, 'falta el nombre'); const f = porId_('estancias', d.nombre_original || nom, 'nombre'); const v = { nombre: nom, codigo_senacsa: txt_(d.codigo_senacsa, 20), tiene_almacen: si_(d.tiene_almacen) ? 'si' : 'no', activo: d.activo === undefined ? 'si' : (si_(d.activo) ? 'si' : 'no'), orden: num_(d.orden) }; if (f) actualizar_('estancias', f, v); else agregar_('estancias', [v]); log_(u, 'estancia', 'estancia', nom, ''); return v; }
  const prev = d.id ? porId_(E.hoja, d.id) : null; exigir_(!d.id || prev, 'no existe el registro a editar (' + d.id + ')');
  const v = {};
  E.campos.forEach(k => {
    if (!(k in d)) return; let x = d[k];
    if (NUMERICOS[k]) x = num_(x); else if (SINO[k]) x = si_(x) ? 'si' : 'no'; else if (Array.isArray(x)) x = x.join('|'); else x = txt_(x, k === 'notas' || k === 'descripcion' || k === 'aforo' ? 2000 : 200);
    v[k] = x; });
  if (!prev && !('activo' in v) && E.campos.indexOf('activo') >= 0) v.activo = 'si';
  const est = v.estancia !== undefined ? v.estancia : (prev ? prev.estancia : '');
  // permisos y validaciones por entidad
  if (entidad === 'usuario') {
    exigir_(v.nombre || (prev && prev.nombre), 'falta el nombre');
    const roles = lista_(v.roles !== undefined ? v.roles : (prev && prev.roles)).filter(r => ROLES.indexOf(r) >= 0); exigir_(roles.length, 'elija al menos un papel');
    if ((roles.indexOf('admin') >= 0 || roles.indexOf('gerente') >= 0) || (prev && (lista_(prev.roles).indexOf('admin') >= 0 || lista_(prev.roles).indexOf('gerente') >= 0))) exigir_(u.admin, 'solo la administración crea o edita gerentes');
    const ests = lista_(v.estancias !== undefined ? v.estancias : (prev && prev.estancias)); exigir_(ests.length, 'elija la estancia');
    exigir_(ests.every(e => e === '*' ? u.admin : puedeEst_(u, e)), 'solo puede dar acceso a sus estancias');
    if (prev) exigir_(lista_(prev.estancias).every(e => e === '*' ? u.admin : puedeEst_(u, e)) || u.admin, 'esta persona es de otra estancia');
    if (roles.indexOf('prestador') >= 0) exigir_(porId_('prestadores', v.prestador_id !== undefined ? v.prestador_id : (prev && prev.prestador_id)), 'el usuario prestador necesita la empresa (prestador)');
    v.roles = roles.join('|'); v.estancias = ests.join('|');
    if (d.codigo !== undefined && d.codigo !== '') { const c = String(d.codigo); exigir_(/^\d{6}$/.test(c), 'el código debe tener 6 números'); exigir_(!CODIGOS_FACILES_.test(c), 'elija un código menos fácil (no 111111 ni 123456)'); const h = hashCodigo_(c); exigir_(c !== claveMaestra_() && !filas_('usuarios').some(x => String(x.pin_hash) === h && (!prev || x.id !== prev.id)), 'ese código ya está en uso: elija otro'); v.pin_version = prev ? n0_(prev.pin_version) + 1 : 1; v._codigo = c; }
    if (!prev) v.estado = 'aprobado'; else if (v.activo !== undefined) v.estado = si_(v.activo) ? 'aprobado' : 'bloqueado';
  } else if (entidad === 'maquina') {
    exigir_(v.codigo || (prev && prev.codigo), 'falta el código interno (ej.: TR-01)'); exigir_(v.nombre || (prev && prev.nombre), 'falta el nombre');
    exigir_(est && gerenteDe_(u, est), 'solo puede cargar máquinas de sus estancias');
    if (v.codigo) { v.codigo = normTxt_(v.codigo); const otro = filas_('maquinas').find(m => normTxt_(m.codigo) === v.codigo && (!prev || m.id !== prev.id)); exigir_(!otro, 'ya existe otra máquina con el código ' + v.codigo); }
    if (v.unidad !== undefined) v.unidad = v.unidad === 'km' ? 'km' : 'h';
    if (v.propietario !== undefined) v.propietario = v.propietario === 'prestador' ? 'prestador' : 'propia';
  } else if (entidad === 'proyecto') {
    exigir_(v.nombre || (prev && prev.nombre), 'falta el nombre del proyecto'); exigir_(est && gerenteDe_(u, est), 'solo puede cargar proyectos de sus estancias');
    if (v.estado !== undefined) exigir_(['planificado', 'en_curso', 'pausado', 'terminado', 'cancelado'].indexOf(v.estado) >= 0, 'estado inválido');
    if (!prev) { v.codigo = siguienteCodigo_('proyectos', 'codigo', 'PRY-', 4); if (!v.estado) v.estado = 'en_curso'; v.creado_por = u.nombre; }
  } else if (entidad === 'asignacion') {
    const p = porId_('proyectos', v.proyecto_id !== undefined ? v.proyecto_id : (prev && prev.proyecto_id)); exigir_(p, 'proyecto inexistente'); exigir_(gerenteDe_(u, p.estancia), 'el proyecto es de otra estancia');
    exigir_((v.operador_id || (prev && prev.operador_id)) || (v.maquina_id || (prev && prev.maquina_id)), 'elija al menos el operador o la máquina');
  } else if (entidad === 'servicio') { exigir_(v.nombre || (prev && prev.nombre), 'falta el nombre del servicio'); }
  else if (entidad === 'pasto') { exigir_(v.nombre || (prev && prev.nombre), 'falta el nombre'); exigir_(est && gerenteDe_(u, est), 'solo puede cargar pastos de sus estancias'); if (!prev && filas_('pastos').some(p => String(p.estancia) === est && clave_(p.nombre) === clave_(v.nombre))) return Object.assign({ repetido: true }, filas_('pastos').find(p => String(p.estancia) === est && clave_(p.nombre) === clave_(v.nombre))); }
  else if (entidad === 'tanque') { exigir_(v.nombre || (prev && prev.nombre), 'falta el nombre del tanque'); exigir_(est && gerenteDe_(u, est), 'solo puede cargar tanques de sus estancias'); if (v.tipo !== undefined) v.tipo = v.tipo === 'movil' ? 'movil' : 'fijo'; }
  else if (entidad === 'prestador') { exigir_(v.nombre || (prev && prev.nombre), 'falta el nombre del prestador'); }
  else if (entidad === 'articulo') {
    exigir_(gerenteDe_(u, CONFIG.ESTANCIA_ALMACEN), 'solo el gerente edita artículos ya creados'); exigir_(prev, 'para crear un artículo use "Nuevo artículo" en el almacén');
    ['tipo', 'medida', 'material', 'marca', 'nro_parte', 'ubicacion'].forEach(k => { if (v[k] !== undefined) v[k] = normTxt_(v[k]); });
    if (v.estado !== undefined) exigir_(['activo', 'por_revisar', 'inactivo'].indexOf(v.estado) >= 0, 'estado inválido');
    v.descripcion = descArticulo_({ tipo: v.tipo !== undefined ? v.tipo : prev.tipo, medida: v.medida !== undefined ? v.medida : prev.medida, material: v.material !== undefined ? v.material : prev.material, marca: v.marca !== undefined ? v.marca : prev.marca, nro_parte: v.nro_parte !== undefined ? v.nro_parte : prev.nro_parte });
  } else if (entidad === 'plan') {
    const m = porId_('maquinas', v.maquina_id !== undefined ? v.maquina_id : (prev && prev.maquina_id)); exigir_(m, 'máquina inexistente'); exigir_(v.tarea || (prev && prev.tarea), 'falta la tarea');
    exigir_((v.intervalo_h !== undefined ? v.intervalo_h : (prev && num_(prev.intervalo_h))) || (v.intervalo_dias !== undefined ? v.intervalo_dias : (prev && num_(prev.intervalo_dias))), 'ponga cada cuántas horas o cada cuántos días');
  }
  const pin = v._codigo; delete v._codigo;
  let fila;
  if (prev) { if (CAB[E.hoja].indexOf('actualizado_en') >= 0) v.actualizado_en = ahoraIso_(); fila = actualizar_(E.hoja, prev, v); }
  else { v.id = nuevoId_(E.pref); if (CAB[E.hoja].indexOf('creado_en') >= 0) v.creado_en = ahoraIso_(); if (entidad === 'usuario') v.creado_por = u.nombre; if (entidad === 'tanque') { v.stock_teorico = 0; } fila = agregar_(E.hoja, [v])[0]; }
  if (pin) actualizar_('usuarios', fila, { pin_hash: hashCodigo_(pin) });
  log_(u, prev ? 'editó ' + entidad : 'creó ' + entidad, entidad, fila.id, (fila.codigo ? fila.codigo + ' ' : '') + (fila.nombre || fila.tarea || fila.descripcion || '') + (pin ? ' · código asignado' : ''));
  const out = Object.assign({}, fila); delete out.pin_hash; if (entidad === 'usuario') { out.tiene_pin = !!fila.pin_hash; out.roles = lista_(fila.roles); out.estancias = lista_(fila.estancias); }
  ['activo', 'bloqueada', 'tiene_totalizador'].forEach(k => { if (k in out) out[k] = si_(out[k]); }); if (entidad === 'tanque') out.encargados = lista_(fila.encargados);
  return out;
}

/* ===================== Vales de combustible para prestadores ===================== */
// El QR lleva "YPM1|V|<token>": un token aleatorio de 130 bits. El teléfono del encargado recibe solo SHA-256(token),
// así puede validar sin señal pero no puede fabricar vales. Si el QR no se lee, se escribe el código del vale y el
// código de control de 6 letras que va impreso en el vale (se valida con su propio hash).
function base32_(bytes) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0, out = ''; bytes.forEach(b => { val = (val << 8) | (b & 255); bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }); if (bits > 0) out += A[(val << (5 - bits)) & 31]; return out; }
function tokenVale_() { const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now() + '|' + secreto_()); return base32_(b.slice(0, 17)).slice(0, 26); }
function valePublico_(v, conToken) { const o = Object.assign({}, v); if (!conToken) delete o.token; delete o.control_hash; o.saldo = r_(n0_(v.litros) - n0_(v.litros_usados), 2); return o; }
function valeNuevo_(u, b) {
  exigir_(esGerente_(u), 'solo el gerente emite vales');
  const d = b.datos || {}; const pr = porId_('prestadores', d.prestador_id); exigir_(pr && si_(pr.activo), 'elija el prestador');
  const litros = num_(d.litros); exigir_(litros !== null && litros > 0 && litros <= 100000, 'litros inválidos');
  const precio = num_(d.precio_litro); const tipo = d.tipo === 'credito' ? 'credito' : 'prepago';
  const codigo = siguienteCodigo_('vales', 'codigo', 'VAL-', 4); const token = tokenVale_(); const control = token.slice(0, 6);
  const ests = lista_(d.estancias); const est = txt_(d.estancia_emisora, 80) || (estanciasDe_(u)[0] || '');
  const v = agregar_('vales', [{ id: nuevoId_('v_'), codigo: codigo, prestador_id: pr.id, prestador: pr.nombre, tipo: tipo, litros: litros, precio_litro: precio, total_gs: precio !== null ? r_(precio * litros, 0) : '', pagado: tipo === 'prepago' ? (d.pagado === false || d.pagado === 'no' ? 'no' : 'si') : 'no', recibo: txt_(d.recibo, 60), fecha: fecha_(d.fecha) || hoy_(), vence: fecha_(d.vence), estancias: ests.length ? ests.join('|') : '*', estancia_emisora: est, token: token, token_hash: sha256_(token), control_hash: sha256_(codigo + '|' + control), litros_usados: 0, saldo: litros, estado: 'activo', notas: txt_(d.notas, 500), creado_por: u.nombre, creado_en: ahoraIso_() }])[0];
  log_(u, 'emitió vale', 'vale', v.id, codigo + ' · ' + pr.nombre + ' · ' + litros + ' L (' + tipo + ')');
  return { ok: true, vale: valePublico_(v, true), qr: 'YPM1|V|' + token, control: control };
}
function valeAnular_(u, b) {
  exigir_(esGerente_(u), 'solo el gerente anula vales');
  const v = porId_('vales', b.id); exigir_(v, 'vale inexistente'); exigir_(txt_(b.motivo), 'escriba el motivo');
  actualizar_('vales', v, { estado: 'anulado', anulado_por: u.nombre, anulado_en: ahoraIso_(), motivo_anulacion: txt_(b.motivo, 500) });
  log_(u, 'anuló vale', 'vale', v.id, v.codigo + ' · ' + txt_(b.motivo, 300));
  return { ok: true, vale: valePublico_(v, true) };
}
function validarVale_(u, b) {
  exigir_(tiene_(u, 'combustible') || esGerente_(u), 'sin permiso');
  let v = null;
  if (b.token_hash) v = porId_('vales', String(b.token_hash), 'token_hash');
  else if (b.codigo && b.control) v = filas_('vales').find(x => String(x.codigo).toUpperCase() === String(b.codigo).toUpperCase() && String(x.control_hash) === sha256_(String(x.codigo) + '|' + String(b.control).toUpperCase().replace(/[^A-Z2-7]/g, '')));
  if (!v) return { ok: true, encontrado: false };
  return { ok: true, encontrado: true, vale: valePublico_(v, false) };
}

/* ===================== Aprobaciones y revisiones ===================== */
function decidir_(u, b) {
  const s = porId_('solicitudes', b.id); exigir_(s, 'solicitud inexistente');
  const dec = String(b.decision || '');
  if (dec === 'cancelada') { exigir_(String(s.solicitante_id) === u.id || gerenteDe_(u, s.estancia), 'solo quien la pidió puede cancelarla'); exigir_(String(s.estado) === 'pendiente', 'ya fue ' + s.estado); actualizar_('solicitudes', s, { estado: 'cancelada', decidido_en: ahoraIso_(), decidido_por: u.nombre, comentario: txt_(b.comentario, 500) }); return { ok: true, estado: 'cancelada' }; }
  exigir_(gerenteDe_(u, s.estancia), 'solo el gerente de ' + s.estancia + ' decide esta solicitud');
  exigir_(dec === 'aprobada' || dec === 'rechazada', 'decisión inválida');
  exigir_(String(s.estado) === 'pendiente', 'esta solicitud ya fue ' + s.estado + (s.decidido_por ? ' por ' + s.decidido_por : ''));
  const items = itemsDe_(s);
  if (dec === 'aprobada' && Array.isArray(b.items)) { const m = {}; b.items.forEach(x => m[x.articulo_id] = num_(x.cantidad_aprobada)); items.forEach(it => { if (m[it.articulo_id] !== undefined && m[it.articulo_id] !== null) it.cantidad_aprobada = m[it.articulo_id]; }); }
  actualizar_('solicitudes', s, { estado: dec, decidido_por: u.nombre, decidido_en: ahoraIso_(), comentario: txt_(b.comentario, 1000), items_json: JSON.stringify(items) });
  if (dec === 'aprobada' && s.tipo === 'ajuste') { const n = aplicarAjuste_(s, u); actualizar_('solicitudes', s, { estado: 'atendida', atendido_en: ahoraIso_(), atendido_por: u.nombre, comentario: (txt_(b.comentario, 900) + ' · ' + n + ' ajuste(s) aplicados').replace(/^ · /, '') }); }
  const sol = porId_('usuarios', s.solicitante_id);
  if (sol && sol.correo && si_(param_('avisos_correo'))) { try { MailApp.sendEmail({ to: String(sol.correo), subject: '[Maquinaria] Solicitud ' + s.codigo + ' ' + dec.toUpperCase(), body: 'Su solicitud ' + s.codigo + ' (' + s.tipo + ') fue ' + dec + ' por ' + u.nombre + (b.comentario ? '.\nComentario: ' + b.comentario : '.') + '\n\n' + s.resumen, name: 'Maquinaria y combustible · Ypoti' }); } catch (e) {} }
  log_(u, 'solicitud ' + dec, 'solicitud', s.id, s.codigo + (b.comentario ? ' · ' + b.comentario : ''));
  const o = Object.assign({}, s); o.items = itemsDe_(s); delete o.items_json; return { ok: true, solicitud: o };
}
function revisar_(u, b) {
  const tipo = String(b.ref_tipo || ''); const dec = String(b.decision || ''); const com = txt_(b.comentario, 1000);
  if (tipo === 'despacho') {
    const d = porId_('despachos', b.id); exigir_(d, 'despacho inexistente'); exigir_(gerenteDe_(u, d.estancia), 'solo el gerente de ' + d.estancia);
    exigir_(dec === 'aprobado' || dec === 'rechazado', 'decisión inválida');
    actualizar_('despachos', d, { estado: dec, revisado_por: u.nombre, revisado_en: ahoraIso_(), comentario_revision: com });
    if (dec === 'rechazado') alerta_('rechazado|' + d.id, 'despacho_rechazado', 'alta', d.estancia, 'despacho', d.id, 'Despacho no autorizado · ' + (d.maquina || d.prestador || d.receptor), d.litros + ' L el ' + d.fecha + ' ' + d.hora + ' (' + d.tanque + ', ' + d.encargado + '). ' + com, d.fecha);
    log_(u, 'despacho ' + dec, 'despacho', d.id, com); return { ok: true, estado: dec };
  }
  if (tipo === 'alerta') { const a = porId_('alertas', b.id); exigir_(a, 'alerta inexistente'); exigir_(!a.estancia || gerenteDe_(u, a.estancia), 'sin permiso'); actualizar_('alertas', a, { estado: 'revisada', revisado_por: u.nombre, revisado_en: ahoraIso_(), comentario: com }); return { ok: true, estado: 'revisada' }; }
  if (tipo === 'falla') { const f = porId_('fallas', b.id); exigir_(f, 'falla inexistente'); exigir_(gerenteDe_(u, f.estancia) || tiene_(u, 'mecanico'), 'sin permiso'); exigir_(['en_reparacion', 'resuelta', 'descartada', 'abierta'].indexOf(dec) >= 0, 'decisión inválida'); actualizar_('fallas', f, { estado: dec, revisado_por: u.nombre, revisado_en: ahoraIso_(), comentario: com }); return { ok: true, estado: dec }; }
  if (tipo === 'articulo') { const a = porId_('articulos', b.id); exigir_(a, 'artículo inexistente'); exigir_(gerenteDe_(u, CONFIG.ESTANCIA_ALMACEN), 'sin permiso'); exigir_(['activo', 'inactivo'].indexOf(dec) >= 0, 'decisión inválida'); actualizar_('articulos', a, { estado: dec, actualizado_en: ahoraIso_() }); log_(u, 'artículo ' + dec, 'articulo', a.id, a.codigo + ' ' + a.descripcion); return { ok: true, estado: dec }; }
  throw rechazo_('tipo de revisión desconocido');
}
function anular_(u, b) {
  const hojas = { despacho: 'despachos', lectura: 'lecturas_bomba', descarga: 'descargas', parte: 'partes', mantenimiento: 'mantenimientos', movimiento: 'movimientos' };
  const h = hojas[b.ref_tipo]; exigir_(h, 'tipo inválido'); exigir_(txt_(b.motivo), 'escriba el motivo de la anulación');
  const filas = b.ref_tipo === 'movimiento' ? filas_('movimientos').filter(m => String(m.evento_id) === String(b.id) || String(m.id) === String(b.id)) : [porId_(h, b.id)].filter(Boolean);
  exigir_(filas.length, 'registro inexistente');
  filas.forEach(f => { exigir_(gerenteDe_(u, f.estancia), 'solo el gerente de ' + f.estancia + ' puede anular'); });
  filas.forEach(f => { const c = { estado: 'anulado' }; if ('observaciones' in f) c.observaciones = ('ANULADO por ' + u.nombre + ': ' + txt_(b.motivo, 300) + (f.observaciones ? ' · ' + f.observaciones : '')).slice(0, 1500); actualizar_(h, f, c); });
  if (b.ref_tipo === 'despacho') { const t = porId_('descargas', String(b.id) + '-t'); if (t) actualizar_('descargas', t, { estado: 'anulado' }); }
  log_(u, 'anuló ' + b.ref_tipo, b.ref_tipo, b.id, txt_(b.motivo, 300));
  recalcular_();
  return { ok: true, anulados: filas.length };
}
function fusionarArticulo_(u, b) {
  exigir_(gerenteDe_(u, CONFIG.ESTANCIA_ALMACEN), 'solo el gerente fusiona artículos');
  const o = porId_('articulos', b.origen_id), d = articuloResuelto_(b.destino_id); exigir_(o && d && o.id !== d.id, 'elija dos artículos distintos');
  filas_('movimientos').forEach(m => { if (String(m.articulo_id) === String(o.id)) actualizar_('movimientos', m, { articulo_id: d.id, codigo: d.codigo, descripcion: d.descripcion, observaciones: ('fusionado desde ' + o.codigo + (m.observaciones ? ' · ' + m.observaciones : '')).slice(0, 500) }); });
  actualizar_('articulos', o, { estado: 'fusionado', fusionado_en: d.id, stock: 0, actualizado_en: ahoraIso_() });
  if (!d.codigo_barras && o.codigo_barras) actualizar_('articulos', d, { codigo_barras: o.codigo_barras });
  recalcularStock_();
  log_(u, 'fusionó artículos', 'articulo', d.id, o.codigo + ' ' + o.descripcion + ' → ' + d.codigo + ' ' + d.descripcion);
  return { ok: true, destino: Object.assign({}, porId_('articulos', d.id)) };
}

/* ===================== Recalcular: rateio, costos, conciliación de tanques y alertas ===================== */
function tolLectura_(m) { return (m && m.unidad === 'km') ? paramNum_('tolerancia_lectura_km', 5) : paramNum_('tolerancia_lectura', 0.5); }
function estadoPlan_(pl, m, hoy) {
  const ih = num_(pl.intervalo_h), id = num_(pl.intervalo_dias), ul = num_(pl.ultima_lectura), uf = fecha_(pl.ultima_fecha), la = num_(m && m.lectura_actual);
  const o = { estado: 'ok', faltan: null, faltan_dias: null, proxima_lectura: null, proxima_fecha: '', texto: '' }; const partes = [];
  if (ih) { if (ul === null) { o.estado = 'sin_datos'; partes.push('sin registro de la última vez (cada ' + ih + ' ' + ((m && m.unidad) || 'h') + ')'); } else { o.proxima_lectura = r_(ul + ih, 1); if (la !== null) { o.faltan = r_(o.proxima_lectura - la, 1); if (o.faltan <= 0) o.estado = 'vencido'; else if (o.faltan <= ih * 0.1) o.estado = 'proximo'; partes.push(o.faltan <= 0 ? 'pasado ' + r_(-o.faltan, 1) + ' ' + (m.unidad || 'h') + ' (tocaba a las ' + o.proxima_lectura + ')' : 'faltan ' + o.faltan + ' ' + (m.unidad || 'h') + ' (a las ' + o.proxima_lectura + ')'); } } }
  if (id) { if (!uf) { if (o.estado === 'ok') o.estado = 'sin_datos'; if (!ih) partes.push('sin registro de la última vez (cada ' + id + ' días)'); } else { const pf = new Date(uf + 'T12:00:00'); pf.setDate(pf.getDate() + id); o.proxima_fecha = Utilities.formatDate(pf, tz_(), 'yyyy-MM-dd'); o.faltan_dias = Math.round((pf - new Date(hoy + 'T12:00:00')) / 86400000); if (o.faltan_dias <= 0) o.estado = 'vencido'; else if (o.faltan_dias <= Math.max(3, id * 0.1) && o.estado !== 'vencido') o.estado = 'proximo'; partes.push(o.faltan_dias <= 0 ? 'vencido hace ' + (-o.faltan_dias) + ' días' : 'faltan ' + o.faltan_dias + ' días'); } }
  o.texto = partes.join(' · '); return o;
}
function recalcularStock_(movsIn) {
  const movs = (movsIn || filas_('movimientos').filter(m => String(m.estado) !== 'anulado')).slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || String(a.id).localeCompare(String(b.id)));
  const st = {};
  movs.forEach(m => { const a = articuloResuelto_(m.articulo_id); if (!a) return; const o = st[a.id] || (st[a.id] = { s: 0, c: 0 }); const q = n0_(m.cantidad);
    if (m.tipo === 'entrada') { const cu = num_(m.costo_unitario); const c = cu !== null ? cu : o.c; const ns = o.s + q; o.c = (o.s > 0 && ns > 0) ? (o.s * o.c + q * c) / ns : c; o.s = ns; } else o.s += q; });
  filas_('articulos').forEach(a => { if (String(a.estado) === 'fusionado') { if (n0_(a.stock) !== 0) actualizar_('articulos', a, { stock: 0 }); return; } const o = st[a.id] || { s: 0, c: n0_(a.costo_promedio) }; const s = r_(o.s, 4), c = r_(o.c, 2); if (Math.abs(n0_(a.stock) - s) > 1e-6 || Math.abs(n0_(a.costo_promedio) - c) > 0.005) actualizar_('articulos', a, { stock: s, costo_promedio: c }); });
}
function recalcular_() {
  const P = parametros_(); const hoy = hoy_();
  const tol = n0_(P.tolerancia_bomba_l) || 2, tolC = n0_(P.tolerancia_consumo_pct) || 30;
  const maqs = filas_('maquinas'); const M = {}; maqs.forEach(m => M[String(m.id)] = m);
  const U = {}; filas_('usuarios').forEach(x => U[String(x.id)] = x);
  const PR = {}; filas_('proyectos').forEach(p => PR[String(p.id)] = p);
  const partes = filas_('partes').filter(p => String(p.estado) !== 'anulado'); const PA = {}; partes.forEach(p => PA[String(p.id)] = p);
  const tramos = filas_('tramos').filter(t => PA[String(t.parte_id)] && String(PA[String(t.parte_id)].estado) === 'cerrado');
  const desp = filas_('despachos').filter(d => String(d.estado) !== 'anulado');
  const lect = filas_('lecturas_bomba').filter(l => String(l.estado) !== 'anulado');
  const desc = filas_('descargas').filter(d => String(d.estado) !== 'anulado');
  const movs = filas_('movimientos').filter(m => String(m.estado) !== 'anulado');
  const mants = filas_('mantenimientos').filter(m => String(m.estado) !== 'anulado');
  const cargas = filas_('cargas_operador').filter(c => PA[String(c.parte_id)] && String(PA[String(c.parte_id)].estado) === 'cerrado');

  // 1) Lectura actual de cada máquina (solo sube; si hubo un error se corrige a mano en la máquina)
  const maxL = {}; const ponL = (id, v, f) => { const n = num_(v); if (n === null || !id) return; const k = String(id); if (!maxL[k] || n > maxL[k].v) maxL[k] = { v: n, f: f }; };
  partes.forEach(p => { ponL(p.maquina_id, p.lectura_inicio, p.fecha); ponL(p.maquina_id, p.lectura_fin, p.fecha); });
  desp.forEach(d => ponL(d.maquina_id, d.lectura, d.fecha)); mants.forEach(m => ponL(m.maquina_id, m.lectura, m.fecha));
  maqs.forEach(m => { const x = maxL[String(m.id)]; if (x && (num_(m.lectura_actual) === null || x.v > n0_(m.lectura_actual) + 1e-6)) actualizar_('maquinas', m, { lectura_actual: x.v, lectura_fecha: x.f }); });
  const ud = {}; desp.forEach(d => { if (!d.maquina_id) return; const k = String(d.maquina_id); const t = ts_(d.fecha, d.hora); if (!ud[k] || t > ud[k].t) ud[k] = { t: t, d: d }; });
  maqs.forEach(m => { const x = ud[String(m.id)]; const c = x ? { ult_despacho_fecha: x.d.fecha, ult_despacho_hora: x.d.hora, ult_despacho_litros: num_(x.d.litros), ult_despacho_lectura: num_(x.d.lectura) } : { ult_despacho_fecha: '', ult_despacho_hora: '', ult_despacho_litros: '', ult_despacho_lectura: '' }; if (String(m.ult_despacho_fecha || '') !== String(c.ult_despacho_fecha) || String(m.ult_despacho_hora || '') !== String(c.ult_despacho_hora) || String(m.ult_despacho_litros) !== String(c.ult_despacho_litros === null ? '' : c.ult_despacho_litros)) actualizar_('maquinas', m, c); });

  // 2) Tanques: stock teórico (entradas − despachos) y último totalizador
  filas_('tanques').forEach(t => {
    const id = String(t.id); let ent = 0, sal = 0, ult = null;
    desc.forEach(x => { if (String(x.tanque_id) === id) ent += n0_(x.litros); });
    desp.forEach(x => { if (String(x.tanque_id) !== id) return; sal += n0_(x.litros); const v = num_(x.totalizador_despues); if (v !== null && (!ult || String(x.ts) >= ult.ts)) ult = { ts: String(x.ts), v: v }; });
    lect.forEach(x => { if (String(x.tanque_id) !== id) return; const v = num_(x.totalizador); if (v !== null && (!ult || String(x.ts) >= ult.ts)) ult = { ts: String(x.ts), v: v }; });
    const c = { stock_teorico: r_(ent - sal, 2) }; if (ult) { c.totalizador_actual = ult.v; c.totalizador_ts = ult.ts; }
    if (Math.abs(n0_(t.stock_teorico) - c.stock_teorico) > 1e-6 || (ult && (num_(t.totalizador_actual) !== ult.v || String(t.totalizador_ts) !== ult.ts))) actualizar_('tanques', t, c);
  });

  // 3) Vales: litros usados, saldo y estado
  filas_('vales').forEach(v => {
    let us = 0; desp.forEach(d => { if (String(d.vale_id) === String(v.id)) us += n0_(d.litros); }); us = r_(us, 2);
    const saldo = r_(n0_(v.litros) - us, 2); let est = String(v.estado);
    if (est !== 'anulado') est = saldo <= 0.01 ? 'agotado' : ((v.vence && fecha_(v.vence) < hoy) ? 'vencido' : 'activo');
    if (Math.abs(n0_(v.litros_usados) - us) > 1e-6 || Math.abs(n0_(v.saldo) - saldo) > 1e-6 || est !== String(v.estado)) actualizar_('vales', v, { litros_usados: us, saldo: saldo, estado: est });
    if (saldo < -0.5 && !filas_('alertas').some(a => String(a.tipo) === 'vale_sobregiro' && String(a.titulo).indexOf(String(v.codigo)) >= 0)) alerta_('sobregiro_vale|' + v.id, 'vale_sobregiro', 'alta', v.estancia_emisora, 'vale', v.id, 'Vale sobregirado · ' + v.codigo + ' · ' + v.prestador, 'Se despacharon ' + us + ' L de ' + v.litros + ' L (' + r_(-saldo, 1) + ' L de más).', hoy);
  });

  // 4) Stock del almacén (se rehace desde los movimientos)
  recalcularStock_(movs);

  // 5) Costo del litro por mes: promedio ponderado de las descargas de proveedor con precio
  const pm = {}; desc.forEach(x => { if (String(x.origen) !== 'proveedor') return; const p = num_(x.precio_litro); if (p === null || p <= 0) return; const l = n0_(x.litros_documento) || n0_(x.litros); if (l <= 0) return; const k = mes_(x.fecha); const o = pm[k] || (pm[k] = { l: 0, g: 0 }); o.l += l; o.g += l * p; });
  const mesesP = Object.keys(pm).sort(); const refL = n0_(P.costo_litro_ref);
  const costoLitro = mes => { if (pm[mes]) return pm[mes].g / pm[mes].l; let u = null; mesesP.forEach(k => { if (k <= mes) u = k; }); if (u) return pm[u].g / pm[u].l; if (refL > 0) return refL; return mesesP.length ? pm[mesesP[0]].g / pm[mesesP[0]].l : 0; };

  // 6) Horas, litros, repuestos y mantenimiento por máquina y mes
  const horasTramo = t => { const m = M[String(t.maquina_id)]; const u = num_(t.uso); if (m && m.unidad === 'km') return n0_(t.horas_reloj); return u !== null ? u : n0_(t.horas_reloj); };
  const HM = {}; const hmk = (mid, f) => { const k = String(mid) + '|' + mes_(f); return HM[k] || (HM[k] = { mid: String(mid), mes: mes_(f), horas: 0, uso: 0, litros: 0, rep: 0, mant: 0 }); };
  tramos.forEach(t => { const o = hmk(t.maquina_id, t.fecha); o.horas += horasTramo(t); o.uso += n0_(t.uso); });
  desp.forEach(d => { if (String(d.destino) === 'maquina' && d.maquina_id && M[String(d.maquina_id)] && String(M[String(d.maquina_id)].propietario) !== 'prestador') hmk(d.maquina_id, d.fecha).litros += n0_(d.litros); });
  movs.forEach(m => { if (String(m.tipo) === 'salida' && String(m.destino_tipo) === 'maquina' && m.destino_id && M[String(m.destino_id)]) hmk(m.destino_id, m.fecha).rep += Math.abs(n0_(m.total)); });
  mants.forEach(mt => { if (M[String(mt.maquina_id)]) hmk(mt.maquina_id, mt.fecha).mant += n0_(mt.costo_total_ext); });
  const costos = []; const CM = {};
  Object.keys(HM).sort().forEach(k => {
    const o = HM[k]; const m = M[o.mid]; if (!m) return;
    const vu = n0_(m.vida_util_h); const depH = vu > 0 ? Math.max(0, n0_(m.valor_compra) - n0_(m.valor_residual)) / vu : 0;
    const cl = costoLitro(o.mes); const comb = o.litros * cl; const dep = o.horas * depH; const tot = comb + o.rep + o.mant + dep;
    const sin = o.horas > 0 ? (o.rep + o.mant + dep) / o.horas : 0; CM[k] = { sin: sin, cl: cl, lh: o.horas > 0 ? o.litros / o.horas : 0 };
    costos.push({ mes: o.mes, maquina_id: m.id, maquina: nombreMaquina_(m), estancia: m.estancia, unidad: m.unidad || 'h', horas: r_(o.horas, 2), uso: r_(o.uso, 2), litros: r_(o.litros, 2), l_h: o.horas > 0 ? r_(o.litros / o.horas, 2) : '', l_100km: (m.unidad === 'km' && o.uso > 0) ? r_(o.litros / o.uso * 100, 2) : '', costo_litro: r_(cl, 2), costo_combustible: r_(comb, 0), costo_repuestos: r_(o.rep, 0), costo_mantenimiento: r_(o.mant, 0), depreciacion: r_(dep, 0), costo_total: r_(tot, 0), costo_hora: o.horas > 0 ? r_(tot / o.horas, 0) : '', costo_hora_sin_combustible: o.horas > 0 ? r_(sin, 0) : '' });
  });

  // 7) Rateio: cada tramo del parte recibe horas máquina, horas operador, litros (proporcionales a las horas de la máquina en el mes) y costos
  const rat = [];
  tramos.forEach(t => {
    const p = PA[String(t.parte_id)]; const m = M[String(t.maquina_id)]; const k = String(t.maquina_id) + '|' + mes_(t.fecha); const c = CM[k] || { sin: 0, cl: costoLitro(mes_(t.fecha)), lh: 0 };
    const hm = horasTramo(t); const litros = hm * c.lh; const hr = n0_(p.horas_reloj); const fop = (hr > 0 && num_(p.horas_operador) !== null) ? n0_(p.horas_operador) / hr : 1;
    const hop = n0_(t.horas_reloj) * fop; const op = U[String(t.operador_id)]; const cho = op ? n0_(op.costo_hora) : 0;
    const cc = n0_(litros * c.cl), cmq = hm * c.sin, cop = hop * cho;
    rat.push({ mes: mes_(t.fecha), fecha: t.fecha, estancia: t.estancia, origen: 'tramo', proyecto_id: t.proyecto_id, proyecto: t.proyecto || '(sin proyecto)', centro_costo: t.centro_costo || '(sin centro de costo)', servicio: t.servicio, lugar: t.lugar, maquina_id: t.maquina_id, maquina: t.maquina, operador_id: t.operador_id, operador: t.operador,
      uso_maquina: num_(t.uso), horas_maquina: r_(hm, 2), horas_operador: r_(hop, 2), l_h_mes: r_(c.lh, 2), litros: r_(litros, 2), costo_litro: r_(c.cl, 2), costo_combustible: r_(cc, 0), costo_hora_maquina: r_(c.sin, 0), costo_maquina: r_(cmq, 0), costo_hora_operador: cho, costo_operador: r_(cop, 0), costo_almacen: 0, costo_total: r_(cc + cmq + cop, 0), avance: num_(t.avance), unidad_avance: t.unidad_avance, parte_id: t.parte_id, tramo: t.nro });
  });
  Object.keys(HM).forEach(k => { const o = HM[k]; const m = M[o.mid]; if (!m || o.horas > 0) return; if (o.litros <= 0 && o.rep + o.mant <= 0) return; const cl = costoLitro(o.mes); const cc = o.litros * cl;
    rat.push({ mes: o.mes, fecha: o.mes + '-01', estancia: m.estancia, origen: 'maquina_sin_partes', proyecto: '(sin parte en el mes)', centro_costo: '(máquina sin partes)', maquina_id: m.id, maquina: nombreMaquina_(m), horas_maquina: 0, horas_operador: 0, litros: r_(o.litros, 2), costo_litro: r_(cl, 2), costo_combustible: r_(cc, 0), costo_maquina: r_(o.rep + o.mant, 0), costo_operador: 0, costo_almacen: 0, costo_total: r_(cc + o.rep + o.mant, 0) }); });
  movs.forEach(mv => { if (String(mv.tipo) !== 'salida' || String(mv.destino_tipo) !== 'proyecto') return; const p = PR[String(mv.destino_id)]; const v = Math.abs(n0_(mv.total));
    rat.push({ mes: mes_(mv.fecha), fecha: mv.fecha, estancia: p ? p.estancia : mv.estancia, origen: 'almacen', proyecto_id: mv.destino_id, proyecto: p ? p.codigo + ' · ' + p.nombre : mv.destino, centro_costo: (p && p.centro_costo) || '(sin centro de costo)', servicio: mv.codigo + ' ' + mv.descripcion, litros: 0, costo_almacen: r_(v, 0), costo_total: r_(v, 0), parte_id: mv.evento_id }); });
  rat.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));

  // 8) Conciliación de cada tanque por día; saltos del totalizador = litros que salieron sin despacho registrado
  const conc = [];
  filas_('tanques').forEach(t => {
    const id = String(t.id); const conTot = si_(t.tiene_totalizador); const evs = [];
    lect.forEach(l => { if (String(l.tanque_id) === id) evs.push({ ts: String(l.ts), o: 1, k: 'l', x: l }); });
    desp.forEach(d => { if (String(d.tanque_id) === id) evs.push({ ts: String(d.ts), o: 2, k: 'd', x: d }); });
    desc.forEach(d => { if (String(d.tanque_id) === id) evs.push({ ts: String(d.ts), o: 0, k: 'e', x: d }); });
    evs.sort((a, b) => a.ts.localeCompare(b.ts) || (a.k === 'l' && b.k === 'l' ? ((a.x.tipo === 'cierre') - (b.x.tipo === 'cierre')) : a.o - b.o));
    let stock = 0, prevT = null; const D = {}; const dia = f => D[f] || (D[f] = { ap: null, ci: null, fi: null, la: null, desp: 0, n: 0, saltos: 0, ent: 0, med: null, stMed: null, st: 0 });
    evs.forEach(e => {
      const f = e.ts.slice(0, 10); const x = dia(f);
      if (e.k === 'e') { stock += n0_(e.x.litros); x.ent += n0_(e.x.litros); }
      else if (e.k === 'd') {
        stock -= n0_(e.x.litros); x.desp += n0_(e.x.litros); x.n++;
        if (conTot) { const a = num_(e.x.totalizador_antes), b = num_(e.x.totalizador_despues);
          if (a !== null) { if (prevT !== null && a - prevT > tol) { x.saltos += a - prevT; alerta_('salto|' + e.x.id, 'salto_totalizador', 'alta', t.estancia, 'despacho', e.x.id, 'Litros sin registrar en la bomba · ' + t.nombre, 'Antes del despacho del ' + e.x.fecha + ' ' + e.x.hora + ' (' + e.x.encargado + ') el totalizador marcaba ' + a + ' y el registro anterior terminaba en ' + prevT + ': ' + r_(a - prevT, 1) + ' L sin despacho registrado.', e.x.fecha); } if (x.fi === null) x.fi = a; }
          if (b !== null) { prevT = b; x.la = b; } }
      } else {
        const v = num_(e.x.totalizador);
        if (conTot && v !== null) { if (prevT !== null && v - prevT > tol) { x.saltos += v - prevT; alerta_('salto|' + e.x.id, 'salto_totalizador', 'alta', t.estancia, 'lectura', e.x.id, 'Litros sin registrar en la bomba · ' + t.nombre, 'En la ' + e.x.tipo + ' del ' + e.x.fecha + ' ' + e.x.hora + ' el totalizador marca ' + v + ' y el registro anterior terminaba en ' + prevT + ': ' + r_(v - prevT, 1) + ' L sin despacho registrado.', e.x.fecha); }
          if (e.x.tipo === 'apertura' && x.ap === null) x.ap = v; if (e.x.tipo === 'cierre') x.ci = v; if (x.fi === null) x.fi = v; x.la = v; prevT = v; }
        const med = num_(e.x.litros_medidos); if (med !== null) { x.med = med; x.stMed = stock; }
      }
      x.st = stock;
    });
    Object.keys(D).sort().forEach(f => { const x = D[f]; const ap = x.ap !== null ? x.ap : x.fi, ci = x.ci !== null ? x.ci : x.la; const bomba = (conTot && ap !== null && ci !== null) ? r_(ci - ap, 2) : null; const difB = bomba !== null ? r_(bomba - x.desp, 2) : null; const difS = x.med !== null ? r_(x.med - x.stMed, 2) : null; const tolS = Math.max(tol, n0_(t.capacidad_l) * (n0_(P.tolerancia_stock_pct) || 1) / 100);
      const estado = (x.saltos > tol || (difB !== null && Math.abs(difB) > tol) || (difS !== null && difS < -tolS)) ? 'revisar' : ((conTot && x.ci === null && x.n > 0 && f < hoy) ? 'sin_cierre' : 'ok');
      conc.push({ fecha: f, estancia: t.estancia, tanque_id: t.id, tanque: t.nombre, apertura: ap, cierre: ci, bomba_l: bomba, despachos_l: r_(x.desp, 2), cantidad_despachos: x.n, diferencia_bomba_l: difB, saltos_l: r_(x.saltos, 2), descargas_l: r_(x.ent, 2), stock_teorico: r_(x.st, 2), medido_l: x.med, diferencia_stock_l: difS, estado: estado }); });
  });

  // 9) Partes encadenados por máquina: horas (o km) usadas sin parte y lecturas que retroceden
  const porM = {}; partes.filter(p => String(p.estado) === 'cerrado').forEach(p => (porM[String(p.maquina_id)] = porM[String(p.maquina_id)] || []).push(p));
  Object.keys(porM).forEach(mid => { const m = M[mid]; const tl = tolLectura_(m); const un = (m && m.unidad === 'km') ? 'km' : 'h';
    const ps = porM[mid].sort((a, b) => (String(a.fecha) + String(a.hora_inicio)).localeCompare(String(b.fecha) + String(b.hora_inicio)) || n0_(a.lectura_inicio) - n0_(b.lectura_inicio));
    for (let i = 1; i < ps.length; i++) { const a = ps[i - 1], b = ps[i]; const gap = r_(n0_(b.lectura_inicio) - n0_(a.lectura_fin), 2);
      if (gap > tl) alerta_('sin_parte|' + a.id + '|' + b.id, 'uso_sin_parte', gap > tl * 4 ? 'alta' : 'media', b.estancia, 'parte', b.id, 'Uso de la máquina sin parte · ' + b.maquina, 'El parte de ' + a.operador + ' (' + a.fecha + ') terminó en ' + a.lectura_fin + ' y el de ' + b.operador + ' (' + b.fecha + ') empezó en ' + b.lectura_inicio + ': ' + gap + ' ' + un + ' sin registrar.', b.fecha);
      else if (gap < -tl) alerta_('solape|' + a.id + '|' + b.id, 'lectura_retrocede', 'media', b.estancia, 'parte', b.id, 'Lecturas superpuestas · ' + b.maquina, 'El parte de ' + b.operador + ' (' + b.fecha + ') empezó en ' + b.lectura_inicio + ', antes del final del parte anterior de ' + a.operador + ' (' + a.lectura_fin + ').', b.fecha); } });

  // 10) Consumo del mes contra la referencia de la máquina
  Object.keys(HM).forEach(k => { const o = HM[k]; const m = M[o.mid]; if (!m) return; const ref = n0_(m.consumo_ref); if (!ref || o.litros <= 0) return; const km = m.unidad === 'km';
    const val = km ? (o.uso >= 100 ? o.litros / o.uso * 100 : null) : (o.horas >= 10 ? o.litros / o.horas : null);
    if (val !== null && val > ref * (1 + tolC / 100)) alerta_('consumo|' + k, 'consumo_alto', 'media', m.estancia, 'maquina', m.id, 'Consumo alto · ' + nombreMaquina_(m), o.mes + ': ' + r_(val, 1) + (km ? ' L/100 km' : ' L/h') + ' contra ' + ref + ' de referencia (' + r_(o.litros, 0) + ' L en ' + (km ? r_(o.uso, 0) + ' km' : r_(o.horas, 1) + ' h') + ').', o.mes + '-01'); });

  // 11) Lo que declaró el operador contra lo que registró el encargado (por máquina y día)
  const decl = {}; cargas.forEach(c => { if (/externa|estaci/i.test(String(c.lugar))) return; const k = String(c.maquina_id) + '|' + c.fecha; const o = decl[k] || (decl[k] = { l: 0, parte: c.parte_id, est: c.estancia, f: c.fecha, mid: String(c.maquina_id) }); o.l += n0_(c.litros); });
  const reg = {}; desp.forEach(d => { if (!d.maquina_id) return; const k = String(d.maquina_id) + '|' + d.fecha; reg[k] = (reg[k] || 0) + n0_(d.litros); });
  Object.keys(decl).forEach(k => { const o = decl[k]; if (o.l <= 0) return; const r = reg[k] || 0; const m = M[o.mid];
    if (r <= 0) alerta_('carga_sin_despacho|' + k, 'carga_sin_despacho', 'media', o.est, 'parte', o.parte, 'Carga sin despacho registrado · ' + nombreMaquina_(m), 'El operador declaró ' + r_(o.l, 1) + ' L el ' + o.f + ' y no hay despacho del encargado para esa máquina ese día.', o.f);
    else if (Math.abs(r - o.l) > Math.max(5, o.l * 0.05)) alerta_('carga_difiere|' + k, 'carga_difiere', 'alta', o.est, 'parte', o.parte, 'Litros distintos operador / encargado · ' + nombreMaquina_(m), o.f + ': el operador declaró ' + r_(o.l, 1) + ' L y el encargado registró ' + r_(r, 1) + ' L (' + (r > o.l ? '+' : '') + r_(r - o.l, 1) + ' L).', o.f); });

  // 12) Cargas que quien recibió todavía no confirmó (no leyó el comprobante del encargado)
  const hc = n0_(P.horas_confirmacion) || 24; const limC = Date.now() - hc * 3600000; const lim30 = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), tz_(), 'yyyy-MM-dd');
  desp.forEach(d => { if (String(d.confirmacion) !== 'pendiente' || String(d.estado) === 'rechazado' || String(d.fecha) < lim30) return; const tt = Date.parse(String(d.creado_en || '')) || Date.parse(String(d.recibido_en || '')); if (!tt || tt > limC) return;
    alerta_('sinconf|' + d.id, 'despacho_sin_confirmar', 'media', d.estancia, 'despacho', d.id, 'Carga sin confirmar · ' + (String(d.maquina || '').split(' · ')[0] || d.prestador || ''), d.litros + ' L el ' + d.fecha + ' ' + d.hora + ' (' + d.tanque + ', ' + d.encargado + '): ' + (d.destino === 'vale' ? 'el prestador' : 'el operador') + ' no leyó el comprobante del encargado en ' + hc + ' h.', d.fecha); });

  // 13) Mantenimiento preventivo vencido
  filas_('planes_mant').forEach(pl => { const m = M[String(pl.maquina_id)]; if (!m || !si_(pl.activo) || !si_(m.activo)) return; const st = estadoPlan_(pl, m, hoy);
    if (st.estado === 'vencido') alerta_('mant|' + pl.id + '|' + (pl.ultima_lectura || '') + '|' + (pl.ultima_fecha || ''), 'mantenimiento_vencido', 'media', m.estancia, 'maquina', m.id, 'Mantenimiento vencido · ' + nombreMaquina_(m), pl.tarea + ': ' + st.texto + '.', hoy); });

  reemplazarTodo_('rateio', rat); reemplazarTodo_('conciliacion', conc); reemplazarTodo_('costos_maquina', costos);
  props_().setProperties({ ULTIMO_RECALCULO: ahoraIso_(), ULTIMO_RECALCULO_MS: String(Date.now()) }); props_().deleteProperty('SUCIO');
  return { rateio: rat.length, conciliacion: conc.length, costos: costos.length };
}
function recalcularPorDisparador() { const lock = LockService.getScriptLock(); if (!lock.tryLock(60000)) return; try { recalcular_(); flushLog_(); } finally { lock.releaseLock(); } }

/* ===================== Tablero del gerente ===================== */
function sumar_(arr, k) { let s = 0; arr.forEach(x => s += n0_(x[k])); return s; }
function agrupar_(arr, kf) { const o = {}; arr.forEach(x => { const k = kf(x); (o[k] = o[k] || []).push(x); }); return o; }
function tablero_(u, b) {
  exigir_(esGerente_(u), 'el tablero es del gerente');
  const P = props_(); const ultMs = Number(P.getProperty('ULTIMO_RECALCULO_MS') || 0);
  if (b.recalcular || !ultMs || Date.now() - ultMs > 90 * 60000) recalcular_(); // los datos nuevos los incorpora el disparador cada 30 minutos
  const ests = (b.estancia && b.estancia !== '*') ? [String(b.estancia)] : estanciasDe_(u);
  exigir_(ests.every(e => puedeEst_(u, e)), 'sin acceso a esa estancia');
  const enE = e => ests.indexOf(String(e)) >= 0; const hoy = hoy_();
  const desde = fecha_(b.desde) || (hoy.slice(0, 8) + '01'), hasta = fecha_(b.hasta) || hoy; const enP = f => String(f) >= desde && String(f) <= hasta;
  const rat = filas_('rateio').filter(r => enE(r.estancia)); const ratP = rat.filter(r => enP(r.fecha));
  const desp = filas_('despachos').filter(d => String(d.estado) !== 'anulado' && enE(d.estancia)); const despP = desp.filter(d => enP(d.fecha));
  const M = {}; filas_('maquinas').forEach(m => M[String(m.id)] = m);
  const partes = filas_('partes').filter(p => String(p.estado) !== 'anulado' && enE(p.estancia));
  const sols = filas_('solicitudes').filter(s => String(s.estado) === 'pendiente' && enE(s.estancia));
  const out = { ok: true, estancias: ests, desde: desde, hasta: hasta, generado_en: ahoraIso_(), recalculado_en: P.getProperty('ULTIMO_RECALCULO') || '', moneda: param_('moneda') };
  const propios = despP.filter(d => d.destino === 'maquina' && M[String(d.maquina_id)] && String(M[String(d.maquina_id)].propietario) !== 'prestador');
  const ratTr = ratP.filter(r => r.origen === 'tramo');
  out.resumen = { horas_maquina: r_(sumar_(ratTr, 'horas_maquina'), 1), horas_operador: r_(sumar_(ratTr, 'horas_operador'), 1), litros_propios: r_(sumar_(propios, 'litros'), 0), litros_prestadores: r_(sumar_(despP.filter(d => d.destino === 'vale'), 'litros'), 0), litros_otros: r_(sumar_(despP.filter(d => d.destino === 'otro' || (d.destino === 'maquina' && propios.indexOf(d) < 0)), 'litros'), 0),
    partes: partes.filter(p => p.estado === 'cerrado' && enP(p.fecha)).length, costo_total: r_(sumar_(ratP, 'costo_total'), 0), costo_combustible: r_(sumar_(ratP, 'costo_combustible'), 0), costo_maquina: r_(sumar_(ratP, 'costo_maquina'), 0), costo_operador: r_(sumar_(ratP, 'costo_operador'), 0), costo_almacen: r_(sumar_(ratP, 'costo_almacen'), 0),
    alertas_abiertas: filas_('alertas').filter(a => String(a.estado) === 'abierta' && (!a.estancia || enE(a.estancia))).length, solicitudes_pendientes: sols.length, despachos_revisar: desp.filter(d => String(d.estado) === 'por_revisar').length, sin_confirmar: despP.filter(d => String(d.confirmacion) === 'pendiente').length, no_conforme: despP.filter(d => String(d.confirmacion) === 'no_conforme').length, confirmados: despP.filter(d => String(d.confirmacion) === 'confirmado').length };
  out.sin_confirmar = despP.filter(d => String(d.confirmacion) === 'pendiente' || String(d.confirmacion) === 'no_conforme').slice(-120).reverse().map(d => ({ id: d.id, fecha: d.fecha, hora: d.hora, tanque: d.tanque, encargado: d.encargado, destino: d.destino, maquina: d.maquina, operador: d.operador, prestador: d.prestador, receptor: d.receptor, litros: num_(d.litros), confirmacion: d.confirmacion, litros_receptor: num_(d.litros_receptor), confirmado_por: d.confirmado_por, validacion: d.validacion, motivo_sin_qr: d.motivo_sin_qr }));
  // Ahora trabajando (partes abiertos de hoy o ayer)
  const ayer = Utilities.formatDate(new Date(Date.now() - 86400000), tz_(), 'yyyy-MM-dd');
  out.ahora = partes.filter(p => p.estado === 'abierto' && String(p.fecha) >= ayer).map(p => { let t = null; try { t = JSON.parse(String(p.tramo_actual || 'null')); } catch (e) {} return { parte_id: p.id, fecha: p.fecha, operador: p.operador, maquina: p.maquina, hora_inicio: p.hora_inicio, lectura_inicio: num_(p.lectura_inicio), servicio: t ? t.servicio : '', lugar: t ? t.lugar : '', proyecto: t ? t.proyecto : '', desde: t ? t.hora_desde : p.hora_inicio, actualizado_en: p.actualizado_en }; });
  // Proyectos (acumulado de toda la vida del proyecto + horas del período)
  const asig = filas_('asignaciones').filter(a => si_(a.activo)); const ratPorP = agrupar_(rat, r => String(r.proyecto_id || ''));
  out.proyectos = filas_('proyectos').filter(p => enE(p.estancia) && (String(p.estado) !== 'cancelado' || b.con_cancelados)).map(p => {
    const rs = ratPorP[String(p.id)] || []; const rsT = rs.filter(r => r.origen === 'tramo');
    const fi = fecha_(p.fecha_inicio), ff = fecha_(p.fecha_fin); let dTot = null, dTr = null, dRest = null;
    if (fi && ff) { dTot = Math.max(1, Math.round((new Date(ff + 'T12:00:00') - new Date(fi + 'T12:00:00')) / 86400000) + 1); dTr = Math.max(0, Math.min(dTot, Math.round((new Date(hoy + 'T12:00:00') - new Date(fi + 'T12:00:00')) / 86400000) + 1)); }
    if (ff) dRest = Math.round((new Date(ff + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 86400000);
    const grp = (kf, nom) => { const g = agrupar_(rs, kf); return Object.keys(g).map(k => ({ nombre: nom(g[k][0], k), horas: r_(sumar_(g[k], 'horas_maquina'), 1), horas_operador: r_(sumar_(g[k], 'horas_operador'), 1), litros: r_(sumar_(g[k], 'litros'), 0), costo: r_(sumar_(g[k], 'costo_total'), 0), avance: r_(sumar_(g[k], 'avance'), 2) })).sort((a, b) => b.horas - a.horas || b.costo - a.costo); };
    const personas = {}; asig.filter(a => String(a.proyecto_id) === String(p.id) && a.operador_id).forEach(a => personas[a.operador_id] = nombreUsuario_(a.operador_id)); rsT.forEach(r => { if (r.operador_id) personas[r.operador_id] = r.operador; });
    const maqs = {}; asig.filter(a => String(a.proyecto_id) === String(p.id) && a.maquina_id).forEach(a => { const m = M[String(a.maquina_id)]; if (m) maqs[a.maquina_id] = m.codigo; }); rsT.forEach(r => { const m = M[String(r.maquina_id)]; if (m) maqs[r.maquina_id] = m.codigo; });
    const ult = rsT.reduce((x, r) => String(r.fecha) > x ? String(r.fecha) : x, '');
    return { id: p.id, codigo: p.codigo, nombre: p.nombre, estancia: p.estancia, estado: p.estado, centro_costo: p.centro_costo, fecha_inicio: fi, fecha_fin: ff, dias_total: dTot, dias_transcurridos: dTr, dias_restantes: dRest, pct_tiempo: dTot ? r_(dTr / dTot * 100, 0) : null,
      horas: r_(sumar_(rsT, 'horas_maquina'), 1), horas_operador: r_(sumar_(rsT, 'horas_operador'), 1), horas_periodo: r_(sumar_(rsT.filter(r => enP(r.fecha)), 'horas_maquina'), 1), presupuesto_horas: num_(p.presupuesto_horas), litros: r_(sumar_(rs, 'litros'), 0), presupuesto_litros: num_(p.presupuesto_litros), costo: r_(sumar_(rs, 'costo_total'), 0), costo_almacen: r_(sumar_(rs, 'costo_almacen'), 0), presupuesto_gs: num_(p.presupuesto_gs),
      avance: r_(sumar_(rsT, 'avance'), 2), meta_avance: num_(p.meta_avance), unidad_avance: p.unidad_avance, personas: Object.keys(personas).map(k => personas[k]).filter(Boolean), maquinas: Object.keys(maqs).map(k => maqs[k]), ultimo_parte: ult,
      por_servicio: grp(r => String(r.servicio || '—'), (x, k) => k), por_maquina: grp(r => String(r.maquina || '—'), (x, k) => k), por_operador: grp(r => String(r.operador || '—'), (x, k) => k), por_lugar: grp(r => String(r.lugar || '—'), (x, k) => k) };
  }).sort((a, b) => (['en_curso', 'planificado', 'pausado', 'terminado', 'cancelado'].indexOf(a.estado) - ['en_curso', 'planificado', 'pausado', 'terminado', 'cancelado'].indexOf(b.estado)) || String(a.fecha_fin || '9').localeCompare(String(b.fecha_fin || '9')));
  // Máquinas
  const cm = filas_('costos_maquina'); const mesesP = {}; cm.forEach(c => { if (String(c.mes) >= desde.slice(0, 7) && String(c.mes) <= hasta.slice(0, 7)) mesesP[c.maquina_id + '|' + c.mes] = c; });
  const planes = filas_('planes_mant').filter(p => si_(p.activo));
  out.maquinas = filas_('maquinas').filter(m => si_(m.activo) && (enE(m.estancia) || ratP.some(r => String(r.maquina_id) === String(m.id)) || despP.some(d => String(d.maquina_id) === String(m.id)))).map(m => {
    const rs = ratTr.filter(r => String(r.maquina_id) === String(m.id)); const ds = despP.filter(d => String(d.maquina_id) === String(m.id) && d.destino === 'maquina');
    const horas = sumar_(rs, 'horas_maquina'), uso = sumar_(rs, 'uso_maquina'), litros = sumar_(ds, 'litros'); const km = m.unidad === 'km';
    const cms = Object.keys(mesesP).filter(k => k.indexOf(String(m.id) + '|') === 0).map(k => mesesP[k]); const ch = sumar_(cms, 'horas'); const ct = sumar_(cms, 'costo_total');
    const val = litros <= 0 ? null : (km ? (uso > 0 ? litros / uso * 100 : null) : (horas > 0 ? litros / horas : null)); const ref = num_(m.consumo_ref);
    const ps = planes.filter(p => String(p.maquina_id) === String(m.id)).map(p => { const st = estadoPlan_(p, m, hoy); return { id: p.id, tarea: p.tarea, estado: st.estado, texto: st.texto, faltan: st.faltan, faltan_dias: st.faltan_dias }; });
    const peor = ps.some(p => p.estado === 'vencido') ? 'vencido' : (ps.some(p => p.estado === 'proximo') ? 'proximo' : (ps.length ? 'ok' : 'sin_plan'));
    return { id: m.id, codigo: m.codigo, nombre: m.nombre, tipo: m.tipo, estancia: m.estancia, unidad: m.unidad || 'h', propietario: m.propietario, lectura_actual: num_(m.lectura_actual), lectura_fecha: m.lectura_fecha, horas: r_(horas, 1), uso: r_(uso, 1), litros: r_(litros, 0), consumo: val !== null ? r_(val, 1) : null, consumo_ref: ref, desvio_pct: (val !== null && ref) ? r_((val / ref - 1) * 100, 0) : null, costo_hora: ch > 0 ? r_(ct / ch, 0) : null, costo_periodo: r_(ct, 0), bloqueada: si_(m.bloqueada), mant_estado: peor, mant: ps, partes: Object.keys(agrupar_(rs, r => r.parte_id)).length };
  }).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
  // Operadores
  const porOp = agrupar_(ratTr, r => String(r.operador_id || ''));
  out.operadores = Object.keys(porOp).filter(Boolean).map(k => { const rs = porOp[k]; const fs = {}; rs.forEach(r => fs[r.fecha] = 1); const ps = {}; rs.forEach(r => ps[r.parte_id] = 1); return { id: k, nombre: rs[0].operador, horas: r_(sumar_(rs, 'horas_operador'), 1), horas_maquina: r_(sumar_(rs, 'horas_maquina'), 1), dias: Object.keys(fs).length, partes: Object.keys(ps).length, costo: r_(sumar_(rs, 'costo_operador'), 0), ultimo: Object.keys(fs).sort().pop() }; }).sort((a, b) => b.horas - a.horas);
  // Tanques
  const conc = filas_('conciliacion'); const lect = filas_('lecturas_bomba').filter(l => String(l.estado) !== 'anulado');
  out.tanques = filas_('tanques').filter(t => si_(t.activo) && enE(t.estancia)).map(t => { const cs = conc.filter(c => String(c.tanque_id) === String(t.id)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))); const med = lect.filter(l => String(l.tanque_id) === String(t.id) && num_(l.litros_medidos) !== null).sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0];
    const enPer = cs.filter(c => enP(c.fecha));
    return { id: t.id, nombre: t.nombre, estancia: t.estancia, capacidad_l: num_(t.capacidad_l), tiene_totalizador: si_(t.tiene_totalizador), stock_teorico: num_(t.stock_teorico), totalizador: num_(t.totalizador_actual), ultima_medicion: med ? { fecha: med.fecha, hora: med.hora, litros: num_(med.litros_medidos) } : null,
      despachos_periodo: r_(sumar_(enPer, 'despachos_l'), 0), descargas_periodo: r_(sumar_(enPer, 'descargas_l'), 0), saltos_periodo: r_(sumar_(enPer, 'saltos_l'), 1), dias_revisar: enPer.filter(c => c.estado !== 'ok').length,
      conciliacion: cs.slice(0, 31).map(c => ({ fecha: c.fecha, apertura: num_(c.apertura), cierre: num_(c.cierre), bomba_l: num_(c.bomba_l), despachos_l: num_(c.despachos_l), cantidad: num_(c.cantidad_despachos), diferencia_bomba_l: num_(c.diferencia_bomba_l), saltos_l: num_(c.saltos_l), descargas_l: num_(c.descargas_l), stock_teorico: num_(c.stock_teorico), medido_l: num_(c.medido_l), diferencia_stock_l: num_(c.diferencia_stock_l), estado: c.estado })) }; });
  // Prestadores
  const vales = filas_('vales'); const porPr = agrupar_(despP.filter(d => d.destino === 'vale'), d => String(d.prestador_id));
  out.prestadores = filas_('prestadores').filter(p => si_(p.activo) || porPr[String(p.id)]).map(p => { const ds = porPr[String(p.id)] || []; const vs = vales.filter(v => String(v.prestador_id) === String(p.id)); const act = vs.filter(v => String(v.estado) === 'activo'); const cred = ds.filter(d => { const v = vales.find(x => String(x.id) === String(d.vale_id)); return v && v.tipo === 'credito'; });
    return { id: p.id, nombre: p.nombre, litros: r_(sumar_(ds, 'litros'), 0), total_gs: r_(sumar_(ds, 'total_gs'), 0), despachos: ds.length, vales_activos: act.length, saldo_l: r_(act.reduce((s, v) => s + n0_(v.litros) - n0_(v.litros_usados), 0), 0), a_facturar_l: r_(sumar_(cred, 'litros'), 0), a_facturar_gs: r_(sumar_(cred, 'total_gs'), 0) }; }).filter(p => p.litros > 0 || p.vales_activos > 0).sort((a, b) => b.litros - a.litros);
  // Centros de costo y servicios del período
  const grpCC = agrupar_(ratP, r => String(r.centro_costo || '(sin centro de costo)'));
  out.centros_costo = Object.keys(grpCC).map(k => ({ centro_costo: k, horas: r_(sumar_(grpCC[k], 'horas_maquina'), 1), litros: r_(sumar_(grpCC[k], 'litros'), 0), costo: r_(sumar_(grpCC[k], 'costo_total'), 0) })).sort((a, b) => b.costo - a.costo || b.horas - a.horas);
  const grpS = agrupar_(ratTr, r => String(r.servicio || '—'));
  out.servicios = Object.keys(grpS).map(k => ({ servicio: k, horas: r_(sumar_(grpS[k], 'horas_maquina'), 1), litros: r_(sumar_(grpS[k], 'litros'), 0), costo: r_(sumar_(grpS[k], 'costo_total'), 0), avance: r_(sumar_(grpS[k], 'avance'), 1), unidad: grpS[k][0].unidad_avance })).sort((a, b) => b.horas - a.horas);
  return out;
}

/* ===================== Consultas para informes (Excel en el teléfono) ===================== */
const CONSULTAS = { partes: 'partes', tramos: 'tramos', despachos: 'despachos', lecturas: 'lecturas_bomba', descargas: 'descargas', movimientos: 'movimientos', mantenimientos: 'mantenimientos', fallas: 'fallas', rateio: 'rateio', conciliacion: 'conciliacion', costos_maquina: 'costos_maquina', alertas: 'alertas', solicitudes: 'solicitudes', vales: 'vales', articulos: 'articulos', cargas_operador: 'cargas_operador', confirmaciones: 'confirmaciones' };
function consulta_(u, b) {
  const h = CONSULTAS[b.que]; exigir_(h, 'consulta desconocida');
  const G = esGerente_(u);
  const permitido = G || (['despachos', 'lecturas', 'descargas', 'conciliacion'].indexOf(b.que) >= 0 && tiene_(u, 'combustible')) || (['movimientos', 'articulos', 'solicitudes'].indexOf(b.que) >= 0 && tiene_(u, 'almacen')) || (['mantenimientos', 'fallas'].indexOf(b.que) >= 0 && tiene_(u, 'mecanico')) || (['partes', 'tramos'].indexOf(b.que) >= 0 && tiene_(u, 'operador'));
  exigir_(permitido, 'sin permiso para esa consulta');
  if ((b.que === 'rateio' || b.que === 'conciliacion' || b.que === 'costos_maquina') && (b.recalcular || (props_().getProperty('SUCIO') && Date.now() - Number(props_().getProperty('ULTIMO_RECALCULO_MS') || 0) > 15 * 60000))) { const lock = LockService.getScriptLock(); if (lock.tryLock(20000)) { try { recalcular_(); } finally { lock.releaseLock(); } } }
  const desde = fecha_(b.desde), hasta = fecha_(b.hasta); const soloPropio = !G && ['partes', 'tramos'].indexOf(b.que) >= 0 && !tiene_(u, 'combustible');
  const f = b.filtros || {};
  let rows = filas_(h).filter(r => {
    if (r.estancia !== undefined && r.estancia !== '' && !puedeEst_(u, r.estancia) && h !== 'vales' && h !== 'articulos') return false;
    if (b.estancia && b.estancia !== '*' && r.estancia !== undefined && String(r.estancia) !== String(b.estancia)) return false;
    const fe = String(r.fecha || (r.mes ? r.mes + '-01' : '') || String(r.creado_en || '').slice(0, 10));
    if (desde && h !== 'articulos' && h !== 'vales' && fe < (h === 'costos_maquina' ? desde.slice(0, 7) + '-01' : desde)) return false;
    if (hasta && h !== 'articulos' && h !== 'vales' && fe > hasta) return false;
    if (soloPropio && String(r.operador_id) !== u.id) return false;
    for (const k in f) { if (f[k] !== '' && f[k] !== null && f[k] !== undefined && String(r[k]) !== String(f[k])) return false; }
    return true; });
  const total = rows.length; rows = rows.slice(-6000);
  const quitar = { token: 1, token_hash: 1, control_hash: 1, pin_hash: 1 };
  return { ok: true, que: b.que, columnas: T_(h).cab.filter(k => !quitar[k]), filas: rows.map(r => { const o = {}; Object.keys(r).forEach(k => { if (!quitar[k]) o[k] = r[k]; }); return o; }), total: total, recortado: total > rows.length };
}

/* ===================== Instalación ===================== */
// Ejecutar una vez a mano desde el editor (Ejecutar > probarConfiguracion): pide los permisos, crea la carpeta, la planilla,
// todas las hojas y los catálogos iniciales (estancias, parámetros, servicios y un tanque por estancia). Se puede repetir sin duplicar.
function probarConfiguracion() {
  Logger.log('Cuenta que ejecuta el script: ' + Session.getEffectiveUser().getEmail());
  const f = carpeta_(); Logger.log('Carpeta: ' + f.getName() + ' -> ' + f.getUrl());
  const ss = planilla_(); try { ss.setSpreadsheetTimeZone(CONFIG.ZONA); } catch (e) {}
  Object.keys(CAB).forEach(n => cabecera_(hoja_(n), CAB[n]));
  if (!filas_('estancias').length) agregar_('estancias', CONFIG.ESTANCIAS_INICIALES.map((e, i) => ({ nombre: e, codigo_senacsa: ({ 'Ypoti': '0103780002', 'Oro Verde': '0103780080', 'Lusipar': '0210150003', 'Santa Clara': '0210150007', 'Ybypora': '0107240013', 'Bella Vista': '0107120040', 'La Esperanza': '1302220001' })[e] || '', tiene_almacen: e === CONFIG.ESTANCIA_ALMACEN ? 'si' : 'no', activo: 'si', orden: i + 1 })));
  const pk = {}; filas_('parametros').forEach(p => pk[p.clave] = 1); agregar_('parametros', PARAMETROS_INICIALES.filter(p => !pk[p[0]]).map(p => ({ clave: p[0], valor: p[1], descripcion: p[2] })));
  if (!filas_('servicios').length) agregar_('servicios', SERVICIOS_INICIALES.map((s, i) => ({ id: nuevoId_('s_'), nombre: s[0], unidad_avance: s[1], centro_costo: s[2], activo: 'si', orden: i + 1 })));
  if (!filas_('tanques').length) agregar_('tanques', filas_('estancias').map(e => ({ id: nuevoId_('t_'), estancia: e.nombre, nombre: 'Tanque ' + e.nombre, tipo: 'fijo', capacidad_l: '', tiene_totalizador: 'si', stock_teorico: 0, activo: 'si', notas: 'Complete la capacidad y los encargados en el app (Catálogos › Tanques)' })));
  secreto_();
  let cm = claveMaestra_();
  if (!/^\d{6}$/.test(cm)) { do { cm = String(100000 + Math.floor(Math.random() * 900000)); } while (CODIGOS_FACILES_.test(cm)); props_().setProperty('CLAVE_MAESTRA', cm); Logger.log('Código maestro creado (6 números, entra como Administración): ' + cm + ' — anótelo; queda en Configuración del proyecto › Propiedades del script › CLAVE_MAESTRA.'); }
  else Logger.log('Código maestro: el que está en Propiedades del script › CLAVE_MAESTRA.');
  Logger.log('Planilla: ' + ss.getName() + ' -> ' + ss.getUrl());
  Logger.log('Listo. Implemente como Aplicación web y entre al app con el código maestro para cargar gerentes, operadores y máquinas.');
  return ss.getUrl();
}
function instalarDisparadores() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'recalcularPorDisparador') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('recalcularPorDisparador').timeBased().everyMinutes(30).create();
  Logger.log('Disparador instalado: recalcula cada 30 minutos.');
}
// Para usar desde el editor si algo quedó desfasado (por ejemplo, después de corregir filas a mano en la planilla).
function recalcularAhora() { recalcular_(); flushLog_(); Logger.log('Recalculado: ' + props_().getProperty('ULTIMO_RECALCULO')); }

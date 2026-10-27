# Base de datos · Maquinaria y combustible (Rural Bioenergía / Ypoti)

La base es una planilla de Google (*Maquinaria y combustible (base de datos)*) dentro de la carpeta *Maquinaria y combustible Ypoti (base de datos)*. La crea y mantiene el servidor (`servidor_apps_script.gs`). Las fotos quedan en `fotos/<estancia>/<año-mes>/` de la misma carpeta. Este documento se generó a partir del esquema del servidor (constante `CAB`), así que coincide con las columnas reales.

**Reglas generales.** Los eventos de campo nunca se borran: los errores se corrigen anulándolos (estado `anulado`, con el motivo en observaciones) y el servidor recalcula stocks, saldos y costos. Fechas en formato fecha de la planilla; horas y marcas de tiempo como texto `aaaa-mm-ddThh:mm:ss` (hora de Paraguay). si/no como texto. Montos en guaraníes. Si a una hoja le faltan columnas, el servidor las agrega al final.

**Cómo se relacionan.** `partes` → `tramos` (por parte_id) → `rateio`. `despachos`, `lecturas_bomba` y `descargas` → `conciliacion` (por tanque_id y día). `despachos` → `vales` (vale_id). `movimientos` → `articulos` (articulo_id) y `solicitudes` (solicitud_id). `asignaciones` → `proyectos`, `usuarios`, `maquinas`, `servicios`, `pastos`. `mantenimientos` → `planes_mant` (tareas) y `fallas` (falla_id).

## Catálogos

### `usuarios`

Personas que usan el app. Una fila por persona. Cada una entra con su código personal de 6 números, único en la empresa; el código no se guarda: solo su HMAC con un secreto del proyecto. Los pedidos de código hechos desde el app entran con estado pendiente hasta que el gerente los aprueba.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `nombre` | Nombre. |
| `documento` | Documento. |
| `telefono` | Telefono. |
| `correo` | Correo. |
| `roles` | Papeles separados por |: operador, combustible, almacen, mecanico, gerente, prestador, admin. |
| `estancias` | Estancias separadas por | (o * = todas). |
| `prestador_id` | Empresa prestadora (para el papel prestador o para máquinas de prestadores). |
| `costo_hora` | Costo total / horas. |
| `pin_hash` | HMAC del código personal (no se puede leer el código). |
| `pin_version` | Sube cada vez que se cambia el código; invalida las sesiones anteriores. |
| `activo` | si / no. |
| `notas` | Notas libres. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `creado_por` | Creado por. |
| `actualizado_en` | Última modificación. |
| `estado` | pendiente (pidió código desde el app), aprobado, rechazado o bloqueado. |
| `pedido_en` | Cuándo pidió el código desde el app. |
| `pedido_dispositivo` | Teléfono desde el que pidió el código. |
| `decidido_por` | Gerente que aprobó o rechazó el pedido de código. |

### `estancias`

Estancias de la empresa; la que tiene almacén es Ypoti (módulo oculto en la versión 1.1).

| Columna | Significado |
|---|---|
| `nombre` | Nombre. |
| `codigo_senacsa` | Codigo senacsa. |
| `tiene_almacen` | Tiene almacen. |
| `activo` | si / no. |
| `orden` | Orden. |

### `maquinas`

Máquinas propias y de prestadores. La lectura actual y el último despacho los mantiene el servidor.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `codigo` | Código legible (TR-01, PRY-0001, VAL-0001, ALM-00001, SOL-00001). |
| `nombre` | Nombre. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `marca` | En artículos: solo si la pieza depende de la marca. En movimientos: la marca recibida. |
| `modelo` | Modelo. |
| `anio` | Anio. |
| `chapa_serie` | Chapa serie. |
| `estancia` | Estancia. |
| `propietario` | Propietario. |
| `prestador_id` | Empresa prestadora (para el papel prestador o para máquinas de prestadores). |
| `unidad` | h (horómetro) o km (odómetro); en artículos, la unidad de medida. |
| `capacidad_tanque_l` | Capacidad del tanque de la máquina en litros. |
| `consumo_ref` | Consumo de referencia: L/h (o L/100 km). Base de la alerta de consumo alto. |
| `valor_compra` | Valor de compra (Gs.) para la depreciación. |
| `valor_residual` | Valor residual (Gs.). |
| `vida_util_h` | Vida útil en horas: depreciación por hora = (compra − residual) / vida útil. |
| `lectura_actual` | Última lectura de horómetro/odómetro conocida (la mayor registrada). |
| `lectura_fecha` | Lectura fecha. |
| `bloqueada` | si = combustible desautorizado por el gerente. |
| `motivo_bloqueo` | Motivo bloqueo. |
| `activo` | si / no. |
| `notas` | Notas libres. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `actualizado_en` | Última modificación. |
| `ult_despacho_fecha` | Fecha del último despacho a la máquina (y hora, litros y lectura en las columnas siguientes). |
| `ult_despacho_hora` | Ult despacho hora. |
| `ult_despacho_litros` | Ult despacho litros. |
| `ult_despacho_lectura` | Ult despacho lectura. |

### `proyectos`

Proyectos de la gerencia: plazo, presupuesto y meta. El código PRY-0001… lo asigna el servidor.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `codigo` | Código legible (TR-01, PRY-0001, VAL-0001, ALM-00001, SOL-00001). |
| `nombre` | Nombre. |
| `estancia` | Estancia. |
| `descripcion` | Descripcion. |
| `centro_costo` | Centro de costo para la contabilidad (Pasturas, Confinamiento, Infraestructura…). |
| `servicio_id` | Id de servicio. |
| `pastos` | Pastos. |
| `responsable_id` | Id de responsable. |
| `fecha_inicio` | Fecha inicio. |
| `fecha_fin` | Fecha fin. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `presupuesto_horas` | Horas máquina presupuestadas. |
| `presupuesto_litros` | Litros presupuestados. |
| `presupuesto_gs` | Costo presupuestado (Gs.). |
| `meta_avance` | Meta de avance del proyecto en unidad_avance. |
| `unidad_avance` | ha, km, m, m³, t, viajes o ninguna. |
| `notas` | Notas libres. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `creado_por` | Creado por. |
| `actualizado_en` | Última modificación. |

### `asignaciones`

Operador × máquina × servicio × pasto asignados a un proyecto. Una asignación activa autoriza el combustible de la máquina.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `proyecto_id` | Id de proyecto. |
| `operador_id` | Id de operador. |
| `maquina_id` | Id de maquina. |
| `servicio_id` | Id de servicio. |
| `pasto_id` | Id de pasto. |
| `desde` | Desde. |
| `hasta` | Hasta. |
| `horas_previstas` | Horas previstas. |
| `activo` | si / no. |
| `notas` | Notas libres. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `actualizado_en` | Última modificación. |

### `servicios`

Tipos de trabajo (rastreada, siembra, caminos…) con su unidad de avance y centro de costo por defecto.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `nombre` | Nombre. |
| `unidad_avance` | ha, km, m, m³, t, viajes o ninguna. |
| `centro_costo` | Centro de costo para la contabilidad (Pasturas, Confinamiento, Infraestructura…). |
| `activo` | si / no. |
| `orden` | Orden. |

### `pastos`

Potreros, piquetes y otros lugares de trabajo por estancia.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `estancia` | Estancia. |
| `nombre` | Nombre. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `superficie_ha` | Superficie ha. |
| `activo` | si / no. |
| `notas` | Notas libres. |

### `tanques`

Tanques de combustible. El stock teórico y el último totalizador los mantiene el servidor.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `estancia` | Estancia. |
| `nombre` | Nombre. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `capacidad_l` | Capacidad l. |
| `tiene_totalizador` | si = la bomba tiene contador acumulado que no se pone en cero. |
| `aforo` | Tabla de la régla cm:litros separada por ;. |
| `encargados` | Ids de los encargados del tanque separados por |. |
| `totalizador_actual` | Último totalizador registrado (por fecha y hora). |
| `totalizador_ts` | Totalizador ts. |
| `stock_teorico` | Entradas − despachos de toda la historia. |
| `activo` | si / no. |
| `notas` | Notas libres. |

### `prestadores`

Empresas que usan nuestro combustible y se les vende.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `nombre` | Nombre. |
| `ruc` | Ruc. |
| `contacto` | Contacto. |
| `telefono` | Telefono. |
| `correo` | Correo. |
| `activo` | si / no. |
| `notas` | Notas libres. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |

### `vales`

Vales de combustible (prepago o crédito). El token del QR solo lo ven el gerente y el prestador; el encargado recibe el hash.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `codigo` | Código legible (TR-01, PRY-0001, VAL-0001, ALM-00001, SOL-00001). |
| `prestador_id` | Empresa prestadora (para el papel prestador o para máquinas de prestadores). |
| `prestador` | Prestador. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `litros` | Litros. |
| `precio_litro` | Precio por litro (Gs.). |
| `total_gs` | Total en guaraníes. |
| `pagado` | Pagado. |
| `recibo` | Recibo. |
| `fecha` | Fecha. |
| `vence` | Vence. |
| `estancias` | Estancias separadas por | (o * = todas). |
| `estancia_emisora` | Estancia emisora. |
| `token` | Token aleatorio del QR del vale. |
| `token_hash` | SHA-256 del token: lo que guarda el teléfono del encargado. |
| `control_hash` | SHA-256 de código|control, para validar el código de control escrito. |
| `litros_usados` | Litros ya despachados con el vale. |
| `saldo` | Litros − usados. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `notas` | Notas libres. |
| `creado_por` | Creado por. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `anulado_por` | Anulado por. |
| `anulado_en` | Anulado en. |
| `motivo_anulacion` | Motivo anulacion. |

### `articulos`

Catálogo único del almacén. La descripción la arma el servidor con tipo, medida, material, marca y nº de parte.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `codigo` | Código legible (TR-01, PRY-0001, VAL-0001, ALM-00001, SOL-00001). |
| `codigo_barras` | Codigo barras. |
| `categoria` | Categoria. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `medida` | Medida. |
| `material` | Material. |
| `marca` | En artículos: solo si la pieza depende de la marca. En movimientos: la marca recibida. |
| `nro_parte` | Nro parte. |
| `descripcion` | Descripcion. |
| `unidad` | h (horómetro) o km (odómetro); en artículos, la unidad de medida. |
| `ubicacion` | Ubicacion. |
| `stock_minimo` | Stock minimo. |
| `cantidad_reposicion` | Cantidad reposicion. |
| `stock` | Stock actual (se rehace desde los movimientos). |
| `costo_promedio` | Costo promedio ponderado (Gs.). |
| `estancia` | Estancia. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `fusionado_en` | Si el artículo era repetido: el artículo con el que se unió. |
| `maquinas` | Maquinas. |
| `notas` | Notas libres. |
| `creado_por` | Creado por. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `actualizado_en` | Última modificación. |

### `planes_mant`

Tareas de mantenimiento preventivo por máquina, cada N horas y/o N días.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `maquina_id` | Id de maquina. |
| `tarea` | Tarea. |
| `intervalo_h` | Cada cuántas horas (o km). |
| `intervalo_dias` | Cada cuántos días. |
| `ultima_lectura` | Lectura de la última vez que se hizo. |
| `ultima_fecha` | Fecha de la última vez. |
| `articulos_sugeridos` | Articulos sugeridos. |
| `activo` | si / no. |
| `notas` | Notas libres. |

### `parametros`

Moneda, precio de venta del litro, tolerancias de las alertas y opciones.

| Columna | Significado |
|---|---|
| `clave` | Qué formulario es (parte_nuevo, despacho, mantenimiento…). |
| `valor` | Valor. |
| `descripcion` | Descripcion. |

## Eventos de campo

### `partes`

Parte diario del operador: una fila por parte (se actualiza con cada versión). Mientras está abierto, los tramos viajan en tramos_json.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `version` | Versión del parte (sube con cada cambio desde el teléfono). |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `fecha` | Fecha. |
| `estancia` | Estancia. |
| `operador_id` | Id de operador. |
| `operador` | Operador. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `unidad` | h (horómetro) o km (odómetro); en artículos, la unidad de medida. |
| `lectura_inicio` | Horómetro u odómetro al empezar. |
| `lectura_fin` | Al terminar. |
| `uso` | Lectura final − inicial (horas o km de máquina). |
| `hora_inicio` | Hora inicio. |
| `hora_fin` | Hora fin. |
| `horas_reloj` | Horas de reloj (hora fin − hora inicio). |
| `descanso_min` | Minutos de descanso. |
| `horas_operador` | Horas de reloj − descanso. |
| `litros_declarados` | Litros que el operador declaró haber cargado. |
| `cantidad_tramos` | Cantidad tramos. |
| `falla` | Falla. |
| `falla_desc` | Falla desc. |
| `observaciones` | Observaciones. |
| `avisos` | Advertencias del servidor al recibir el registro. |
| `url_fotos` | Enlaces a las fotos en Drive. |
| `cargado_por` | Si el parte lo cargó el gerente por un operador sin celular. |
| `dispositivo` | Teléfono que lo guardó. |
| `app_version` | Versión del app del teléfono. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `cerrado_en` | Cerrado en. |
| `recibido_en` | Cuándo llegó al servidor. |
| `actualizado_en` | Última modificación. |
| `tramo_actual` | Servicio, lugar y proyecto del tramo en curso (para "Ahora trabajando"). |
| `tramos_json` | Copia de todos los tramos tal como los mandó el teléfono. |
| `datos_json` | El parte completo (tramos, cargas, lecturas) mientras está abierto: permite seguir la jornada en otro teléfono. |

### `tramos`

Una fila por tramo de un parte cerrado (entre dos cambios de trabajo). Es la base del rateio.

| Columna | Significado |
|---|---|
| `parte_id` | Id de parte. |
| `nro` | Nro. |
| `version` | Versión del parte (sube con cada cambio desde el teléfono). |
| `fecha` | Fecha. |
| `estancia` | Estancia. |
| `operador_id` | Id de operador. |
| `operador` | Operador. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `proyecto_id` | Id de proyecto. |
| `proyecto` | Proyecto. |
| `servicio_id` | Id de servicio. |
| `servicio` | Servicio. |
| `pasto_id` | Id de pasto. |
| `lugar` | Lugar. |
| `centro_costo` | Centro de costo para la contabilidad (Pasturas, Confinamiento, Infraestructura…). |
| `lectura_desde` | Lectura al empezar el tramo. |
| `lectura_hasta` | Lectura al terminar el tramo. |
| `uso` | Lectura final − inicial (horas o km de máquina). |
| `hora_desde` | Hora desde. |
| `hora_hasta` | Hora hasta. |
| `horas_reloj` | Horas de reloj (hora fin − hora inicio). |
| `avance` | Avance del trabajo en el tramo (ha, km…). |
| `unidad_avance` | ha, km, m, m³, t, viajes o ninguna. |
| `abierto` | si = tramo en curso. |

### `cargas_operador`

Cargas de combustible que declaró el operador en su parte (para cruzar con los despachos).

| Columna | Significado |
|---|---|
| `parte_id` | Id de parte. |
| `nro` | Nro. |
| `version` | Versión del parte (sube con cada cambio desde el teléfono). |
| `fecha` | Fecha. |
| `hora` | Hora. |
| `estancia` | Estancia. |
| `operador_id` | Id de operador. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `lectura` | Lectura. |
| `litros` | Litros. |
| `lleno` | si / no: si llenó el tanque de la máquina. |
| `tanque_id` | Id de tanque. |
| `lugar` | Lugar. |
| `despacho_id` | Despacho del encargado al que corresponde. |
| `confirmada` | si / no_conforme: la carga del parte se confirmó con el comprobante del encargado. |

### `despachos`

Cada salida de combustible de un tanque, con el totalizador antes y después, el QR de quien recibió y el estado de su confirmación.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `fecha` | Fecha. |
| `hora` | Hora. |
| `ts` | Ts. |
| `estancia` | Estancia. |
| `tanque_id` | Id de tanque. |
| `tanque` | Tanque. |
| `encargado_id` | Id de encargado. |
| `encargado` | Encargado. |
| `destino` | maquina, vale, transferencia u otro (en despachos); en movimientos, el nombre del destino. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `operador_id` | Id de operador. |
| `operador` | Operador. |
| `prestador_id` | Empresa prestadora (para el papel prestador o para máquinas de prestadores). |
| `prestador` | Prestador. |
| `vale_id` | Id de vale. |
| `vale_codigo` | Vale codigo. |
| `tanque_destino_id` | Id de tanque destino. |
| `receptor` | Receptor. |
| `chapa` | Chapa. |
| `lectura` | Lectura. |
| `totalizador_antes` | Totalizador de la bomba antes de cargar. |
| `totalizador_despues` | Después de cargar. Litros = después − antes. |
| `litros` | Litros. |
| `precio_litro` | Precio por litro (Gs.). |
| `total_gs` | Total en guaraníes. |
| `validacion` | qr_online, qr_offline, codigo, qr_maquina, qr_operador o manual. |
| `parte_id` | Id de parte. |
| `proyecto_id` | Id de proyecto. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `avisos` | Advertencias del servidor al recibir el registro. |
| `revisado_por` | Quién revisó (gerente). |
| `revisado_en` | Revisado en. |
| `comentario_revision` | Comentario revision. |
| `url_foto` | Enlace a la foto en Drive. |
| `observaciones` | Observaciones. |
| `dispositivo` | Teléfono que lo guardó. |
| `app_version` | Versión del app del teléfono. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |
| `pedido_id` | Identificador aleatorio del QR de carga que mostró quien recibe (un mismo QR no se puede usar dos veces). |
| `receptor_id` | Persona que recibió el combustible (la del QR de carga o la que confirmó). |
| `firma_pedido` | ok / invalida: verificación de la firma del QR de carga con la clave de quien lo mostró. |
| `confirmacion` | pendiente (falta que quien recibió lea el comprobante), confirmado, no_conforme (dice otra cantidad) o no_aplica (transferencias y otros usos). |
| `confirmado_por` | Quién leyó el comprobante. |
| `confirmado_en` | Cuándo llegó la confirmación al servidor. |
| `litros_receptor` | Litros que dijo haber visto quien recibió (igual al comprobante si está conforme). |
| `motivo_sin_qr` | Por qué el encargado registró sin el QR de quien recibe (no tiene celular, sin batería, no se pudo leer…). |

### `confirmaciones`

Cada vez que quien recibió (operador o chofer del prestador) leyó el comprobante firmado del encargado. Se cruza con el despacho por despacho_id, en cualquier orden de llegada.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `despacho_id` | Despacho del encargado al que corresponde. |
| `pedido_id` | Identificador aleatorio del QR de carga que mostró quien recibe (un mismo QR no se puede usar dos veces). |
| `fecha` | Fecha. |
| `hora` | Hora. |
| `estancia` | Estancia. |
| `tanque_id` | Id de tanque. |
| `tanque` | Tanque. |
| `encargado_id` | Id de encargado. |
| `encargado` | Encargado. |
| `receptor_id` | Persona que recibió el combustible (la del QR de carga o la que confirmó). |
| `receptor` | Receptor. |
| `tipo_receptor` | operador o prestador. |
| `destino_ref` | Máquina o vale del comprobante. |
| `litros_comprobante` | Litros que dice el comprobante firmado por el encargado. |
| `litros_receptor` | Litros que dijo haber visto quien recibió (igual al comprobante si está conforme). |
| `conforme` | si / no: quien recibió está de acuerdo con los litros. |
| `motivo` | Lo que escribió quien recibió cuando no estaba conforme. |
| `lleno` | si / no: si llenó el tanque de la máquina. |
| `lectura` | Lectura. |
| `parte_id` | Id de parte. |
| `firma` | ok / invalida: firma del comprobante con la clave del encargado. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `avisos` | Advertencias del servidor al recibir el registro. |
| `dispositivo` | Teléfono que lo guardó. |
| `app_version` | Versión del app del teléfono. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |

### `lecturas_bomba`

Apertura, cierre y controles del totalizador y de la régla.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `fecha` | Fecha. |
| `hora` | Hora. |
| `ts` | Ts. |
| `estancia` | Estancia. |
| `tanque_id` | Id de tanque. |
| `tanque` | Tanque. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `totalizador` | Totalizador. |
| `regla_cm` | Centímetros de la régla. |
| `litros_medidos` | Litros medidos (o convertidos con el aforo). |
| `encargado_id` | Id de encargado. |
| `encargado` | Encargado. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `avisos` | Advertencias del servidor al recibir el registro. |
| `url_foto` | Enlace a la foto en Drive. |
| `observaciones` | Observaciones. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |

### `descargas`

Entradas de combustible al tanque: camión del proveedor, stock inicial, transferencias desde otro tanque.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `fecha` | Fecha. |
| `hora` | Hora. |
| `ts` | Ts. |
| `estancia` | Estancia. |
| `tanque_id` | Id de tanque. |
| `tanque` | Tanque. |
| `origen` | tramo, maquina_sin_partes o almacen (rateio); proveedor, stock_inicial, tanque o ajuste (descargas). |
| `proveedor` | Proveedor. |
| `tanque_origen_id` | Id de tanque origen. |
| `documento` | Documento. |
| `litros_documento` | Litros según la factura o remisión. |
| `medicion_antes` | Medición del tanque antes de descargar (L). |
| `medicion_despues` | Después de descargar (L). |
| `litros_medidos` | Litros medidos (o convertidos con el aforo). |
| `litros` | Litros. |
| `precio_litro` | Precio por litro (Gs.). |
| `total_gs` | Total en guaraníes. |
| `chapa` | Chapa. |
| `chofer` | Chofer. |
| `encargado_id` | Id de encargado. |
| `encargado` | Encargado. |
| `despacho_id` | Despacho del encargado al que corresponde. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `avisos` | Advertencias del servidor al recibir el registro. |
| `url_foto` | Enlace a la foto en Drive. |
| `observaciones` | Observaciones. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |

### `movimientos`

Entradas, salidas y ajustes del almacén: una fila por artículo.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `evento_id` | Id de evento. |
| `fecha` | Fecha. |
| `hora` | Hora. |
| `ts` | Ts. |
| `estancia` | Estancia. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `subtipo` | Subtipo. |
| `articulo_id` | Id de articulo. |
| `codigo` | Código legible (TR-01, PRY-0001, VAL-0001, ALM-00001, SOL-00001). |
| `descripcion` | Descripcion. |
| `cantidad` | Cantidad (en movimientos: + entra, − sale). |
| `unidad` | h (horómetro) o km (odómetro); en artículos, la unidad de medida. |
| `costo_unitario` | Costo unitario (Gs.). |
| `total` | Total. |
| `stock_resultante` | Stock después del movimiento. |
| `destino_tipo` | maquina, proyecto o sector. |
| `destino_id` | Id de destino. |
| `destino` | maquina, vale, transferencia u otro (en despachos); en movimientos, el nombre del destino. |
| `mantenimiento_id` | Id de mantenimiento. |
| `solicitud_id` | Id de solicitud. |
| `documento` | Documento. |
| `proveedor` | Proveedor. |
| `marca` | En artículos: solo si la pieza depende de la marca. En movimientos: la marca recibida. |
| `entregado_a` | Entregado a. |
| `responsable_id` | Id de responsable. |
| `responsable` | Responsable. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `url_foto` | Enlace a la foto en Drive. |
| `observaciones` | Observaciones. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |

### `solicitudes`

Pedidos de compra, de salida y de ajuste por conteo, con la decisión del gerente.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `codigo` | Código legible (TR-01, PRY-0001, VAL-0001, ALM-00001, SOL-00001). |
| `tipo` | Tipo (ver valores en cada hoja). |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `estancia` | Estancia. |
| `solicitante_id` | Id de solicitante. |
| `solicitante` | Solicitante. |
| `destino_tipo` | maquina, proyecto o sector. |
| `destino_id` | Id de destino. |
| `destino` | maquina, vale, transferencia u otro (en despachos); en movimientos, el nombre del destino. |
| `motivo` | Lo que escribió quien recibió cuando no estaba conforme. |
| `urgencia` | Urgencia. |
| `items_json` | Artículos pedidos, con la cantidad aprobada. |
| `resumen` | Resumen. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |
| `decidido_por` | Gerente que aprobó o rechazó el pedido de código. |
| `decidido_en` | Decidido en. |
| `comentario` | Comentario. |
| `atendido_en` | Atendido en. |
| `atendido_por` | Atendido por. |

### `mantenimientos`

Mantenimientos preventivos y correctivos con sus costos externos.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `fecha` | Fecha. |
| `ts` | Ts. |
| `estancia` | Estancia. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `lectura` | Lectura. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `tareas` | Tareas. |
| `tareas_desc` | Tareas desc. |
| `descripcion` | Descripcion. |
| `taller` | Taller. |
| `proveedor` | Proveedor. |
| `costo_repuestos_ext` | Costo repuestos ext. |
| `costo_mano_obra` | Costo mano obra. |
| `costo_servicios` | Costo servicios. |
| `costo_total_ext` | Repuestos externos + mano de obra + servicios (Gs.). |
| `horas_parada` | Horas que la máquina estuvo parada. |
| `falla_id` | Id de falla. |
| `responsable_id` | Id de responsable. |
| `responsable` | Responsable. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `url_fotos` | Enlaces a las fotos en Drive. |
| `observaciones` | Observaciones. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |

### `fallas`

Fallas avisadas por los operadores y su estado.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `fecha` | Fecha. |
| `hora` | Hora. |
| `estancia` | Estancia. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `operador_id` | Id de operador. |
| `operador` | Operador. |
| `parte_id` | Id de parte. |
| `descripcion` | Descripcion. |
| `gravedad` | alta / media / baja (alertas); puede_trabajar / parada (fallas). |
| `url_foto` | Enlace a la foto en Drive. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `mantenimiento_id` | Id de mantenimiento. |
| `revisado_por` | Quién revisó (gerente). |
| `revisado_en` | Revisado en. |
| `comentario` | Comentario. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |
| `recibido_en` | Cuándo llegó al servidor. |

### `alertas`

Alertas antirrobo y de control. La clave evita que se repitan.

| Columna | Significado |
|---|---|
| `id` | Identificador único (lo crea el teléfono para los eventos y el servidor para los catálogos). |
| `clave` | Qué formulario es (parte_nuevo, despacho, mantenimiento…). |
| `fecha` | Fecha. |
| `tipo` | Tipo (ver valores en cada hoja). |
| `gravedad` | alta / media / baja (alertas); puede_trabajar / parada (fallas). |
| `estancia` | Estancia. |
| `ref_tipo` | Ref tipo. |
| `ref_id` | Id de ref. |
| `titulo` | Lo que se muestra en la lista Sin terminar. |
| `detalle` | Detalle. |
| `estado` | Estado del registro (ver valores en cada hoja). |
| `revisado_por` | Quién revisó (gerente). |
| `revisado_en` | Revisado en. |
| `comentario` | Comentario. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |

### `fotos`

Una fila por foto guardada en Drive.

| Columna | Significado |
|---|---|
| `ref_tipo` | Ref tipo. |
| `ref_id` | Id de ref. |
| `tipo_foto` | Tipo foto. |
| `url` | Url. |
| `creado_en` | Cuándo se registró en el teléfono (o en el servidor, para catálogos). |

### `borradores`

Copia en la nube de lo que cada persona está escribiendo y todavía no terminó (un formulario por fila). Así lo escrito vuelve si se cierra el app, se cambia de teléfono o se pierde el celular. Al terminar o descartar, la fila queda marcada como borrada.

| Columna | Significado |
|---|---|
| `usuario_id` | Persona dueña del borrador. |
| `usuario` | Nombre de la persona. |
| `clave` | Qué formulario es (parte_nuevo, despacho, mantenimiento…). |
| `pantalla` | Pantalla del app donde se continúa. |
| `titulo` | Lo que se muestra en la lista Sin terminar. |
| `json` | Lo escrito en el formulario. |
| `actualizado_en` | Última modificación. |
| `dispositivo` | Teléfono que lo guardó. |
| `borrado` | si = ya se terminó o se descartó. |

### `log`

Historial: quién hizo qué y cuándo (altas, ediciones, aprobaciones, anulaciones).

| Columna | Significado |
|---|---|
| `fecha` | Fecha. |
| `usuario_id` | Persona dueña del borrador. |
| `usuario` | Nombre de la persona. |
| `accion` | Accion. |
| `entidad` | Entidad. |
| `ref_id` | Id de ref. |
| `detalle` | Detalle. |
| `app_version` | Versión del app del teléfono. |

## Hojas derivadas (las reescribe el servidor cada 30 minutos; no editarlas a mano)

### `rateio`

Horas máquina, horas operador, litros y costos por tramo, para la contabilidad de costos.

| Columna | Significado |
|---|---|
| `mes` | Mes. |
| `fecha` | Fecha. |
| `estancia` | Estancia. |
| `origen` | tramo, maquina_sin_partes o almacen (rateio); proveedor, stock_inicial, tanque o ajuste (descargas). |
| `proyecto_id` | Id de proyecto. |
| `proyecto` | Proyecto. |
| `centro_costo` | Centro de costo para la contabilidad (Pasturas, Confinamiento, Infraestructura…). |
| `servicio` | Servicio. |
| `lugar` | Lugar. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `operador_id` | Id de operador. |
| `operador` | Operador. |
| `uso_maquina` | Uso maquina. |
| `horas_maquina` | Horas de máquina del tramo (horómetro; en camiones, horas de reloj). |
| `horas_operador` | Horas de reloj − descanso. |
| `l_h_mes` | Litros por hora de la máquina en el mes. |
| `litros` | Litros. |
| `costo_litro` | Costo del litro del mes (Gs.). |
| `costo_combustible` | Litros × costo del litro. |
| `costo_hora_maquina` | Costo de la hora sin combustible (repuestos + mantenimiento + depreciación). |
| `costo_maquina` | Horas máquina × costo de la hora sin combustible. |
| `costo_hora_operador` | Costo por hora de la persona. |
| `costo_operador` | Horas operador × costo por hora. |
| `costo_almacen` | Salidas del almacén con destino al proyecto. |
| `costo_total` | Suma de los costos. |
| `avance` | Avance del trabajo en el tramo (ha, km…). |
| `unidad_avance` | ha, km, m, m³, t, viajes o ninguna. |
| `parte_id` | Id de parte. |
| `tramo` | Tramo. |

### `conciliacion`

Cada tanque por día: totalizador, despachos, saltos (litros sin registrar), entradas, stock teórico y régla.

| Columna | Significado |
|---|---|
| `fecha` | Fecha. |
| `estancia` | Estancia. |
| `tanque_id` | Id de tanque. |
| `tanque` | Tanque. |
| `apertura` | Apertura. |
| `cierre` | Cierre. |
| `bomba_l` | Cierre − apertura del totalizador. |
| `despachos_l` | Suma de los despachos del día. |
| `cantidad_despachos` | Cantidad despachos. |
| `diferencia_bomba_l` | Bomba − despachos. |
| `saltos_l` | Litros sin registrar: saltos del totalizador entre un registro y el siguiente. |
| `descargas_l` | Descargas l. |
| `stock_teorico` | Entradas − despachos de toda la historia. |
| `medido_l` | Medido l. |
| `diferencia_stock_l` | Régla − stock teórico. |
| `estado` | Estado del registro (ver valores en cada hoja). |

### `costos_maquina`

Costo de la hora máquina por mes.

| Columna | Significado |
|---|---|
| `mes` | Mes. |
| `maquina_id` | Id de maquina. |
| `maquina` | Maquina. |
| `estancia` | Estancia. |
| `unidad` | h (horómetro) o km (odómetro); en artículos, la unidad de medida. |
| `horas` | Horas. |
| `uso` | Lectura final − inicial (horas o km de máquina). |
| `litros` | Litros. |
| `l_h` | L h. |
| `l_100km` | Litros cada 100 km (camiones). |
| `costo_litro` | Costo del litro del mes (Gs.). |
| `costo_combustible` | Litros × costo del litro. |
| `costo_repuestos` | Costo repuestos. |
| `costo_mantenimiento` | Costo mantenimiento. |
| `depreciacion` | Horas × depreciación por hora. |
| `costo_total` | Suma de los costos. |
| `costo_hora` | Costo total / horas. |
| `costo_hora_sin_combustible` | Costo sin combustible / horas. |

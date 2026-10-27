# Maquinaria y combustible · Rural Bioenergía / Ypoti — versión 1.2

App offline para los **operadores de máquina**, los **encargados de los tanques de combustible**, los **prestadores**, el **taller** y la **gerencia**. Controla la hora del operador, la hora de la máquina, el consumo de combustible y su rateio por proyecto y centro de costo, los vales de combustible de los prestadores y el mantenimiento preventivo y correctivo, con alertas antirrobo. Cada carga de combustible queda **confirmada por los dos lados**: quien recibe y el encargado leen cada uno el QR del otro.

**Novedades de la 1.2 — mismo estándar que los otros apps Ypoti** (Registro de manejo, Orden de compra, Itaverá), tomando lo mejor de cada uno:

- **Código personal al abrir.** El app pide siempre un código de 6 números, que identifica a la persona (sin lista de nombres en la pantalla). Cada código es único en la empresa y no se aceptan códigos fáciles (111111, 123456…). Quien no tiene código lo **pide desde el app** (*No tengo código: pedir uno*); el gerente de su estancia lo aprueba en *Personas* y recibe un correo. Una vez que el código se usó con señal en un teléfono, ese teléfono deja entrar **sin señal** (el registro queda cifrado con el propio código). Botón **Salir** en el inicio; cada uno cambia su código en *Mi cuenta*.
- **Nada de lo escrito se pierde.** Cada formulario se guarda solo en el teléfono cada 2 segundos y se copia a la nube (hoja `borradores`). Si se cierra el app, se acaba la batería o se cambia de teléfono, al entrar con el código aparece *Sin terminar · se guardó solo* con **Continuar**. Los partes abiertos y los QR de carga pendientes también vuelven en el teléfono nuevo. La línea “✓ Guardado en el teléfono · ☁ copia en la nube” muestra la hora de cada copia.
- **Actualización automática.** Cuando se sube una versión nueva a GitHub, los teléfonos la toman solos (revisan cada 15 minutos y al volver al app) y recargan en un momento seguro, sin perder lo escrito: aparece “App actualizado”.
- **Mapa de pastos** como el del Registro de manejo: 🗺 *Elegir en el mapa* (pin fijo al centro, polígonos de los pastos de cada estancia, satélite) y 📍 *Donde estoy* (GPS) al empezar la jornada o cambiar de trabajo. La ubicación queda en el tramo, y el gerente ve en el mapa **dónde está trabajando** cada máquina. En *Catálogos › Pastos*, “Traer los pastos del mapa” carga todos de una vez con su superficie.
- **🤖 Leer con foto.** La IA lee el horómetro o el totalizador de la bomba en la foto y completa el número (la persona revisa y puede corregir). Si lo escrito no coincide con lo que leyó la IA, el gerente recibe la alerta *lectura distinta de la foto*. Sin señal se escribe a mano como siempre.
- **Pantalla fija:** ancho fijo, sin zoom por pellizco ni doble toque, botones grandes y campos de fecha/hora correctos también en iPhone.
- **Claves fuera del código:** el código maestro y la clave de la IA quedan en *Propiedades del script*; el `.gs` ya no tiene ninguna clave y puede estar en GitHub.

**Novedades de la 1.1:** tema oscuro por defecto (el claro se elige en *Mi cuenta › Apariencia*); confirmación de cada carga con QR de los dos lados; el QR queda solo para el combustible (se quitaron las etiquetas QR de máquinas y artículos); el **almacén queda oculto** hasta que se retome con más calma (el código sigue en el servidor y se vuelve a mostrar con `CONFIG.MODULO_ALMACEN = true`).

Es un sistema **separado** del *Registro de manejo* de los capataces: otro repositorio de GitHub, otro proyecto de Apps Script, otra planilla, otra carpeta de Drive y otras contraseñas. Comparte con los otros apps solo el estándar: estilo visual, ingreso con código personal, copia en la nube, mapa y forma de trabajar sin señal.

## Archivos

- `index.html`, `sw.js`, `manifest.webmanifest`, `config.json`, `.nojekyll`: el app (`config.json` lleva la URL del servidor y la versión). Van a un repositorio **nuevo** de GitHub Pages (sugerido: `maquinas-ypoti`, queda en `https://lucasmoller9646.github.io/maquinas-ypoti/`).
- `servidor_apps_script.gs`: el servidor (Google Apps Script). Va en un proyecto **nuevo** de script.google.com.
- `Base_de_datos_maquinas.md` / `.docx`: qué guarda cada hoja de la planilla y cada columna (para TI y contabilidad).
- `contrasenas.txt`: dónde están las claves y cómo usarlas. **No subir a GitHub.**

## Instalación (una sola vez)

1. **Servidor.** En script.google.com cree un proyecto nuevo (no use el del Registro de manejo), pegue todo `servidor_apps_script.gs` y guarde. Verifique en *Configuración del proyecto* que el entorno sea **V8** (es el predeterminado en proyectos nuevos).
2. Elija la función **`probarConfiguracion`** › *Ejecutar* y acepte los permisos (Drive, Sheets, Gmail). Crea sola la carpeta *Maquinaria y combustible Ypoti (base de datos)* en Mi unidad, la planilla con todas las hojas, las estancias, los parámetros, 17 servicios típicos y un tanque por estancia. En *Ejecuciones* aparecen la URL de la planilla y el **código maestro** de 6 números (se crea solo, una vez, y queda en *Configuración del proyecto › Propiedades del script › CLAVE_MAESTRA*): anótelo en un lugar seguro. Se puede repetir sin duplicar nada.
3. Ejecute **`instalarDisparadores`**: recalcula rateio, costos, conciliación de tanques y alertas cada 30 minutos.
4. *Implementar › Nueva implementación › Aplicación web* · Ejecutar como: **Yo** · Acceso: **Cualquier persona**. Copie la URL que termina en `/exec`.
5. **App.** La URL del servidor va en `config.json` (y como respaldo en `DEFAULT_ENDPOINT` dentro de `index.html`; esta entrega ya trae la URL del servidor implantado). Suba `index.html`, `sw.js`, `manifest.webmanifest`, `config.json` y `.nojekyll` al repositorio nuevo y active GitHub Pages (rama `main`, carpeta raíz). Si se olvida de pegar la URL, el app la pide la primera vez en cada teléfono.
6. En cada teléfono: abrir la dirección en Chrome y *Agregar a la pantalla de inicio*.
7. **IA (opcional).** Para el botón 🤖 *Leer con foto*: en *Propiedades del script* agregue `ANTHROPIC_API_KEY` con una clave de console.anthropic.com (la misma cuenta que usa el Registro de manejo sirve). Opcional `ANTHROPIC_MODEL` (por defecto `claude-haiku-4-5`, rápido y barato). Sin clave, el app funciona igual y el número se escribe a mano.

**Actualizar el servidor:** pegar el `.gs` nuevo, guardar, ejecutar `probarConfiguracion` (agrega hojas y columnas nuevas sin tocar los datos) y *Implementar › Administrar implementaciones › lápiz › Versión: Nueva versión › Implementar* (la URL `/exec` no cambia). **Actualizar el app:** subir los archivos nuevos a GitHub; los teléfonos se actualizan solos.

### Pasar de la 1.1 a la 1.2

1. Actualice **primero el servidor** (párrafo anterior). El app 1.2 necesita el servidor 1.2.
2. En el registro de `probarConfiguracion` copie el **código maestro** nuevo (la clave maestra de 4 números ya no sirve).
3. Los PIN de 4 números dejan de valer: cada persona necesita un **código de 6 números**. Dos caminos: el gerente (o la administración) edita a cada persona en *Personas* y le pone el código, o cada uno toca *No tengo código: pedir uno* en su teléfono y el gerente lo aprueba en *Personas › Pedidos de código*.
4. Suba el app nuevo a GitHub.

## Primeros pasos en el app

1. Entre con el **código maestro** (6 números, del registro de `probarConfiguracion`): entra como *Administración*.
2. **Personas:** cargue los gerentes (solo la administración puede crear gerentes), y después cada operador, encargado de tanque, mecánico y chofer de prestador, con su **código personal de 6 números** (o cada uno lo pide desde el app y el gerente lo aprueba), su estancia y, para operadores y mecánicos, el **costo por hora** (salario + cargas por hora trabajada). El gerente puede cargar al resto de su estancia. Una persona puede tener varios papeles. Cada chofer de un prestador que carga con vale necesita su usuario (papel *Prestador*, vinculado al prestador) para mostrar el QR del vale y confirmar sus cargas. A un operador sin celular se lo carga **sin código**: el gerente le carga los partes, y sus cargas quedan *sin confirmar* (ver más abajo).
3. **Catálogos › Tanques:** capacidad, si la bomba tiene **totalizador**, los **encargados** (los que tienen la llave) y, si quiere, la tabla de la régla (`cm:litros`) para que el app convierta los centímetros en litros. Después el encargado registra el **stock inicial** (*Recibir combustible › Stock inicial*).
4. **Catálogos › Pastos y lugares:** se pueden pegar todos los potreros de una vez (uno por renglón, por ejemplo copiados de ControlPasto).
5. **Máquinas:** código interno (TR-01, PC-02…), horómetro u odómetro, lectura actual, tanque, consumo de referencia (L/h o L/100 km) y, para el costo de la hora, valor de compra, valor residual y vida útil en horas.
6. **Proyectos:** nombre, estancia, centro de costo, servicio principal, pastos, plazo, presupuesto (horas, litros, guaraníes) y meta de avance (ha, km, viajes…). En cada proyecto, **＋ Asignar** combina operador × máquina × servicio × pasto. La asignación hace dos cosas: el operador ve el trabajo en su teléfono y **el combustible de esa máquina queda autorizado**. Para máquinas que trabajan todos los días en lo mismo (mixer del confinamiento, camión de ración) conviene un proyecto permanente, por ejemplo *Alimentación del confinamiento*.
7. **Máquinas › plan de mantenimiento:** tareas periódicas por horas y/o días (cambio de aceite cada 250 h, engrase cada 50 h…), con la última vez que se hicieron.

## Cómo trabaja cada uno

### Operador — parte diario

*Empezar jornada*: máquina (de sus asignaciones o de la lista), hora, horómetro (u odómetro) y el primer trabajo: proyecto, servicio y pasto o lugar. Durante el día:

- **🔁 Cambiar de trabajo**: anota la hora y el horómetro del cambio, el avance del trabajo que termina (ha, km…) y el nuevo proyecto/servicio/lugar. Cada tramo entre cambios es la base del rateio.
- **⛽ Cargar combustible** (en un tanque de estancia): anota el horómetro y el app muestra **su QR de carga**. El encargado lo lee, carga y registra; al terminar, el operador toca **Leer comprobante**, lee el QR del celular del encargado y confirma los litros (o toca *No coincide* y escribe lo que marcó la bomba). La carga queda anotada sola en el parte. Ver *Carga confirmada por los dos lados*.
- **🧾 Cargué en otro lugar**: solo para cargas sin encargado (estación de servicio, carreta).
- **🔧 Avisar falla**: descripción, foto y si la máquina puede seguir o está parada (si está parada, el gerente recibe un correo).
- **⏹ Terminar jornada**: hora y horómetro finales, descanso (se descuenta de las horas del operador, no de la máquina) y observaciones.

El parte se manda abierto durante el día (el gerente ve en *Ahora trabajando* quién está en qué máquina y en qué servicio) y cerrado al final. Si hubo un error, *Reabrir para corregir* (el mismo día o el siguiente; el gerente, siempre). El app no deja anotar un horómetro menor que el último del parte, y avisa si es menor que el último registrado de la máquina o si la máquina avanzó horas sin parte. También: *Mis proyectos* (asignaciones y plazos), *Mis partes* (horas de los últimos 30 días). En el inicio, *Confirmar una carga* lee un comprobante cuando el encargado registró sin el QR del operador.

### Encargado del tanque — combustible

- **🕘 Abrir / cerrar el día**: totalizador de la bomba y, si se puede, la régla. En el cierre el app muestra cuántos litros marcó la bomba desde la apertura, cuánto suman los despachos registrados y la diferencia.
- **⛽ Despachar**: **Leer el QR de quien recibe** (operador o chofer del prestador): aparecen solos la máquina, el operador y el horómetro, o el vale con su saldo. Siempre se lee el **totalizador antes y después**: los litros salen de esa resta. El app precarga el totalizador de antes con el último registro; si la bomba ya marca más, avisa en rojo que salió combustible sin registrar. Al registrar, el app muestra el **comprobante** (QR) para que quien recibió lo lea; se puede volver a mostrar desde *Despachos recientes*, donde también se ve si cada carga ya fue confirmada.
- *Sin QR de quien recibe* (máquina propia o vale escrito con código y control): el app pide el motivo (no tiene celular, sin batería, no se pudo leer, otro) y la carga queda esperando la confirmación.
- **🚚 Recibir combustible**: litros de la factura y medición antes y después; avisa si llegó menos.
- Transferencias a otro tanque (carreta, otra estancia) y otros usos (generador, bidones) se registran en *Otro destino*.

### Prestadores — vales de combustible

El gerente emite el vale (**prepago** si ya pagó, o **crédito** a facturar) con litros, precio, vencimiento y estancias donde vale. El vale ya no se imprime ni se manda por WhatsApp: el chofer del prestador entra al app con su código, ve sus vales y su saldo, toca **Cargar con este vale** y muestra el QR al encargado; al terminar lee el comprobante y confirma. El **código de control** de 6 letras (en la pantalla del vale del gerente) queda para cuando el QR no se puede leer. Si el despacho supera el saldo o el vale está vencido o anulado, se puede registrar igual (el combustible ya salió) pero queda **por revisar** y genera alerta.

**Seguridad del vale:** el QR lleva un token aleatorio de 130 bits. El teléfono del encargado guarda solo el **hash SHA-256** del token, así valida sin señal pero no puede fabricar vales; si el QR no se lee, el código de control también se valida con su hash.

### Carga confirmada por los dos lados (antirrobo)

1. Quien recibe (operador o chofer) muestra su **QR de carga**, firmado con la clave de su teléfono.
2. El encargado lo lee, carga y registra los litros con el totalizador. Su app muestra el **comprobante**, firmado con la clave del encargado.
3. Quien recibe lee el comprobante y confirma (*Sí, coincide*) o avisa que no coincide con lo que marcó la bomba.

Cada persona tiene una **clave de firma** que solo conocen el servidor y su teléfono (la recibe al entrar con su código y cambia si cambia el código). Así el encargado no puede inventar el QR de un operador, ni un operador fabricar un comprobante, y todo funciona **sin señal en los dos teléfonos**: el servidor verifica las firmas cuando llegan, en cualquier orden. El servidor deja por revisar o avisa cuando la firma no es válida, el mismo QR se usa dos veces, el QR es de otra máquina, quien confirma no es el operador o el chofer de esa carga, o el encargado intenta confirmar su propio despacho. Si quien recibe dice que no coincide, el despacho pasa a *por revisar* y el gerente recibe un correo. Si nadie lee el comprobante en `horas_confirmacion` (24 h por defecto), se genera la alerta *Carga sin confirmar*, que se cierra sola si la confirmación llega después. En *Combustible*, el gerente ve cuántas cargas están confirmadas, sin confirmar y no coincidentes.

Una confirmación prueba que las dos personas estuvieron juntas y de acuerdo con los litros. No detecta un acuerdo entre las dos para robar: para eso siguen el consumo L/h contra la referencia, el totalizador encadenado y la régla.

### Almacén (oculto en esta versión)

El módulo de almacén de Ypoti (catálogo único de artículos, entradas, salidas aprobadas, compras y conteo) está programado pero **oculto** hasta definirlo mejor. Para volver a mostrarlo: en el servidor `CONFIG.MODULO_ALMACEN = true` y nueva versión de la implementación. Mientras tanto, los repuestos de un mantenimiento se cargan como costo en *Registrar mantenimiento* y entran en el costo por hora de la máquina.

### Taller

*Registrar mantenimiento* (preventivo, marcando las tareas del plan que se hicieron, o correctivo, vinculado a la falla que repara), con costos externos y horas de parada. *Próximos* ordena los planes vencidos y próximos según el horómetro actual de cada máquina.

### Gerente

*Por aprobar* (despachos por revisar y fallas), *Alertas*, *Proyectos* (equipo asignado, plazo, horas y litros contra presupuesto, costo, avance, desgloses por servicio, máquina, operador y pasto), *Combustible* (confirmación de las cargas, stock de cada tanque, conciliación diaria, consumo por máquina contra la referencia, prestadores y lo que hay que facturar), *Vales*, *Máquinas* (horómetro, plan de mantenimiento, costo de la hora, bloquear combustible), *Personas*, *Catálogos*, *Informes en Excel* y *Corregir registros* (anular con motivo un despacho, parte, lectura, recepción, movimiento o mantenimiento equivocado; nada se borra y el servidor recalcula todo).

El gerente **autoriza** el combustible de las máquinas propias asignándolas a proyectos, y lo **desautoriza** bloqueando la máquina. Un despacho a una máquina sin asignación activa o bloqueada queda *por revisar*: lo aprueba o lo marca como no autorizado (queda una alerta).

## Controles antirrobo (alertas)

| Alerta | Qué detecta |
|---|---|
| Litros sin registrar en la bomba | El totalizador de un despacho o lectura empieza más arriba de donde terminó el registro anterior: salió combustible sin despacho. El servidor encadena todas las lecturas de cada bomba. |
| Diferencia de stock en el tanque | La régla mide menos que el stock teórico (entradas − despachos). |
| Faltante en descarga | Llegaron menos litros de los que dice la factura. |
| Despacho mayor que el tanque | Se despachó más que la capacidad del tanque de la máquina. |
| Vale sobregirado / inválido | Despacho por encima del saldo, vale vencido, anulado o de otra estancia. |
| Uso de la máquina sin parte | El horómetro de un parte empieza más arriba de donde terminó el parte anterior de esa máquina. |
| Lectura que retrocede / horómetro incoherente | Horómetro menor que el último, o que avanzó más que las horas de la jornada. |
| Consumo alto | L/h del mes por encima de la referencia de la máquina (+30 % por defecto). |
| Carga sin despacho / litros distintos | Lo que declaró el operador en su parte no coincide con lo que registró el encargado para esa máquina ese día. |
| Carga no confirmada por quien recibió | El operador o el chofer leyó el comprobante y dijo que no coincide (también si confirma alguien que no corresponde). Despacho por revisar y correo al gerente. |
| Carga sin confirmar | Nadie leyó el comprobante en 24 h (parámetro `horas_confirmacion`). Se resuelve sola si la confirmación llega después. |
| QR con firma inválida / QR usado dos veces | Un QR de carga o un comprobante que no salió del app de esa persona, o un mismo QR de carga usado en dos despachos. |
| Mantenimiento vencido, despacho no autorizado | Lo que dice el nombre. |

Las tolerancias se ajustan en *Catálogos › Parámetros* (administración).

## Rateio y costo de la hora máquina (contabilidad de costos)

El servidor reescribe cada 30 minutos la hoja **`rateio`**: una fila por tramo de parte cerrado con proyecto, centro de costo, servicio, pasto, máquina y operador, y:

- **horas máquina** = horómetro del tramo (en camiones, horas de reloj);
- **horas operador** = horas de reloj del tramo menos la parte proporcional del descanso;
- **litros** = litros despachados a esa máquina en el mes, repartidos entre sus tramos del mes en proporción a las horas (así la suma del rateio coincide con lo despachado). Los litros de una máquina que no tuvo partes en el mes aparecen en filas *maquina_sin_partes*, para que no se pierdan;
- **costo del combustible** = litros × costo del litro del mes (promedio ponderado de las facturas de las descargas; si no hubo, el último conocido o el parámetro `costo_litro_ref`);
- **costo máquina** = horas × costo de la hora sin combustible (repuestos y mantenimiento registrados en el taller + depreciación por hora, del mes);
- **costo operador** = horas operador × costo por hora de la persona;

La hoja **`costos_maquina`** tiene por máquina y mes horas, litros, L/h, combustible, repuestos, mantenimiento, depreciación, costo de la hora con y sin combustible. **`conciliacion`** tiene cada tanque por día.

## Sin señal

Todo lo de campo (partes, despachos, confirmaciones de carga, lecturas, recepciones, mantenimientos, fallas) se guarda en el teléfono y se manda solo cuando hay señal; la pastilla de arriba muestra cuántos registros esperan (tocándola se abre la cola). El servidor no duplica nada si el teléfono reintenta. Las altas y aprobaciones del gerente necesitan señal. La primera vez que una persona usa su código en un teléfono hace falta señal; después ese teléfono la deja entrar también sin señal. Lo que se escribe queda en el teléfono y, cuando hay señal, también en la nube. Si el código de una persona cambia, su teléfono pide entrar de nuevo y lo que estaba en cola se manda con la sesión nueva.

## Seguridad

Código personal de 6 números, único y no trivial; el servidor guarda solo un HMAC del código con un secreto propio del proyecto y bloquea 15 minutos un teléfono después de 8 intentos fallidos (y todo el ingreso después de 40 fallidos en 15 minutos). Al entrar, el servidor entrega un token firmado que se invalida si se cambia el código o se bloquea a la persona. El teléfono no guarda el código: guarda el registro de la persona cifrado con una clave derivada del propio código (PBKDF2 + AES-GCM), que solo se abre escribiendo el código correcto. La sesión dura mientras el app está abierto; al volver a abrirlo pide el código. El código maestro, el secreto de firmas y la clave de la IA están en *Propiedades del script*, no en el código. Los textos que podrían ser fórmulas se guardan como texto en la planilla.

## Mantenimiento de la base

- `recalcularAhora` (desde el editor) rehace todas las hojas derivadas y los saldos/stocks si se corrigió algo a mano en la planilla.
- Una planilla de Google admite 10 millones de celdas. Con el uso previsto (≈ 30 máquinas) alcanza para varios años; al cierre de cada ejercicio conviene hacer una copia de la planilla como archivo histórico.
- Los avisos por correo (solicitudes nuevas, máquina parada) van al correo de cada gerente cargado en *Personas* y a `CONFIG.MAIL_COPIA`; se desactivan con el parámetro `avisos_correo`.

## Pruebas realizadas antes de entregar

El servidor se probó corriendo este mismo `.gs` en un emulador de Apps Script (Sheets con su conversión automática de valores, Drive, locks, caché) con un recorrido completo de todos los eventos, permisos, aprobaciones, rateio, conciliación y alertas, y con un volumen de un año (≈ 4.000 partes, 8.000 tramos, 4.000 despachos), para comprobar que ningún pedido se vuelve lento al crecer la base: cada pedido lee solo las últimas filas de las hojas grandes y el catálogo del gerente pesa ≈ 150 KB (y no se vuelve a bajar si no cambió). En Apps Script real cada pedido suma además la demora propia de Google, normalmente de 1 a 3 segundos. El app se probó en Chromium con pantalla de celular en todos los papeles, incluido el trabajo sin señal. En la versión 1.1, la carga confirmada se probó con dos y tres teléfonos a la vez (operador, encargado y chofer), los dos primeros sin señal. El QR se toma de la pantalla de un teléfono y lo lee el decodificador del otro, y se probaron los casos de firma falsa, QR repetido, no conforme y confirmación que llega antes que el despacho. El generador de QR propio se verificó con dos decodificadores independientes. En la versión 1.2 se agregaron pruebas del estándar: pedido y aprobación de código, códigos repetidos o fáciles, bloqueo por intentos, borradores que vuelven en otro teléfono sin que una copia vieja pise a una nueva, parte abierto restaurado, lectura con IA y alerta de lectura distinta, mapa de pastos e ingreso sin señal.

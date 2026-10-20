# Auditoría y pulido visual de foco.

Rama: `codex/pulido-diseno-foco`. Capturas: [galería antes/después](index.html). Verificación local con datos ficticios en memoria; no se usaron cuentas reales.

## Encontrado y corregido

- Los cuatro niveles de texto eran idénticos en ambos temas. Ahora hay escala primaria, secundaria, terciaria y deshabilitada; se revisaron los usos de `--text4` que en realidad eran metadatos. Geist carga pesos 300 a 700 y variantes itálicas usadas.
- El onboarding de Foquito abría el panel sobre la agenda móvil. Ahora prepara la conversación sin taparla; el botón abre el panel y cerrar conserva mensajes y borrador. El panel evita el foco cuando está cerrado y respeta las áreas seguras.
- Controles de cabecera, navegación, chat y tareas tenían áreas pequeñas. Los botones visibles alcanzan 44 px en las vistas verificadas. Se agregaron nombres accesibles, foco visible, estado de navegación y uso con teclado del calendario.
- Semana ocultaba días tras scroll horizontal. Los siete días son visibles a 390 px; los títulos largos quedan abreviados en columnas angostas y se leen completos en el panel del evento.
- Proyectos, Sugerencias y Progreso tenían radios, espaciados, títulos y superficies diferentes. Se unificaron con tokens; el vacío de fechas deja de mostrar `0/0/0`. El atributo `hidden` vuelve a ocultar las secciones vacías.
- El insight de Sugerencias tenía un salto de altura al cargar. La tarjeta reserva espacio durante carga, resultado y error. Se tradujeron los mensajes fijos del insight.
- Las transiciones quedan en 300 ms o menos con el easing del sistema. Las partículas respetan movimiento reducido.

## Segunda inspección visual

- Al entrar, el desplazamiento automático de la agenda dejaba fuera de pantalla el título, la fecha, los controles y “Tu foco”. Hoy conserva esa cabecera visible mientras se recorre el horario. Ahora muestra un resumen de actividades y un estado vacío con una indicación útil.
- Los títulos funcionales mezclaban Geist e Instrument Serif sin un criterio claro. Vistas, calendario, proyectos y datos usan Geist con una escala común; la serif queda para la marca y textos reflexivos. Se acortó el título de Proyectos y se quitó el punto aislado de Progreso en ES/EN.
- El botón flotante de Foquito era demasiado dominante en celular. Se redujo a 56 px y se ajustó el espacio final de la agenda para que no oculte eventos.
- El mapa de actividad casi desaparecía en oscuro y su icono vacío usaba un gris fijo. La escala usa tokens de ambos temas, con más contraste, y cambia inmediatamente al alternar el tema.
- La marca circular de “Tu foco” crecía junto con su área táctil de 44 px. Se mantiene el área táctil y el círculo visible vuelve a 22 px ([claro](after-focus-390-light-hoy.png), [oscuro](after-focus-390-dark-hoy.png)).

## Verificación

Playwright sobre `node server.js`, con el cliente de Supabase simulado sólo en el navegador. Se capturaron las seis vistas, detalle de proyecto, vacío y onboarding en claro/oscuro a 390 y 1280 px. El escaneo de los textos visibles no detectó contraste inferior a AA en superficies planas, ni botones visibles menores de 44 px; tampoco detectó desborde global ni errores de JavaScript. Se verificaron foco, navegación de evento y día con teclado, cierre y reapertura de Foquito, y preservación del borrador. La tarjeta del insight mantuvo su altura en carga/resultado/error en las cuatro combinaciones. `node --check` y `git diff --check` pasaron.

La segunda pasada volvió a capturar las seis vistas y el detalle en las cuatro combinaciones, más Hoy con y sin actividades y las vistas principales en inglés móvil. No detectó desborde global, botones visibles menores de 44 px, claves de traducción ausentes ni errores de JavaScript. Las capturas “después” de la galería corresponden a esta última pasada.

## Ajustes posteriores

- Se restauró el contador de fechas con el degradado celeste, azul y violeta que tenía antes. Se oscureció apenas el extremo celeste para que las etiquetas blancas mantengan contraste AA. En celular, los proyectos activos pasan debajo del contador: cada tarjeta destaca una sola próxima acción (o la primera tarea pendiente) y los pendientes globales quedan más abajo.
- Los círculos del cronograma habían heredado un mínimo global de 44 px y tapaban el texto. La zona táctil sigue midiendo 44 px, pero el indicador visible mide 13 px y tiene un nombre accesible por paso. [Claro](after-crono-390-light.png) · [oscuro](after-crono-390-dark.png).
- Semana muestra una lista de siete días por defecto en celular, con horario y título completo; el selector Lista/Grilla conserva la vista horaria. Los eventos sin horario y los días vacíos tienen presentación propia, en ES y EN.
- Sugerencias abre con el insight y un próximo paso destacado; la cifra de completadas se retiró de esa pantalla para que Progreso concentre las métricas históricas. Si falla la IA, ofrece una acción local y conserva la altura de la tarjeta. Progreso ahora explica su propósito en el encabezado.

Se actualizaron las capturas “después” de Semana, Proyectos, detalle, Sugerencias y Progreso en [la galería](index.html), a 390 y 1280 px en los dos temas. Playwright no registró errores de JavaScript ni desborde horizontal. Se comprobó el cambio Lista/Grilla, la apertura de eventos con teclado, títulos largos, eventos sin horario y la presencia de todas las claves ES/EN. La simulación táctil móvil funcionó, pero no sustituye Safari en un iPhone físico. Tampoco se pudo ejecutar un recorrido autenticado con datos reales de Supabase desde este entorno; las capturas usan datos ficticios en memoria.

## Pendiente

Las columnas de Semana son estrechas en el celular: muestran hasta tres líneas del título, y el panel del evento muestra el texto completo. Eventos de menos de una hora conservan su altura proporcional al tiempo; ampliar sus bloques cambiaría la lectura temporal. La prueba de safe areas fue por reglas CSS y viewport; hace falta comprobarla en un iPhone físico. Los estados de error de datos reales requieren una sesión de Supabase para verificar recorridos completos. La IA se probó con respuesta simulada y con error de red.

## Foquito, reacciones e íconos

- Se reemplazó la pose “pensando”, que tenía una cuadrícula de transparencia pintada, y se limpiaron descanso, aprobación, alegría, cariño, festejo y lectura. Los originales permanecen en `assets/foquitos/`; los maestros editados están en `assets/foquitos/final/`. [Galería antes](foquitos-gallery.png) · [galería después](foquitos-gallery-final.png), ambas sobre blanco y oscuro.
- Al completar una actividad, Foquito elige la pose por título y área: dormir/descanso → manta, leer/estudiar → libro, actividad física/salud → alegría, relaciones → corazón, otras → aprobación. Si se completó todo el día, aparece luego el festejo. Se mantiene “pensando” durante el procesamiento y “leyendo” para el insight; los temporizadores no apagan una reacción más reciente.
- El botón móvil y la reacción de escritorio ya no tienen placa circular, borde ni sombra. La reacción de escritorio queda junto al chat; en celular la muestra el botón flotante para no tapar la agenda.
- Íconos PWA, Apple y favicon/ícono anclado usan PNG/ICO con alfa real; el favicon usa un recorte del rostro para ser legible pequeño. El service worker precarga las poses y subió a `foco-v64` para descartar íconos anteriores.

Capturas de la app con pose de descanso: [390 oscuro](foquito-390-dark.png) · [390 claro](foquito-390-light.png) · [1280 oscuro](foquito-1280-dark.png) · [1280 claro](foquito-1280-light.png). Playwright usó un cliente Supabase simulado en memoria y verificó que completar “Dormir” muestra `foquito-sleepy.png` en el FAB y el panel. Los ocho PNG se revisaron sobre ambos fondos; `node --check`, alfa y tamaños de íconos, manifest y respuestas HTTP locales pasaron. La instalación/anclado del ícono en iOS/Windows todavía requiere comprobación en esos sistemas: pueden conservar el ícono anterior hasta volver a anclar la app.

## Movimiento por estado

Foquito ahora hace un gesto propio al entrar en cada estado: asentir al aprobar, saltar de alegría, festejar con un pequeño impulso, acercar el corazón, inclinarse al pensar, bajar la mirada al leer y cabecear suavemente al descansar. Son transformaciones de la imagen completa, duran entre 280 y 300 ms y no se repiten en bucle. La reacción grande de escritorio usa el mismo gesto; repetir una misma reacción vuelve a animarla. Con `prefers-reduced-motion: reduce` queda la pose estática.

Playwright comprobó las siete animaciones, su duración, la repetición, el movimiento reducido, ausencia de desborde y posición estable del botón “Agregar” a 390 y 1280 px en claro y oscuro. Fotogramas de inspección: [celular en movimiento](motion-390-dark-peak.png) y [en reposo](motion-390-dark-settled.png); [escritorio en movimiento](motion-1280-light-peak.png) y [en reposo](motion-1280-light-settled.png). La animación completa se aprecia en la app, porque una captura fija sólo conserva un fotograma.

## Guías de uso e idioma inicial

La primera visita pide elegir Español o English antes de entrar. La preferencia queda guardada en el dispositivo; luego se cambia desde Ajustes (engranaje), no desde un control que se pueda tocar por accidente en la cabecera. Al cambiar el idioma desde Ajustes se recarga la interfaz para traducir también las vistas generadas. El acceso a Ajustes admite Escape y mantiene el foco dentro del cuadro con teclado.

Agregar ahora abre Foquito sin cerrarlo si ya estaba abierto y muestra una instrucción con un ejemplo de pedido. La pista se retira al empezar a escribir. Hoy explica esa acción; Semana explica Lista/Grilla; Mes indica que cada día se puede abrir. En Proyectos el botón de nuevo proyecto tiene nombre visible y, si no hay proyectos activos, el estado vacío ofrece la acción directamente. Todos los textos nuevos tienen claves ES/EN.

Capturas: idioma inicial [claro](guia-idioma-390-claro.png) y [oscuro](guia-idioma-390-oscuro.png); Agregar [celular claro](guia-agregar-390-claro.png), [celular oscuro](guia-agregar-390-oscuro.png) y [escritorio claro](guia-agregar-1280-claro.png); [Ajustes](guia-ajustes-390-claro.png); [Proyectos sin activos](guia-proyectos-vacio-390-claro.png). Playwright recorrió la primera elección, el cambio posterior en Ajustes, las pistas y el estado vacío de Proyectos con Supabase simulado en memoria; comprobó ambas anchuras y ambos temas sin desborde horizontal. Sigue pendiente la validación táctil en un iPhone físico y con una sesión real de Supabase.

## Sugerencias y Progreso · nueva revisión

Sugerencias abre con una actividad pendiente de la semana y una acción para ir directamente a su día. Si no hay pendientes, propone planificar con Foquito. El insight conserva su lugar como contexto, mientras que el pulso y la revisión semanal forman una segunda fila. Los conflictos ofrecen abrir el día afectado en vez de un botón “Ignorar” que solo atenuaba la tarjeta. En celular, el botón de Registrar queda a la izquierda y no se cruza con Foquito.

Progreso empieza con las actividades completadas de la semana respecto de las planificadas, sigue con el total de 12 meses y la racha de registros, y pone la tendencia antes del mapa histórico. Se eliminaron los 14 días mínimos para ver la tendencia: una actividad completada alcanza. Un período sin completadas tiene un mensaje propio y oculta el gráfico vacío. El mapa explica qué representa cada cuadro y aprovecha mejor el ancho de escritorio.

[Galería comparativa](sugerencias-progreso.html): Sugerencias, Progreso con historial y Progreso vacío, cada uno antes/después, en claro y oscuro a 390 y 1280 px. Playwright comprobó navegación a la actividad, salida vacía hacia Foquito, tres períodos del gráfico, ES/EN, áreas táctiles de 44 px, ausencia de desborde horizontal y ausencia de errores de JavaScript con Supabase simulado. Las capturas usan datos de ejemplo; falta recorrer estas vistas con una cuenta real y en un iPhone físico.

## Inspección de errores posterior

- Un título de actividad con HTML se ejecutaba al aparecer en “Tu foco” o en eventos sin horario de Día y Semana. Se escapó al insertarlo en HTML; los títulos con símbolos se siguen leyendo completos y se pueden abrir con teclado. La revisión semanal generada por IA y las palabras semanales recibieron la misma protección.
- Progreso trataba un error de carga de actividades como si el historial estuviera vacío. Ahora muestra un mensaje y permite reintentar. Si solo falla la carga de registros, la racha muestra “no disponible” en lugar de cero. Capturas del error: [celular claro](error-progreso-390-claro.png) y [celular oscuro](error-progreso-390-oscuro.png).
- El período anual de la tendencia decía “este año” aunque el gráfico toma los últimos 12 meses. Se corrigió la etiqueta en ES/EN, así como las etiquetas de la revisión semanal y sus textos de respaldo en inglés.

Con Playwright se recorrieron las seis vistas a 390 y 1280 px sin desbordes ni errores de JavaScript. También se reprodujo el problema del título antes de corregirlo y se verificó después que ya no ejecuta HTML, que Enter abre la actividad y que la revisión semanal trata su respuesta como texto. Se simularon las dos fallas de carga de Progreso y se comprobó el botón Reintentar. Las capturas del estado de error se revisaron en ambos temas y anchos. Estas pruebas no reemplazan una sesión real de Supabase ni Safari en iPhone.

## Seis momentos con Foquito — 20 de octubre de 2026

[Galería con las seis funciones y comparación antes/después](momentos.html). Rama `codex/momentos-foquito`.

1. **Rescatame el día**, en Sugerencias: propone mantener las primeras dos actividades puntuales pendientes y las rutinas. Cada actividad muestra si queda hoy o pasa a mañana sin horario. Solo se escribe al confirmar. La actualización comprueba usuario, fecha, título, horarios y estado original para evitar pisar una edición concurrente. Ante una falla parcial muestra qué se guardó y reintenta solo lo pendiente.
2. **Tengo un rato**, en Sugerencias: 10, 20 o 45 minutos, con energía baja/normal/alta. Usa las duraciones agendadas para elegir una actividad; si ninguna entra, presenta un primer paso, sin prometer completar todo. El paso de IA es opcional y no escribe datos. Desde allí se abre la actividad original.
3. **Vaciar la cabeza**, en Sugerencias: texto o dictado del navegador; Foquito propone hasta 12 actividades puntuales. La revisión permite editar, elegir fechas y horarios, descartar elementos y confirmar. No inventa fechas faltantes. Si la IA falla, cada línea queda editable. Conserva el borrador por usuario, usa IDs estables al reintentar y evita duplicados exactos.
4. **Cerrar mi día**, en Hoy: reconoce actividades completadas, permite guardar un logro, una nota y un primer paso para mañana. Ese paso aparece en Hoy al día siguiente. El cierre es voluntario y editable.
5. **Lo que te funciona**, en Progreso: compara las últimas ocho semanas de actividades puntuales con horario. Exige al menos 12 actividades en siete fechas y cinco por grupo; muestra una observación solo con una diferencia de 15 puntos porcentuales o más. Expone numerador, denominador y porcentaje. Ofrece un bloque de prueba editable, conservando cualquier borrador anterior. No presenta asociaciones como causas ni inventa patrones cuando faltan datos.
6. **Cápsula de la semana**, en Progreso: un logro, un aprendizaje y un paso para la próxima semana; historial de cápsulas y tarjeta PNG de 1080 × 1350 con Foquito. Los cierres y cápsulas se guardan en este dispositivo bajo una clave por usuario (90 días y 52 semanas respectivamente). No se sincronizan entre dispositivos y se pierden si se borra el almacenamiento local; la interfaz informa dónde se guardan y permite descargarlos.

Se agregó un módulo de JS y CSS sin dependencias. Comparte tokens, Geist y las poses existentes; diálogos nativos con foco contenido, Escape, botones de 44 px, safe areas y movimiento reducido. Las solicitudes de IA se pueden cancelar y las respuestas tardías no reemplazan otro diálogo. No se modificaron tablas, políticas RLS, auth ni el chat de Foquito. El service worker incorpora los recursos y pasa a `foco-v68`.

También se corrigió un fallo existente: las actividades sin horario rompían el cálculo de superposiciones de Sugerencias y el cálculo de horarios de las plantillas. Ahora solo se comparan intervalos completos. En la revisión con ampliación al 200 % se detectó y corrigió un alto de diálogo que dejaba el cierre fuera del viewport.

**Verificación:** los seis recorridos y los casos de error se probaron con Supabase e IA simulados; 32 capturas cubren las vistas y los diálogos en ambos temas y anchos, más inglés, ampliación y tarjeta descargada. Se revisaron visualmente las capturas y se comprobaron áreas de controles, desbordes y ausencia de errores JS. [Scripts reproducibles](../../tests/momentos/README.md). Las capturas anteriores provienen del commit `844c435`; para la comparación de layout se excluyó la actividad sin horario que hacía fallar esa versión, por lo que los textos y totales pueden diferir.

**Pendiente:** pruebas con una cuenta real y Safari/iPhone físico, incluidos teclado, dictado y áreas seguras. El conector disponible de Supabase rechazó la consulta de inspección por falta de permisos; por eso no se afirma validación de RLS ni escrituras reales. El dictado depende del navegador y sus permisos; cuando no está disponible se conserva la entrada por texto. La sincronización de recuerdos entre dispositivos requeriría una decisión de datos posterior, fuera de esta implementación sin migraciones.

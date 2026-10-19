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

## Pendiente

Las columnas de Semana son estrechas en el celular: muestran hasta tres líneas del título, y el panel del evento muestra el texto completo. Eventos de menos de una hora conservan su altura proporcional al tiempo; ampliar sus bloques cambiaría la lectura temporal. La prueba de safe areas fue por reglas CSS y viewport; hace falta comprobarla en un iPhone físico. Los estados de error de datos reales requieren una sesión de Supabase para verificar recorridos completos. La IA se probó con respuesta simulada y con error de red.

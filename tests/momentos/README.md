# Pruebas de Momentos con Foquito

Recorridos con Playwright CLI y Supabase en memoria. El mock reemplaza `/vendor/supabase.js` en el navegador y las respuestas de `/api/claude`; no usa una cuenta ni escribe en Supabase real. No requiere instalar dependencias en el proyecto.

Desde la raíz, iniciar `node server.js` en una terminal. En otra:

```powershell
New-Item -ItemType Directory -Force output/playwright | Out-Null
npx --yes --package @playwright/cli playwright-cli -s=moments open http://localhost:3000
npx --yes --package @playwright/cli playwright-cli -s=moments run-code --filename tests/momentos/setup.js
npx --yes --package @playwright/cli playwright-cli -s=moments run-code --filename tests/momentos/flows.js
npx --yes --package @playwright/cli playwright-cli -s=moments run-code --filename tests/momentos/edge-cases.js
npx --yes --package @playwright/cli playwright-cli -s=moments run-code --filename tests/momentos/visual.js
npx --yes --package @playwright/cli playwright-cli -s=moments close
```

- `flows.js`: los seis recorridos; cero escrituras al revisar; confirmación explícita; recurrentes protegidos; errores parciales de UPDATE/INSERT y reintento sin duplicados; fechas requeridas; borradores; cierre e historial; descarga PNG.
- `edge-cases.js`: edición concurrente, carga fallida y reintento, cinco estados vacíos, IA no disponible, respuesta tardía tras cerrar, aislamiento por usuario, títulos con HTML tratados como texto, foco y Escape, seis diálogos en inglés.
- `visual.js`: 32 capturas de dos vistas y seis diálogos, claro/oscuro, 390/1280 px; controles de 44 px y ausencia de desborde; inglés y ampliación CSS al 200 %. Las animaciones se completan para evitar capturar estados intermedios.

Las capturas quedan en `output/playwright/`. Los datos de ejemplo se generan relativos al día de ejecución. Las pruebas limpian únicamente las claves `foco_moments_*` del perfil de navegador de prueba. No verifican las políticas RLS reales, la API de IA real, el reconocimiento de voz real ni Safari en un iPhone físico.

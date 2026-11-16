# GeoFoto — GitHub Pages

Aplicación de supervisión en campo con almacenamiento local en el navegador. Requiere internet para los mapas satelitales.

## Publicación
1. Crear un repositorio en GitHub y subir el contenido de esta carpeta, incluyendo `.github/workflows/pages.yml`.
2. En Settings → Pages, habilitar Pages seleccionando **GitHub Actions** como fuente. Esto es necesario para desplegar el sitio.
3. En Actions, ejecutar de nuevo el flujo «Publicar GeoFoto» si falló antes de habilitar Pages; verificar que finalice y abrir la URL indicada por GitHub.

Para desarrollar localmente: `npm ci` y `npm run dev`. Para compilar: `npm run build`. Las rutas son relativas para funcionar en un subdirectorio.

Las visitas del sitio anterior no se transfieren automáticamente: descargar el respaldo desde el sitio anterior y restaurarlo en el nuevo, en cada dispositivo o navegador que lo necesite. Los datos están en el dispositivo; el servicio cartográfico recibe solicitudes de mapas. Los respaldos no están cifrados por la aplicación. La carga en MAP SIIOF y la cámara y GPS físicos requieren validación.

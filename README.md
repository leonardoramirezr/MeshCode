# MeshCode

Visor y editor de archivos de Blender (`.blend`) con una interfaz al estilo VS Code, hecho con Tauri + SvelteKit + three.js.
Incluye un chat con Claude (Claude Agent SDK) que edita los archivos de la carpeta abierta.

## Requisitos

- [Blender](https://www.blender.org/download/) instalado. MeshCode lo usa en segundo plano para convertir los `.blend` a glTF.
  Se busca en las rutas de instalación habituales y en el `PATH`; también puedes indicar la ruta con la variable de entorno `BLENDER_PATH`.
- Node.js ≥ 22.18 para el chat (ejecuta el agente). Se busca en las rutas habituales (Homebrew, Volta, nvm) y en el `PATH`;
  también puedes indicar la ruta con la variable de entorno `MESHCODE_NODE`.
- Una API key de Anthropic para el chat ([Claude Console](https://platform.claude.com/settings/keys)).
- pnpm y Rust para desarrollar (ver `make help`).

## Uso

1. Al iniciar, abre una carpeta (**Abrir carpeta…**, `⌘O` / `Ctrl+O`) o elige una de las recientes.
2. En el explorador de la izquierda, haz clic en un archivo `.blend` para verlo. Los demás archivos no se pueden abrir.
3. En el visor puedes elegir el modo de navegación:
   - **Rotar**: arrastra para orbitar, clic derecho para desplazar, rueda para acercar.
   - **Caminar**: `W` `A` `S` `D` para moverte, `3` para subir, `X` para bajar, `Shift` para correr,
     rueda para cambiar la velocidad. Haz clic o arrastra en el visor para mirar con el ratón (`Esc` libera el ratón).
4. Si el archivo cambia en disco (por ejemplo, al guardarlo en Blender), el visor se actualiza automáticamente.

La barra de iconos de la izquierda cambia la barra lateral entre el **Explorador** (`⇧⌘E`) y el **Chat** (`⌃⌘I`);
al hacer clic en el icono activo se oculta la barra lateral (`⌘B`). Arrastra su borde para cambiar el ancho.

### Chat

El chat usa el Claude Agent SDK para editar los archivos de la carpeta abierta. Su función principal son los `.blend`:
el agente tiene herramientas que ejecutan Blender en segundo plano para inspeccionar un archivo, modificarlo con código `bpy`
(o crear uno nuevo) y renderizar una vista previa para comprobar el resultado. Cada guardado deja la versión anterior como
`archivo.blend1`, y el visor muestra los cambios en cuanto se guardan.

- **API key**: la primera vez, pega tu API key de Anthropic. Se guarda en el llavero del sistema; también se usa
  `ANTHROPIC_API_KEY` si está definida. El uso se factura a esa cuenta de la API.
- **Modo** (`⇧Tab` en el cuadro de texto): *Pedir permiso* pregunta antes de editar o ejecutar comandos,
  *Aceptar ediciones* edita los archivos de la carpeta sin preguntar, *Plan* analiza y propone un plan antes de tocar nada,
  *Auto* deja que un clasificador apruebe las acciones seguras y *Sin permisos* lo ejecuta todo sin preguntar.
- **Modelo** y **esfuerzo**: la lista de modelos viene del SDK; el esfuerzo controla cuánto razona Claude.
- `Enter` envía, `Shift+Enter` añade una línea y `Esc` detiene la respuesta.

El agente guarda sus sesiones en la carpeta de datos de la app, separado de cualquier configuración de Claude Code.

Los modelos convertidos se guardan en la carpeta de caché de la app, así que volver a abrir un archivo sin cambios es inmediato.

## Desarrollo

```sh
make dev      # app de Tauri en modo desarrollo
make check    # verificación de tipos (frontend y agente) y compilación de Rust
make build    # bundle de la app, con el agente empaquetado
```

El agente vive en `agent/`: un proceso de Node que la app inicia y con el que se comunica por stdin/stdout
(ver `agent/protocol.ts`). En desarrollo se ejecuta `agent/main.ts` directamente; `make build` lo empaqueta con
`pnpm build:agent` en `src-tauri/resources/agent`, junto con los scripts de Blender y el ejecutable de Claude Code del SDK.

# MeshCode

Visor de archivos de Blender (`.blend`) con una interfaz al estilo VS Code, hecho con Tauri + SvelteKit + three.js.

## Requisitos

- [Blender](https://www.blender.org/download/) instalado. MeshCode lo usa en segundo plano para convertir los `.blend` a glTF.
  Se busca en las rutas de instalación habituales y en el `PATH`; también puedes indicar la ruta con la variable de entorno `BLENDER_PATH`.
- Node.js + pnpm y Rust (ver `make help`).

## Uso

1. Al iniciar, abre una carpeta (**Abrir carpeta…**, `⌘O` / `Ctrl+O`) o elige una de las recientes.
2. En el explorador de la izquierda, haz clic en un archivo `.blend` para verlo. Los demás archivos no se pueden abrir.
3. En el visor puedes elegir el modo de navegación:
   - **Rotar**: arrastra para orbitar, clic derecho para desplazar, rueda para acercar.
   - **Caminar**: `W` `A` `S` `D` para moverte, `3` para subir, `X` para bajar, `Shift` para correr,
     rueda para cambiar la velocidad. Haz clic o arrastra en el visor para mirar con el ratón (`Esc` libera el ratón).
4. Si el archivo cambia en disco (por ejemplo, al guardarlo en Blender), el visor se actualiza automáticamente.

Los modelos convertidos se guardan en la carpeta de caché de la app, así que volver a abrir un archivo sin cambios es inmediato.

## Desarrollo

```sh
make dev      # app de Tauri en modo desarrollo
make check    # verificación de tipos y compilación de Rust
```

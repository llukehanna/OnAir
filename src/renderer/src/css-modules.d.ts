// Ambient declarations for CSS Modules.
//
// electron-vite transforms `*.module.css` imports into a class-name map at build
// time. This file must contain no top-level import/export — a wildcard
// `declare module` is only valid in an ambient (non-module) declaration file.

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

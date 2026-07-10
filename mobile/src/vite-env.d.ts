/// <reference types="vite/client" />

// @fontsource packages are side-effect imports (they inject @font-face CSS) and
// ship no type declarations — declare them so the strict tsconfig accepts them.
declare module '@fontsource-variable/fraunces'
declare module '@fontsource/hanken-grotesk/*'
declare module '@fontsource/space-mono/*'
